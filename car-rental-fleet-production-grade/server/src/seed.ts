import type { PoolClient } from "pg";
import { hashPassword } from "./security/password";
import { upsertBooking } from "./repo/data";
import { generateDemoData } from "../../shared/generate";

export const DEMO_ADMIN = "admin@demo.local";
export const DEMO_AGENT = "agent@demo.local";

/** Demo fleet with past, current and future rentals around `now`. */
export async function seedDemo(c: PoolClient, opts: { now: Date; force: boolean; password: string }) {
  const existing = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings")).rows[0].n;
  if (existing && !opts.force) throw new Error(`The database already has ${existing} bookings. Re-run with --force to replace everything with demo data.`);
  if (opts.force) for (const t of ["bookings", "maintenance", "cars", "extras", "car_classes", "locations"]) await c.query(`DELETE FROM ${t}`);

  const hash = await hashPassword(opts.password);
  for (const [id, email, name, role] of [
    ["u-demo-admin", DEMO_ADMIN, "Demo Admin", "admin"],
    ["u-demo-agent", DEMO_AGENT, "Demo Agent", "agent"],
  ]) {
    await c.query(
      `INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, active = true, failed_logins = 0, locked_until = NULL`,
      [id, email, name, role, hash],
    );
  }

  const d = generateDemoData(opts.now);
  await c.query("INSERT INTO settings (key, value) VALUES ('rental', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(d.settings)]);
  for (const l of d.locations) await c.query("INSERT INTO locations (id, name, address) VALUES ($1, $2, $3)", [l.id, l.name, l.address]);
  for (const [i, k] of d.classes.entries()) {
    await c.query(
      "INSERT INTO car_classes (id, name, example, seats, bags, transmission, body_type, daily_rate_cents, deposit_cents, color_hex, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [k.id, k.name, k.example, k.seats, k.bags, k.transmission, k.bodyType, k.dailyRateCents, k.depositCents, k.colorHex, i],
    );
  }
  for (const [i, x] of d.extras.entries()) await c.query("INSERT INTO extras (id, name, per_day_cents, max_cents, position) VALUES ($1, $2, $3, $4, $5)", [x.id, x.name, x.perDayCents, x.maxCents ?? null, i]);
  for (const car of d.cars) {
    await c.query("INSERT INTO cars (id, plate, make, model, year, class_id, home_location_id, odometer, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      car.id,
      car.plate,
      car.make,
      car.model,
      car.year,
      car.classId,
      car.homeLocationId,
      car.odometer,
      car.active,
    ]);
  }
  // Written one by one through the same code as live bookings, so the no-double-booking constraint checks the demo too.
  for (const b of d.bookings) await upsertBooking(c, b, d.settings.bufferHours);
  for (const m of d.maintenance) await c.query("INSERT INTO maintenance (id, car_id, from_at, to_at, reason) VALUES ($1, $2, $3, $4, $5)", [m.id, m.carId, m.from, m.to, m.reason]);
  return { cars: d.cars.length, bookings: d.bookings.length, logins: [DEMO_ADMIN, DEMO_AGENT] };
}
