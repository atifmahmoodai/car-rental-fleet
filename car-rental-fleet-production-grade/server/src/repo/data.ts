import type { Queryable } from "../db";
import { settingsSchema } from "../../../shared/schemas";
import { holdsCar } from "../../../shared/rental";
import { DEFAULT_SETTINGS } from "../../../shared/settings-defaults";
import type { Booking, Car, CarClass, Extra, Location, Maintenance, RentalData, Settings } from "../../../shared/types";

const HOUR = 3_600_000;
/** Extra reach around a request window, so bookings whose cleaning buffer touches it are included (buffers are at most 48 h). */
const SLACK_MS = 2 * 24 * HOUR;

export async function getSettings(c: Queryable): Promise<Settings> {
  const { rows } = await c.query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'rental'");
  const parsed = settingsSchema.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(c: Queryable, s: Settings) {
  await c.query("INSERT INTO settings (key, value) VALUES ('rental', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(s)]);
}

export async function listLocations(c: Queryable): Promise<Location[]> {
  return (await c.query<Location>("SELECT id, name, address FROM locations ORDER BY name")).rows;
}

export async function listClasses(c: Queryable): Promise<CarClass[]> {
  const { rows } = await c.query<{
    id: string;
    name: string;
    example: string;
    seats: number;
    bags: number;
    transmission: CarClass["transmission"];
    body_type: CarClass["bodyType"];
    daily_rate_cents: number;
    deposit_cents: number;
    color_hex: string;
  }>("SELECT * FROM car_classes ORDER BY position, daily_rate_cents");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    example: r.example,
    seats: r.seats,
    bags: r.bags,
    transmission: r.transmission,
    bodyType: r.body_type,
    dailyRateCents: r.daily_rate_cents,
    depositCents: r.deposit_cents,
    colorHex: r.color_hex,
  }));
}

export async function listExtras(c: Queryable): Promise<Extra[]> {
  const { rows } = await c.query<{ id: string; name: string; per_day_cents: number; max_cents: number | null }>("SELECT * FROM extras ORDER BY position, name");
  return rows.map((r) => ({ id: r.id, name: r.name, perDayCents: r.per_day_cents, ...(r.max_cents !== null ? { maxCents: r.max_cents } : {}) }));
}

interface CarRow {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  class_id: string;
  home_location_id: string;
  odometer: number;
  active: boolean;
}
const toCar = (r: CarRow): Car => ({ id: r.id, plate: r.plate, make: r.make, model: r.model, year: r.year, classId: r.class_id, homeLocationId: r.home_location_id, odometer: r.odometer, active: r.active });

/** Cars, optionally only one class; `lock` takes row locks so concurrent bookings of that class queue up. */
export async function loadCars(c: Queryable, opts: { classId?: string; ids?: string[]; lock?: boolean } = {}): Promise<Car[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.classId) {
    args.push(opts.classId);
    where.push(`class_id = $${args.length}`);
  }
  if (opts.ids) {
    args.push(opts.ids);
    where.push(`id = ANY($${args.length})`);
  }
  const { rows } = await c.query<CarRow>(`SELECT * FROM cars ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id ${opts.lock ? "FOR UPDATE" : ""}`, args);
  return rows.map(toCar);
}

interface BookingRow {
  id: string;
  ref: string;
  car_id: string;
  class_id: string;
  pickup_location_id: string;
  return_location_id: string;
  pickup_at: Date;
  return_at: Date;
  driver: Booking["driver"];
  extras: string[];
  quote: Booking["quote"];
  status: Booking["status"];
  source: Booking["source"];
  created_at: Date;
  cancelled_at: Date | null;
  cancellation_fee_cents: number | null;
  checkout: Booking["checkout"] | null;
  checkin: Booking["checkin"] | null;
}

export function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    ref: r.ref,
    carId: r.car_id,
    classId: r.class_id,
    pickupLocationId: r.pickup_location_id,
    returnLocationId: r.return_location_id,
    pickupAt: r.pickup_at.toISOString(),
    returnAt: r.return_at.toISOString(),
    driver: r.driver,
    extras: r.extras,
    quote: r.quote,
    status: r.status,
    source: r.source,
    createdAt: r.created_at.toISOString(),
    ...(r.cancelled_at ? { cancelledAt: r.cancelled_at.toISOString() } : {}),
    ...(r.cancellation_fee_cents !== null ? { cancellationFeeCents: r.cancellation_fee_cents } : {}),
    ...(r.checkout ? { checkout: r.checkout } : {}),
    ...(r.checkin ? { checkin: r.checkin } : {}),
  };
}

const HOLDING = "status IN ('Reserved', 'Active', 'Returned')";
const END = "COALESCE((checkin->>'at')::timestamptz, return_at)";

/**
 * The bookings that decide whether `carIds` can take a rental in [fromMs, toMs): any that overlap the
 * window (with slack for cleaning buffers), cars still out, and each car's last rental before and
 * next rental after (for where the car will be).
 */
export async function bookingsAround(c: Queryable, carIds: string[], fromMs: number, toMs: number, lock = false): Promise<Booking[]> {
  if (!carIds.length) return [];
  const from = new Date(fromMs - SLACK_MS);
  const to = new Date(toMs + SLACK_MS);
  const { rows } = await c.query<BookingRow>(
    `SELECT * FROM bookings WHERE car_id = ANY($1) AND ${HOLDING} AND (
        (pickup_at < $3 AND ${END} > $2)
        OR status = 'Active'
        OR id IN (SELECT DISTINCT ON (car_id) id FROM bookings WHERE car_id = ANY($1) AND ${HOLDING} AND ${END} <= $4 ORDER BY car_id, return_at DESC)
        OR id IN (SELECT DISTINCT ON (car_id) id FROM bookings WHERE car_id = ANY($1) AND ${HOLDING} AND pickup_at >= $5 ORDER BY car_id, pickup_at)
     ) ORDER BY pickup_at ${lock ? "FOR UPDATE" : ""}`,
    [carIds, from, to, new Date(fromMs), new Date(toMs)],
  );
  return rows.map(toBooking);
}

export async function getBooking(c: Queryable, by: { id?: string; ref?: string }, lock = false): Promise<Booking | null> {
  const { rows } = await c.query<BookingRow>(`SELECT * FROM bookings WHERE ${by.id ? "id = $1" : "ref = $1"} ${lock ? "FOR UPDATE" : ""}`, [by.id ?? by.ref]);
  return rows[0] ? toBooking(rows[0]) : null;
}

export async function queryBookings(c: Queryable, where: string, args: unknown[], tail = "ORDER BY pickup_at"): Promise<Booking[]> {
  return (await c.query<BookingRow>(`SELECT * FROM bookings WHERE ${where} ${tail}`, args)).rows.map(toBooking);
}

interface MaintRow {
  id: string;
  car_id: string;
  from_at: Date;
  to_at: Date;
  reason: string;
}
const toMaint = (r: MaintRow): Maintenance => ({ id: r.id, carId: r.car_id, from: r.from_at.toISOString(), to: r.to_at.toISOString(), reason: r.reason });

export async function maintenanceFor(c: Queryable, carIds?: string[]): Promise<Maintenance[]> {
  const { rows } = await c.query<MaintRow>(`SELECT * FROM maintenance ${carIds ? "WHERE car_id = ANY($1)" : ""} ORDER BY from_at`, carIds ? [carIds] : []);
  return rows.map(toMaint);
}

/** The slice of the business a decision needs, in the shape the shared rules expect. */
export async function loadData(c: Queryable, parts: { cars: Car[]; bookings: Booking[]; maintenance?: Maintenance[] }): Promise<RentalData> {
  const settings = await getSettings(c);
  const locations = await listLocations(c);
  const classes = await listClasses(c);
  const extras = await listExtras(c);
  const maintenance = parts.maintenance ?? (await maintenanceFor(c, parts.cars.map((x) => x.id)));
  return { settings, locations, classes, extras, cars: parts.cars, bookings: parts.bookings, maintenance };
}

/** [start, end) the car is taken, including the cleaning buffer; null when the booking doesn't hold a car. */
export function occupiedRange(b: Booking, bufferHours: number): [Date, Date] | null {
  if (!holdsCar(b)) return null;
  const start = Date.parse(b.checkout?.at ?? b.pickupAt);
  const end = Date.parse(b.checkin?.at ?? b.returnAt) + bufferHours * HOUR;
  return [new Date(start), new Date(end)];
}

export async function upsertBooking(c: Queryable, b: Booking, bufferHours: number) {
  const occ = occupiedRange(b, bufferHours);
  await c.query(
    `INSERT INTO bookings (id, ref, car_id, class_id, pickup_location_id, return_location_id, pickup_at, return_at, driver, driver_email, extras,
                           quote, status, source, created_at, cancelled_at, cancellation_fee_cents, checkout, checkin, occupied)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
             CASE WHEN $20::timestamptz IS NULL THEN NULL ELSE tstzrange($20::timestamptz, $21::timestamptz, '[)') END)
     ON CONFLICT (id) DO UPDATE SET car_id = EXCLUDED.car_id, class_id = EXCLUDED.class_id, status = EXCLUDED.status,
       cancelled_at = EXCLUDED.cancelled_at, cancellation_fee_cents = EXCLUDED.cancellation_fee_cents, checkout = EXCLUDED.checkout,
       checkin = EXCLUDED.checkin, occupied = EXCLUDED.occupied, version = bookings.version + 1, updated_at = now()`,
    [
      b.id,
      b.ref,
      b.carId,
      b.classId,
      b.pickupLocationId,
      b.returnLocationId,
      b.pickupAt,
      b.returnAt,
      JSON.stringify(b.driver),
      b.driver.email,
      b.extras,
      JSON.stringify(b.quote),
      b.status,
      b.source,
      b.createdAt,
      b.cancelledAt ?? null,
      b.cancellationFeeCents ?? null,
      b.checkout ? JSON.stringify(b.checkout) : null,
      b.checkin ? JSON.stringify(b.checkin) : null,
      occ?.[0] ?? null,
      occ?.[1] ?? null,
    ],
  );
}

/** Saves what a shared action changed: bookings, car odometers and new maintenance. Returns the changed booking ids. */
export async function persistChanges(c: Queryable, before: RentalData, after: RentalData): Promise<string[]> {
  const old = new Map(before.bookings.map((b) => [b.id, JSON.stringify(b)]));
  const changed: string[] = [];
  for (const b of after.bookings) {
    if (old.get(b.id) === JSON.stringify(b)) continue;
    await upsertBooking(c, b, after.settings.bufferHours);
    changed.push(b.id);
  }
  const odo = new Map(before.cars.map((x) => [x.id, x.odometer]));
  for (const car of after.cars) if (odo.get(car.id) !== car.odometer) await c.query("UPDATE cars SET odometer = $2 WHERE id = $1", [car.id, car.odometer]);
  const known = new Set(before.maintenance.map((m) => m.id));
  for (const m of after.maintenance) {
    if (!known.has(m.id)) await c.query("INSERT INTO maintenance (id, car_id, from_at, to_at, reason) VALUES ($1, $2, $3, $4, $5)", [m.id, m.carId, m.from, m.to, m.reason]);
  }
  return changed;
}

export async function audit(
  db: Queryable,
  e: { userId: string | null; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown>; ip?: string },
) {
  await db.query("INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)", [
    e.userId,
    e.action,
    e.entity,
    e.entityId ?? null,
    JSON.stringify(e.details ?? {}),
    e.ip ?? null,
  ]);
}
