import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tx } from "../src/db";
import { getBooking, upsertBooking } from "../src/repo/data";
import { DEMO_ADMIN, DEMO_AGENT } from "../src/seed";
import { login, makeApp, type Agent, type TestCtx } from "./helpers";

let ctx: TestCtx;
let admin: Agent;
let agent: Agent;
beforeAll(async () => {
  ctx = await makeApp();
  admin = await login(ctx.app, DEMO_ADMIN);
  agent = await login(ctx.app, DEMO_AGENT);
});
afterAll(() => ctx.close());

const DAY = 86_400_000;
/** A trip `days` from now, far enough out to be free of demo bookings. */
const trip = (startDays: number, lengthDays = 2, loc = "l-airport") => {
  const p = new Date(Date.now() + startDays * DAY);
  // Whole days out: pick-up at 10:00 UTC. Same day: keep the time, rounded up to the quarter hour.
  if (startDays >= 1) p.setUTCHours(10, 0, 0, 0);
  else p.setTime(Math.ceil(p.getTime() / 900_000) * 900_000);
  return { pickupAt: p.toISOString(), returnAt: new Date(p.getTime() + lengthDays * DAY).toISOString(), pickupLocationId: loc, returnLocationId: loc };
};
const driver = (n = 1) => ({ name: `Test Driver${n}`, email: `driver${n}@example.com`, phone: "555 123 4567", licenseNo: "d1234567", dob: "1990-01-01" });
let ip = 1;
const book = (body: object) => ctx.app.inject({ method: "POST", url: "/api/public/bookings", payload: body, remoteAddress: `198.18.${Math.floor(ip / 250)}.${ip++ % 250}` });
const availability = async (t: ReturnType<typeof trip>) =>
  (await ctx.app.inject(`/api/public/availability?${new URLSearchParams(t)}`)).json() as { error?: string; classes: { classId: string; available: number; quote: { totalCents: number } }[] };

describe("public booking", () => {
  it("shows prices and availability and rejects past dates", async () => {
    const cat = (await ctx.app.inject("/api/public/catalog")).json();
    expect(cat.classes.length).toBe(5);
    const a = await availability(trip(120));
    expect(a.classes.find((c) => c.classId === "k-eco")!.available).toBeGreaterThan(0);
    expect(a.classes[0].quote.totalCents).toBeGreaterThan(0);
    expect((await availability(trip(-3))).error).toMatch(/past/);
  });

  it("books, emails a confirmation, and lets the customer find and cancel it with their email", async () => {
    const r = await book({ ...trip(121), classId: "k-eco", extras: ["x-gps"], driver: driver(), acceptTerms: true });
    expect(r.statusCode).toBe(201);
    const { ref } = r.json();
    expect(ref).toMatch(/^RC-[A-Z0-9]{6}$/);
    await new Promise((res) => setTimeout(res, 20));
    expect(ctx.mail.some((m) => m.to === "driver1@example.com" && m.text.includes(ref))).toBe(true);

    const wrong = await ctx.app.inject({ method: "POST", url: "/api/public/bookings/lookup", payload: { ref, email: "someone@else.com" } });
    const missing = await ctx.app.inject({ method: "POST", url: "/api/public/bookings/lookup", payload: { ref: "RC-ZZZZZZ", email: "driver1@example.com" } });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().message).toBe(missing.json().message);
    const found = (await ctx.app.inject({ method: "POST", url: "/api/public/bookings/lookup", payload: { ref: ref.toLowerCase(), email: "DRIVER1@example.com" } })).json();
    expect(found.status).toBe("Reserved");
    expect(found).not.toHaveProperty("carId");
    expect(JSON.stringify(found)).not.toContain("D1234567");
    const cancelled = (await ctx.app.inject({ method: "POST", url: "/api/public/bookings/cancel", payload: { ref, email: "driver1@example.com" } })).json();
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.cancellationFeeCents).toBe(0);
  });

  it("validates the driver and the terms, and ignores bots", async () => {
    const young = await book({ ...trip(122), classId: "k-eco", extras: [], driver: { ...driver(), dob: "2010-01-01" }, acceptTerms: true });
    expect(young.statusCode).toBe(400);
    expect(young.json().details.dob).toMatch(/at least/);
    expect((await book({ ...trip(122), classId: "k-eco", extras: [], driver: driver(), acceptTerms: false })).statusCode).toBe(400);
    expect((await book({ ...trip(122), classId: "k-eco", extras: ["x-nope"], driver: driver(), acceptTerms: true })).statusCode).toBe(400);
    const before = (await ctx.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings")).rows[0].n;
    expect((await book({ ...trip(122), classId: "k-eco", extras: [], driver: driver(), acceptTerms: true, website: "spam" })).statusCode).toBe(201);
    expect((await ctx.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings")).rows[0].n).toBe(before);
  });
});

describe("no double booking", () => {
  it("under a rush of simultaneous bookings, exactly as many succeed as there are free cars", async () => {
    const t = trip(200, 3);
    const free = (await availability(t)).classes.find((c) => c.classId === "k-prm")!.available;
    expect(free).toBeGreaterThan(0);
    const results = await Promise.all(Array.from({ length: free + 5 }, (_, i) => book({ ...t, classId: "k-prm", extras: [], driver: driver(100 + i), acceptTerms: true })));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(free);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect((await availability(t)).classes.find((c) => c.classId === "k-prm")!.available).toBe(0);
    // And the database agrees: no two holding bookings of one car overlap.
    const { rows } = await ctx.app.db.query("SELECT a.id FROM bookings a JOIN bookings b ON a.car_id = b.car_id AND a.id < b.id AND a.occupied && b.occupied");
    expect(rows).toHaveLength(0);
  });

  it("the database itself refuses an overlapping booking even if the app were bypassed", async () => {
    const t = trip(230, 2);
    const r = await book({ ...t, classId: "k-van", extras: [], driver: driver(300), acceptTerms: true });
    const b = (await getBooking(ctx.app.db, { ref: r.json().ref }))!;
    const clash = { ...b, id: "b-clash", ref: "RC-CLASH1", pickupAt: new Date(Date.parse(b.pickupAt) + DAY).toISOString(), returnAt: new Date(Date.parse(b.returnAt) + DAY).toISOString() };
    await expect(tx(ctx.app.db, (c) => upsertBooking(c, clash, 2))).rejects.toMatchObject({ code: "23P01" });
  });
});

describe("desk operations", () => {
  it("requires staff login and the CSRF token; agents can't change prices or settings", async () => {
    expect((await ctx.app.inject("/api/staff/fleet")).statusCode).toBe(401);
    const noCsrf = await ctx.app.inject({ method: "POST", url: "/api/staff/maintenance", headers: { cookie: `sid=${agent.cookie}` }, payload: {} });
    expect(noCsrf.statusCode).toBe(403);
    const fleet = (await agent.get("/api/staff/fleet")).json();
    expect((await agent.send("PUT", "/api/staff/settings", fleet.settings)).statusCode).toBe(403);
    expect((await agent.send("PUT", `/api/staff/classes/k-eco`, { ...fleet.classes[0], dailyRateCents: 1 })).statusCode).toBe(403);
    expect((await admin.send("PUT", "/api/staff/settings", { ...fleet.settings, youngDriverAge: 18 })).statusCode).toBe(400);
  });

  it("runs a counter booking through pick-up and a late return with extra charges", async () => {
    // Pick-up soon (check-out is allowed up to 12 h early), at whichever desk has a free car.
    let t = trip(0.05, 1, "l-city");
    let free = (await availability(t)).classes.find((c) => c.available > 0);
    if (!free) {
      t = trip(0.05, 1, "l-airport");
      free = (await availability(t)).classes.find((c) => c.available > 0);
    }
    expect(free).toBeTruthy();
    const created = await agent.send("POST", "/api/staff/bookings", { ...t, classId: free!.classId, extras: ["x-gps"], driver: driver(400) });
    expect(created.statusCode).toBe(201);
    const b = created.json();
    expect(b.source).toBe("Counter");
    const detail = (await agent.get(`/api/staff/bookings/${b.id}`)).json();
    const car = (await agent.get("/api/staff/fleet")).json().cars.find((c: { id: string }) => c.id === detail.booking.carId);
    expect((await agent.send("POST", `/api/staff/bookings/${b.id}/checkout`, { odometer: car.odometer - 1, fuel: 8 })).statusCode).toBe(409);
    const out = await agent.send("POST", `/api/staff/bookings/${b.id}/checkout`, { odometer: car.odometer, fuel: 8 });
    expect(out.json().status).toBe("Active");
    const back = await agent.send("POST", `/api/staff/bookings/${b.id}/checkin`, { odometer: car.odometer + 120, fuel: 6, damage: "", otherChargesCents: 0 });
    expect(back.json().status).toBe("Returned");
    expect(back.json().checkin.fuelChargeCents).toBe(2 * 900);
  });

  it("won't move a booking onto a car that's busy or retire a car with bookings", async () => {
    const t = trip(250, 2);
    const a = (await book({ ...t, classId: "k-suv", extras: [], driver: driver(500), acceptTerms: true })).json();
    const b = (await book({ ...t, classId: "k-suv", extras: [], driver: driver(501), acceptTerms: true })).json();
    const ba = (await getBooking(ctx.app.db, { ref: a.ref }))!;
    const bb = (await getBooking(ctx.app.db, { ref: b.ref }))!;
    const move = await agent.send("POST", `/api/staff/bookings/${ba.id}/change-car`, { carId: bb.carId });
    expect(move.statusCode).toBe(409);
    expect(move.json().message).toMatch(/isn't available/);
    const options = (await agent.get(`/api/staff/bookings/${ba.id}`)).json().options;
    expect(options.find((o: { carId: string }) => o.carId === bb.carId).reason).toBe("booked");
    const fleet = (await admin.get("/api/staff/fleet")).json();
    const car = fleet.cars.find((c: { id: string }) => c.id === ba.carId);
    const retire = await admin.send("PUT", `/api/staff/cars/${car.id}`, { plate: car.plate, make: car.make, model: car.model, year: car.year, classId: car.classId, homeLocationId: car.homeLocationId, odometer: car.odometer, active: false });
    expect(retire.statusCode).toBe(409);
    const clash = await agent.send("POST", "/api/staff/maintenance", { carId: ba.carId, from: ba.pickupAt, to: ba.returnAt, reason: "Service" });
    expect(clash.statusCode).toBe(409);
  });

  it("dashboard, calendar and booking search work on live data", async () => {
    const d = (await agent.get("/api/staff/dashboard?days=30")).json();
    expect(JSON.stringify(d.stats)).not.toMatch(/NaN|null/);
    expect(d.stats.rentals).toBeGreaterThan(10);
    const now = Date.now();
    const cal = (await agent.get(`/api/staff/calendar?from=${now - 2 * DAY}&to=${now + 12 * DAY}`)).json();
    expect(cal.bookings.length).toBeGreaterThan(5);
    const list = (await agent.get("/api/staff/bookings?view=all&q=driver100")).json();
    expect(list.items.every((b: { driver: { name: string } }) => b.driver.name.includes("Driver100"))).toBe(true);
    expect((await agent.get(`/api/staff/calendar?from=${now}&to=${now + 400 * DAY}`)).statusCode).toBe(400);
  });
});
