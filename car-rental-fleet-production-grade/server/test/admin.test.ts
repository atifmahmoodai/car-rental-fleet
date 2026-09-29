import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_ADMIN, DEMO_AGENT } from "../src/seed";
import { login, makeApp, type Agent, type TestCtx } from "./helpers";

let ctx: TestCtx;
let admin: Agent;
beforeAll(async () => {
  ctx = await makeApp();
  admin = await login(ctx.app, DEMO_ADMIN);
});
afterAll(() => ctx.close());

const quoteFor = async (classId: string) => {
  const p = new Date(Date.now() + 200 * 86_400_000);
  p.setUTCHours(10, 0, 0, 0);
  const q = new URLSearchParams({ pickupAt: p.toISOString(), returnAt: new Date(p.getTime() + 2 * 86_400_000).toISOString(), pickupLocationId: "l-airport", returnLocationId: "l-airport" });
  const r = (await ctx.app.inject(`/api/public/availability?${q}`)).json() as { classes: { classId: string; quote: { baseCents: number } }[] };
  return r.classes.find((c) => c.classId === classId)!.quote.baseCents;
};

describe("admin", () => {
  it("price changes reach the public catalog and new quotes", async () => {
    const fleet = (await admin.get("/api/staff/fleet")).json();
    const eco = fleet.classes.find((c: { id: string }) => c.id === "k-eco");
    const { id, ...body } = eco;
    const res = await admin.send("PUT", `/api/staff/classes/${id}`, { ...body, dailyRateCents: 4321 });
    expect(res.statusCode).toBe(200);
    const catalog = (await ctx.app.inject("/api/public/catalog")).json();
    expect(catalog.classes.find((c: { id: string }) => c.id === "k-eco").dailyRateCents).toBe(4321);
    expect(await quoteFor("k-eco")).toBe(2 * 4321);
    expect((await admin.send("PUT", `/api/staff/classes/${id}`, { ...body, dailyRateCents: 0 })).statusCode).toBe(400);
    await admin.send("PUT", `/api/staff/classes/${id}`, body);
  });

  it("settings are validated and saved", async () => {
    const { settings } = (await admin.get("/api/staff/fleet")).json();
    const bad = await admin.send("PUT", "/api/staff/settings", { ...settings, currency: "usd", email: "nope" });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().details)).toEqual(expect.arrayContaining(["currency", "email"]));
    expect((await admin.send("PUT", "/api/staff/settings", { ...settings, taxPercent: 12.5 })).statusCode).toBe(200);
    expect((await ctx.app.inject("/api/public/catalog")).json().settings.taxPercent).toBe(12.5);
    await admin.send("PUT", "/api/staff/settings", settings);
  });

  it("duplicate plates are refused with a clear message, whatever the spacing or case", async () => {
    const { cars } = (await admin.get("/api/staff/fleet")).json();
    const c = cars[0];
    const res = await admin.send("POST", "/api/staff/cars", {
      plate: ` ${c.plate.replace(/\s/g, "").toLowerCase()} `,
      make: "Kia",
      model: "Picanto",
      year: 2024,
      classId: c.classId,
      homeLocationId: c.homeLocationId,
      odometer: 10,
      active: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/plate is already in the fleet/);
  });

  it("manages staff logins: roles, weak passwords, disabling, and always one admin", async () => {
    const weak = await admin.send("POST", "/api/staff/users", { email: "temp@example.com", name: "Temp Agent", role: "agent", password: "short" });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().details.password).toBeTruthy();
    const created = await admin.send("POST", "/api/staff/users", { email: "Temp@Example.com", name: "Temp Agent", role: "agent", password: "a-strong-pass-42" });
    expect(created.statusCode).toBe(201);
    expect((await admin.send("POST", "/api/staff/users", { email: "temp@example.com", name: "Dup", role: "agent", password: "a-strong-pass-42" })).statusCode).toBe(409);
    const temp = await login(ctx.app, "temp@example.com", "a-strong-pass-42");
    expect((await temp.get("/api/staff/users")).statusCode).toBe(403);

    const { items } = (await admin.get("/api/staff/users")).json() as { items: { id: string; email: string; role: string }[] };
    const tempId = items.find((u) => u.email === "temp@example.com")!.id;
    expect((await admin.send("PUT", `/api/staff/users/${tempId}`, { name: "Temp Agent", role: "agent", active: false })).statusCode).toBe(200);
    // Disabling signs them out everywhere.
    expect((await temp.get("/api/staff/fleet")).statusCode).toBe(401);

    const adminId = items.find((u) => u.email === DEMO_ADMIN)!.id;
    const demote = await admin.send("PUT", `/api/staff/users/${adminId}`, { name: "Demo Admin", role: "agent", active: true });
    expect(demote.statusCode).toBe(400);
    expect(demote.json().message).toMatch(/own admin access|at least one active admin/);
  });

  it("locks an account after repeated wrong passwords", async () => {
    const attempt = (password: string) =>
      ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: DEMO_AGENT, password }, remoteAddress: "10.9.9.9" });
    for (let i = 0; i < 5; i++) expect((await attempt("wrong-password-9")).statusCode).toBe(401);
    expect((await attempt("demo-password-1")).statusCode).toBe(423);
    // An admin password reset unlocks it.
    const { items } = (await admin.get("/api/staff/users")).json() as { items: { id: string; email: string; locked: boolean }[] };
    const agentRow = items.find((u) => u.email === DEMO_AGENT)!;
    expect(agentRow.locked).toBe(true);
    expect((await admin.send("POST", `/api/staff/users/${agentRow.id}/password`, { password: "demo-password-1" })).statusCode).toBe(200);
    expect((await attempt("demo-password-1")).statusCode).toBe(200);
  });

  it("records who did what in the activity log", async () => {
    const log = (await admin.get("/api/staff/audit")).json() as { items: { action: string }[] };
    const actions = log.items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["class.update", "settings.update", "user.create", "user.update"]));
  });
});
