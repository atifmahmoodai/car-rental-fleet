import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tx } from "../db";
import { badRequest, conflict, HttpError, notFound, parse, requireUser } from "../http";
import {
  audit,
  bookingsAround,
  getBooking,
  getSettings,
  listClasses,
  listExtras,
  listLocations,
  loadCars,
  loadData,
  maintenanceFor,
  queryBookings,
  saveSettings,
} from "../repo/data";
import { hashPassword } from "../security/password";
import { deleteUserSessions } from "../security/sessions";
import { actions, newId } from "../../../shared/actions";
import { holdsCar, locationAt, unavailableReason, utilisation, validateDriver } from "../../../shared/rental";
import {
  bookingSchema,
  carSchema,
  changeCarSchema,
  checkinSchema,
  checkoutSchema,
  classSchema,
  maintenanceSchema,
  resetPasswordSchema,
  settingsSchema,
  userCreateSchema,
  userUpdateSchema,
  type Role,
} from "../../../shared/schemas";
import { dayStart, fleetStats } from "../../../shared/stats";
import { createBooking } from "./public";
import { runBookingAction } from "./booking-helpers";

const DAY = 86_400_000;

const listSchema = z.object({
  view: z.enum(["upcoming", "active", "all"]).default("upcoming"),
  status: z.string().max(20).default(""),
  q: z.string().max(200).default(""),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const rangeSchema = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int() }).refine((r) => r.to > r.from && r.to - r.from <= 120 * DAY, "Range too large");

export async function staffRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());
  const admin = requireUser("admin");
  const uid = (req: FastifyRequest) => req.session!.user.id;

  /** The small reference tables every staff screen uses. */
  app.get("/fleet", async (req) => {
    const [settings, locations, classes, extras, cars, maintenance] = await Promise.all([
      getSettings(app.db),
      listLocations(app.db),
      listClasses(app.db),
      listExtras(app.db),
      loadCars(app.db),
      app.db.query<{ id: string; car_id: string; from_at: Date; to_at: Date; reason: string }>("SELECT * FROM maintenance WHERE to_at > now() - interval '30 days' ORDER BY from_at"),
    ]);
    return {
      user: req.session!.user,
      timeZone: app.config.TIMEZONE,
      settings,
      locations,
      classes,
      extras,
      cars,
      maintenance: maintenance.rows.map((m) => ({ id: m.id, carId: m.car_id, from: m.from_at.toISOString(), to: m.to_at.toISOString(), reason: m.reason })),
      overdue: (await app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings WHERE status = 'Active' AND return_at < now()")).rows[0].n,
      now: Date.now(),
    };
  });

  /** Per car: out on rent (and until when), where it is now, and how busy it was over the last 30 days. */
  app.get("/fleet/status", async () => {
    const now = Date.now();
    const cars = await loadCars(app.db);
    const ids = cars.map((c) => c.id);
    const recent = await queryBookings(app.db, "car_id = ANY($1) AND status IN ('Reserved', 'Active', 'Returned') AND pickup_at < $3 AND COALESCE((checkin->>'at')::timestamptz, return_at) > $2", [
      ids,
      new Date(now - 30 * DAY),
      new Date(now),
    ]);
    const around = await bookingsAround(app.db, ids, now, now);
    const all = [...new Map([...recent, ...around].map((b) => [b.id, b])).values()];
    const data = await loadData(app.db, { cars, bookings: all, maintenance: await maintenanceFor(app.db, ids) });
    const held = all.filter(holdsCar);
    return {
      items: cars.map((c) => {
        const active = all.find((b) => b.carId === c.id && b.status === "Active");
        return {
          carId: c.id,
          activeReturnAt: active?.returnAt ?? null,
          activeRef: active?.ref ?? null,
          locationId: locationAt(c, held, now),
          utilisation30: utilisation(data, new Date(now - 30 * DAY).toISOString(), new Date(now).toISOString(), new Set([c.id])).rate,
        };
      }),
    };
  });

  app.get("/dashboard", async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const now = Date.now();
    const today = dayStart(now);
    const from = today - (days - 1) * DAY;
    const [cars, settings] = await Promise.all([loadCars(app.db), getSettings(app.db)]);
    // Everything the stats and today's lists look at: rentals touching the period, bookings created or cancelled in it, and anything out now.
    const bookings = await queryBookings(
      app.db,
      `(pickup_at < $2 AND COALESCE((checkin->>'at')::timestamptz, return_at) > $1) OR created_at >= $1 OR cancelled_at >= $1 OR status = 'Active'
        OR (status = 'Reserved' AND pickup_at < $3)`,
      [new Date(from), new Date(now), new Date(today + DAY)],
    );
    // Where cars are now depends on their last return, which can be older than the period.
    const last = await bookingsAround(app.db, cars.map((c) => c.id), now, now);
    const all = new Map([...bookings, ...last].map((b) => [b.id, b]));
    const data = await loadData(app.db, { cars, bookings: [...all.values()], maintenance: await maintenanceFor(app.db) });
    const plates = new Map(cars.map((c) => [c.id, c.plate]));
    const brief = (b: (typeof data.bookings)[number]) => ({ id: b.id, ref: b.ref, name: b.driver.name, plate: plates.get(b.carId) ?? "", pickupAt: b.pickupAt, returnAt: b.returnAt, pickupLocationId: b.pickupLocationId, returnLocationId: b.returnLocationId });
    const inMaintenance = new Set(data.maintenance.filter((m) => Date.parse(m.from) <= now && Date.parse(m.to) > now).map((m) => m.carId));
    const held = data.bookings.filter(holdsCar);
    const available = cars.filter((c) => c.active && !inMaintenance.has(c.id) && !data.bookings.some((b) => b.carId === c.id && b.status === "Active"));
    return {
      now,
      stats: fleetStats({ ...data, settings }, from, now),
      pickupsToday: data.bookings.filter((b) => b.status === "Reserved" && Date.parse(b.pickupAt) >= today && Date.parse(b.pickupAt) < today + DAY).map(brief),
      returnsToday: data.bookings.filter((b) => b.status === "Active" && Date.parse(b.returnAt) >= today && Date.parse(b.returnAt) < today + DAY).map(brief),
      overdue: data.bookings.filter((b) => b.status === "Active" && Date.parse(b.returnAt) < now).map(brief),
      onRent: data.bookings.filter((b) => b.status === "Active").length,
      byLocation: data.locations.map((l) => ({ ...l, count: available.filter((c) => locationAt(c, held, now) === l.id).length })),
      readyNow: available.length,
      inService: inMaintenance.size,
    };
  });

  app.get("/calendar", async (req) => {
    const r = parse(rangeSchema, req.query);
    const bookings = await queryBookings(app.db, "status IN ('Reserved', 'Active', 'Returned') AND pickup_at < $2 AND (COALESCE((checkin->>'at')::timestamptz, return_at) > $1 OR status = 'Active')", [new Date(r.from), new Date(r.to)]);
    const maintenance = (await maintenanceFor(app.db)).filter((m) => Date.parse(m.from) < r.to && Date.parse(m.to) > r.from);
    return { bookings, maintenance };
  });

  app.get("/bookings", async (req) => {
    const f = parse(listSchema, req.query);
    const where: string[] = [];
    const args: unknown[] = [];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    if (f.view === "upcoming") where.push("b.status = 'Reserved'");
    if (f.view === "active") where.push("b.status = 'Active'");
    if (f.status) where.push(`b.status = ${arg(f.status)}`);
    for (const t of f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push(`strpos(lower(b.ref || ' ' || (b.driver->>'name') || ' ' || b.driver_email || ' ' || (b.driver->>'phone') || ' ' || c.plate), ${arg(t)}) > 0`);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = f.view === "all" ? "b.pickup_at DESC" : "b.pickup_at";
    const total = (await app.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings b JOIN cars c ON c.id = b.car_id ${w}`, args)).rows[0].n;
    const ids = (await app.db.query<{ id: string }>(`SELECT b.id FROM bookings b JOIN cars c ON c.id = b.car_id ${w} ORDER BY ${order} LIMIT ${f.limit} OFFSET ${f.offset}`, args)).rows.map((r) => r.id);
    const items = ids.length ? await queryBookings(app.db, "id = ANY($1)", [ids], "") : [];
    const byId = new Map(items.map((b) => [b.id, b]));
    return { total, items: ids.map((id) => byId.get(id)!) };
  });

  app.get<{ Params: { id: string } }>("/bookings/:id", async (req) => {
    const b = await getBooking(app.db, { id: req.params.id });
    if (!b) throw notFound("Booking not found");
    let options: { carId: string; reason: string | null }[] = [];
    if (b.status === "Reserved") {
      // Which cars this booking could move to, and why the others can't take it.
      const cars = await loadCars(app.db);
      const around = await bookingsAround(app.db, cars.map((c) => c.id), Date.parse(b.pickupAt), Date.parse(b.returnAt));
      const data = await loadData(app.db, { cars, bookings: around, maintenance: await maintenanceFor(app.db) });
      const req2 = { pickupAt: b.pickupAt, returnAt: b.returnAt, pickupLocationId: b.pickupLocationId, returnLocationId: b.returnLocationId, ignoreBookingId: b.id, now: Date.now() };
      options = cars.map((car) => ({ carId: car.id, reason: car.id === b.carId ? "current car" : unavailableReason(car, req2, data) }));
    }
    const stillOut = b.status === "Reserved" ? (await queryBookings(app.db, "car_id = $1 AND status = 'Active' AND id <> $2", [b.carId, b.id])).map((x) => x.ref) : [];
    return { booking: b, options, carStillOutOn: stillOut };
  });

  /** Counter booking by staff (same rules as online, without the web form's honeypot and terms box). */
  app.post("/bookings", async (req, reply) => {
    const input = parse(bookingSchema, req.body);
    const settings = await getSettings(app.db);
    const errs = validateDriver(input.driver, input.pickupAt, settings);
    if (Object.keys(errs).length) throw badRequest("Please check the driver details.", errs as Record<string, string>);
    const b = await createBooking(app, { ...input, source: "Counter" }, uid(req), req.ip);
    return reply.status(201).send(b);
  });

  /** Loads a booking (locked) and the rows its action needs, then runs the shared rule. */
  const onBooking = (
    name: string,
    run: (b: NonNullable<Awaited<ReturnType<typeof getBooking>>>, req: FastifyRequest, c: Parameters<Parameters<typeof tx>[1]>[0]) => Promise<unknown>,
  ) =>
    app.post<{ Params: { id: string } }>(`/bookings/:id/${name}`, async (req) =>
      tx(app.db, async (c) => {
        const b = await getBooking(c, { id: req.params.id }, true);
        if (!b) throw notFound("Booking not found");
        return run(b, req, c);
      }),
    );

  onBooking("cancel", async (b, req, c) =>
    runBookingAction(c, { cars: await loadCars(c, { ids: [b.carId] }), bookings: [b] }, (d, now) => actions.cancel(d, b.id, now), { userId: uid(req), action: "booking.cancel", ip: req.ip, bookingId: b.id }),
  );
  onBooking("no-show", async (b, req, c) =>
    runBookingAction(c, { cars: await loadCars(c, { ids: [b.carId] }), bookings: [b] }, (d, now) => actions.noShow(d, b.id, now), { userId: uid(req), action: "booking.no_show", ip: req.ip, bookingId: b.id }),
  );
  onBooking("checkout", async (b, req, c) => {
    const h = parse(checkoutSchema, req.body);
    const cars = await loadCars(c, { ids: [b.carId], lock: true });
    const others = await queryBookings(c, "car_id = $1 AND status = 'Active' AND id <> $2", [b.carId, b.id]);
    return runBookingAction(c, { cars, bookings: [b, ...others] }, (d, now) => actions.checkout(d, b.id, h, now), { userId: uid(req), action: "booking.checkout", ip: req.ip, bookingId: b.id, details: h });
  });
  onBooking("checkin", async (b, req, c) => {
    const r = parse(checkinSchema, req.body);
    const cars = await loadCars(c, { ids: [b.carId], lock: true });
    return runBookingAction(c, { cars, bookings: [b] }, (d, now) => actions.checkin(d, b.id, r, now), { userId: uid(req), action: "booking.checkin", ip: req.ip, bookingId: b.id, details: { odometer: r.odometer, fuel: r.fuel, damage: r.damage, otherChargesCents: r.otherChargesCents } });
  });
  onBooking("change-car", async (b, req, c) => {
    const { carId } = parse(changeCarSchema, req.body);
    const cars = await loadCars(c, { ids: [carId], lock: true });
    if (!cars.length) throw notFound("Car not found");
    const around = await bookingsAround(c, [carId], Date.parse(b.pickupAt), Date.parse(b.returnAt), true);
    return runBookingAction(c, { cars, bookings: [b, ...around.filter((x) => x.id !== b.id)] }, (d, now) => actions.changeCar(d, b.id, carId, now), {
      userId: uid(req),
      action: "booking.change_car",
      ip: req.ip,
      bookingId: b.id,
      details: { from: b.carId, to: carId },
    });
  });

  app.post("/maintenance", async (req, reply) => {
    const m = parse(maintenanceSchema, req.body);
    const id = newId("m");
    await tx(app.db, async (c) => {
      const cars = await loadCars(c, { ids: [m.carId], lock: true });
      if (!cars.length) throw notFound("Car not found");
      const around = await bookingsAround(c, [m.carId], Date.parse(m.from), Date.parse(m.to));
      const before = await loadData(c, { cars, bookings: around });
      const res = actions.addMaintenance(before, { id, carId: m.carId, from: new Date(m.from).toISOString(), to: new Date(m.to).toISOString(), reason: m.reason }, Date.now());
      if (!res.ok) throw new HttpError(409, res.error, "rejected");
      await c.query("INSERT INTO maintenance (id, car_id, from_at, to_at, reason) VALUES ($1, $2, $3, $4, $5)", [id, m.carId, m.from, m.to, m.reason]);
      await audit(c, { userId: uid(req), action: "maintenance.create", entity: "car", entityId: m.carId, details: m, ip: req.ip });
    });
    return reply.status(201).send({ id });
  });

  app.delete<{ Params: { id: string } }>("/maintenance/:id", async (req) => {
    const r = await app.db.query<{ car_id: string }>("DELETE FROM maintenance WHERE id = $1 RETURNING car_id", [req.params.id]);
    if (!r.rows[0]) throw notFound("Maintenance not found");
    await audit(app.db, { userId: uid(req), action: "maintenance.delete", entity: "car", entityId: r.rows[0].car_id, ip: req.ip });
    return { ok: true };
  });

  app.post("/cars", { preHandler: admin }, async (req, reply) => {
    const car = parse(carSchema, req.body);
    const id = newId("c");
    await app.db.query("INSERT INTO cars (id, plate, make, model, year, class_id, home_location_id, odometer, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      id,
      car.plate,
      car.make,
      car.model,
      car.year,
      car.classId,
      car.homeLocationId,
      car.odometer,
      car.active,
    ]);
    await audit(app.db, { userId: uid(req), action: "car.create", entity: "car", entityId: id, details: { plate: car.plate }, ip: req.ip });
    return reply.status(201).send({ id, ...car });
  });

  app.put<{ Params: { id: string } }>("/cars/:id", { preHandler: admin }, async (req) => {
    const car = parse(carSchema, req.body);
    return tx(app.db, async (c) => {
      const [before] = await loadCars(c, { ids: [req.params.id], lock: true });
      if (!before) throw notFound("Car not found");
      if (car.odometer < before.odometer) throw badRequest("The odometer can't go down.", { odometer: `Last reading ${before.odometer}` });
      if (car.classId !== before.classId || !car.active) {
        // Future bookings were sold for this class; moving or retiring the car must not strand them.
        const future = await queryBookings(c, "car_id = $1 AND status IN ('Reserved', 'Active')", [before.id]);
        if (future.length) throw conflict(`Move its ${future.length} upcoming booking(s) to other cars first (${future.slice(0, 3).map((b) => b.ref).join(", ")}${future.length > 3 ? "…" : ""}).`);
      }
      await c.query("UPDATE cars SET plate = $2, make = $3, model = $4, year = $5, class_id = $6, home_location_id = $7, odometer = $8, active = $9 WHERE id = $1", [
        before.id,
        car.plate,
        car.make,
        car.model,
        car.year,
        car.classId,
        car.homeLocationId,
        car.odometer,
        car.active,
      ]);
      await audit(c, { userId: uid(req), action: "car.update", entity: "car", entityId: before.id, details: car, ip: req.ip });
      return { id: before.id, ...car };
    });
  });

  app.put<{ Params: { id: string } }>("/classes/:id", { preHandler: admin }, async (req) => {
    const k = parse(classSchema, req.body);
    const r = await app.db.query(
      "UPDATE car_classes SET name = $2, example = $3, seats = $4, bags = $5, transmission = $6, body_type = $7, daily_rate_cents = $8, deposit_cents = $9, color_hex = $10 WHERE id = $1",
      [req.params.id, k.name, k.example, k.seats, k.bags, k.transmission, k.bodyType, k.dailyRateCents, k.depositCents, k.colorHex],
    );
    if (!r.rowCount) throw notFound("Class not found");
    await audit(app.db, { userId: uid(req), action: "class.update", entity: "class", entityId: req.params.id, details: k, ip: req.ip });
    return { id: req.params.id, ...k };
  });

  app.put("/settings", { preHandler: admin }, async (req) => {
    const s = parse(settingsSchema, req.body);
    if (s.youngDriverAge < s.minDriverAge) throw badRequest("The young-driver age must be at least the minimum age.", { youngDriverAge: "Below the minimum age" });
    await saveSettings(app.db, s);
    await audit(app.db, { userId: uid(req), action: "settings.update", entity: "settings", entityId: "rental", details: s, ip: req.ip });
    return s;
  });

  // Staff logins.
  interface UserRow {
    id: string;
    email: string;
    name: string;
    role: Role;
    active: boolean;
    locked: boolean;
  }
  const USERS = "SELECT id, email, name, role, active, (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users";
  app.get("/users", { preHandler: admin }, async () => ({ items: (await app.db.query<UserRow>(`${USERS} ORDER BY active DESC, name`)).rows }));
  app.post("/users", { preHandler: admin }, async (req, reply) => {
    const u = parse(userCreateSchema, req.body);
    const id = `u-${randomUUID()}`;
    try {
      await app.db.query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)", [id, u.email, u.name, u.role, await hashPassword(u.password)]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("A user with that email already exists.");
      throw e;
    }
    await audit(app.db, { userId: uid(req), action: "user.create", entity: "user", entityId: id, details: { email: u.email, role: u.role }, ip: req.ip });
    return reply.status(201).send((await app.db.query<UserRow>(`${USERS} WHERE id = $1`, [id])).rows[0]);
  });
  app.put<{ Params: { id: string } }>("/users/:id", { preHandler: admin }, async (req) => {
    const u = parse(userUpdateSchema, req.body);
    if (req.params.id === uid(req) && (u.role !== "admin" || !u.active)) throw new HttpError(400, "You can't remove your own admin access.", "validation");
    return tx(app.db, async (c) => {
      const r = await c.query("UPDATE users SET name = $2, role = $3, active = $4, updated_at = now() WHERE id = $1", [req.params.id, u.name, u.role, u.active]);
      if (!r.rowCount) throw notFound("User not found");
      if ((await c.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active")).rows[0].n === 0) throw new HttpError(400, "There must be at least one active admin.", "validation");
      if (!u.active) await deleteUserSessions(c, req.params.id);
      await audit(c, { userId: uid(req), action: "user.update", entity: "user", entityId: req.params.id, details: u, ip: req.ip });
      return (await c.query<UserRow>(`${USERS} WHERE id = $1`, [req.params.id])).rows[0];
    });
  });
  app.post<{ Params: { id: string } }>("/users/:id/password", { preHandler: admin }, async (req) => {
    const { password } = parse(resetPasswordSchema, req.body);
    const r = await app.db.query("UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1", [req.params.id, await hashPassword(password)]);
    if (!r.rowCount) throw notFound("User not found");
    await deleteUserSessions(app.db, req.params.id);
    await audit(app.db, { userId: uid(req), action: "user.password_reset", entity: "user", entityId: req.params.id, ip: req.ip });
    return { ok: true };
  });

  app.get("/audit", { preHandler: admin }, async (req) => {
    const { limit, entityId } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(200), entityId: z.string().max(100).optional() }), req.query);
    const { rows } = await app.db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id AS "entityId", a.details, a.ip, u.name AS "userName"
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ($2::text IS NULL OR a.entity_id = $2) ORDER BY a.at DESC, a.id DESC LIMIT $1`,
      [limit, entityId ?? null],
    );
    return { items: rows };
  });
}
