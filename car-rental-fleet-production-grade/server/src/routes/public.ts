import type { FastifyInstance } from "fastify";
import { tx } from "../db";
import { badRequest, HttpError, notFound, parse } from "../http";
import { audit, bookingsAround, getBooking, getSettings, listClasses, listExtras, listLocations, loadCars, loadData, maintenanceFor, persistChanges } from "../repo/data";
import { actions } from "../../../shared/actions";
import { availableCars, quote, validateDates, validateDriver } from "../../../shared/rental";
import { lookupSchema, publicBookingSchema, searchSchema, type Catalog, type PublicBooking } from "../../../shared/schemas";
import type { Booking, Settings } from "../../../shared/types";
import { bookingEmail, runBookingAction } from "./booking-helpers";

export const toPublicBooking = (b: Booking): PublicBooking => ({
  ref: b.ref,
  classId: b.classId,
  pickupLocationId: b.pickupLocationId,
  returnLocationId: b.returnLocationId,
  pickupAt: b.pickupAt,
  returnAt: b.returnAt,
  extras: b.extras,
  quote: b.quote,
  status: b.status,
  createdAt: b.createdAt,
  ...(b.cancelledAt ? { cancelledAt: b.cancelledAt } : {}),
  ...(b.cancellationFeeCents !== undefined ? { cancellationFeeCents: b.cancellationFeeCents } : {}),
  driver: { name: b.driver.name, email: b.driver.email, phone: b.driver.phone },
});

/** Same answer for "no such booking" and "wrong email", so references can't be probed. */
const NOT_FOUND = "We couldn't find a booking with that reference and email.";

export async function publicRoutes(app: FastifyInstance) {
  app.get("/catalog", async (_req, reply): Promise<Catalog> => {
    reply.header("cache-control", "public, max-age=60");
    const [settings, locations, classes, extras] = await Promise.all([getSettings(app.db), listLocations(app.db), listClasses(app.db), listExtras(app.db)]);
    return { timeZone: app.config.TIMEZONE, settings, locations, classes, extras };
  });

  /** Which car classes are free for a trip, with the price. */
  app.get("/availability", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const s = parse(searchSchema, req.query);
    const now = Date.now();
    const error = validateDates(s.pickupAt, s.returnAt, now);
    const classes = await listClasses(app.db);
    const settings = await getSettings(app.db);
    if (error) return { error, classes: [] };
    const cars = await loadCars(app.db);
    const bookings = await bookingsAround(app.db, cars.map((c) => c.id), Date.parse(s.pickupAt), Date.parse(s.returnAt));
    const data = await loadData(app.db, { cars, bookings, maintenance: await maintenanceFor(app.db) });
    const free = availableCars({ ...s, now }, data);
    return {
      classes: classes.map((cls) => ({
        classId: cls.id,
        available: free.filter((c) => c.classId === cls.id).length,
        quote: quote({ ...s, cls, extras: [] }, settings),
      })),
    };
  });

  app.post("/bookings", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const input = parse(publicBookingSchema, req.body);
    // Honeypot filled in: look successful to the bot, store nothing.
    if (input.website) return reply.status(201).send({ ref: "RC-000000", email: input.driver.email });
    const settings = await getSettings(app.db);
    const driverErrors = validateDriver(input.driver, input.pickupAt, settings);
    if (Object.keys(driverErrors).length) throw badRequest("Please check the driver details.", driverErrors as Record<string, string>);
    const booking = await createBooking(app, { ...input, source: "Web" }, null, req.ip);
    void notifyNewBooking(app, booking, settings);
    return reply.status(201).send({ ref: booking.ref, email: booking.driver.email });
  });

  app.post("/bookings/lookup", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    const { ref, email } = parse(lookupSchema, req.body);
    const b = await getBooking(app.db, { ref });
    if (!b || b.driver.email !== email) throw notFound(NOT_FOUND);
    return toPublicBooking(b);
  });

  app.post("/bookings/cancel", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const { ref, email } = parse(lookupSchema, req.body);
    const updated = await tx(app.db, async (c) => {
      const b = await getBooking(c, { ref }, true);
      if (!b || b.driver.email !== email) throw notFound(NOT_FOUND);
      return runBookingAction(c, { cars: await loadCars(c, { ids: [b.carId] }), bookings: [b] }, (d, now) => actions.cancel(d, b.id, now), {
        userId: null,
        action: "booking.cancel",
        ip: req.ip,
        bookingId: b.id,
      });
    });
    const settings = await getSettings(app.db);
    void app.mailer.send(
      updated.driver.email,
      `Booking ${updated.ref} cancelled`,
      [`Hi ${updated.driver.name},`, "", `Your booking ${updated.ref} has been cancelled.`, updated.cancellationFeeCents ? `A late-cancellation fee applies (${(updated.cancellationFeeCents / 100).toFixed(2)} ${settings.currency}).` : "No cancellation fee applies.", "", settings.name].join("\n"),
    );
    return toPublicBooking(updated);
  });
}

/**
 * Books a car with no double-booking, even under load: the class's cars are row-locked while the
 * shared rules pick one, and the database's exclusion constraint is the final guard.
 */
export async function createBooking(
  app: FastifyInstance,
  input: { classId: string; pickupAt: string; returnAt: string; pickupLocationId: string; returnLocationId: string; extras: string[]; driver: Booking["driver"]; source: Booking["source"] },
  userId: string | null,
  ip: string,
): Promise<Booking> {
  const extras = await listExtras(app.db);
  const unknown = input.extras.filter((x) => !extras.some((e) => e.id === x));
  if (unknown.length) throw badRequest("Unknown extra.", { extras: "Unknown extra" });
  const clean = { ...input, extras: [...new Set(input.extras)] };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await tx(app.db, async (c) => {
        const cars = await loadCars(c, { classId: input.classId, lock: true });
        const bookings = await bookingsAround(c, cars.map((x) => x.id), Date.parse(input.pickupAt), Date.parse(input.returnAt));
        const before = await loadData(c, { cars, bookings });
        const res = actions.create(before, clean, Date.now());
        if (!res.ok) throw new HttpError(409, res.error, "unavailable");
        await persistChanges(c, before, res.value.data);
        await audit(c, { userId, action: "booking.create", entity: "booking", entityId: res.value.booking.id, details: { ref: res.value.booking.ref, source: input.source }, ip });
        return res.value.booking;
      });
    } catch (e) {
      // A reference collision (unique ref) is retried with a new reference.
      if ((e as { code?: string; constraint?: string }).code === "23505" && (e as { constraint?: string }).constraint === "bookings_ref_key" && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function notifyNewBooking(app: FastifyInstance, b: Booking, settings: Settings) {
  const link = new URL(`/booking/${b.ref}`, app.config.PUBLIC_URL).toString();
  await app.mailer.send(b.driver.email, `Your booking ${b.ref} is confirmed`, bookingEmail(b, settings, link));
  if (app.config.BOOKING_NOTIFY_EMAIL) await app.mailer.send(app.config.BOOKING_NOTIFY_EMAIL, `New booking ${b.ref}`, bookingEmail(b, settings, link));
}
