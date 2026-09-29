import { describe, expect, it } from "vitest";
import { generateDemoData } from "./generate";
import { holdsCar, unavailableReason } from "./rental";
import { actions } from "./actions";

const now = new Date("2026-09-28T12:00:00Z");
const T = now.getTime();
const driver = { name: "Test Driver", email: "T@x.co", phone: "5551234567", licenseNo: "d1234567", dob: "1990-01-01" };

describe("booking actions", () => {
  it("never double-books: keeps booking a class until it's sold out, each on a free car", () => {
    let d = generateDemoData(now);
    const input = { classId: "k-prm", pickupAt: "2026-10-10T09:00:00.000Z", returnAt: "2026-10-12T09:00:00.000Z", pickupLocationId: "l-airport", returnLocationId: "l-airport", extras: [], driver, source: "Web" as const };
    const made: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = actions.create(d, input, T);
      if (!res.ok) {
        expect(res.error).toMatch(/just been taken/);
        break;
      }
      d = res.value.data;
      made.push(res.value.booking.carId);
      expect(res.value.booking.driver.email).toBe("t@x.co");
      expect(res.value.booking.driver.licenseNo).toBe("D1234567");
    }
    expect(new Set(made).size).toBe(made.length);
    // Every booking on those cars still has no overlaps.
    for (const carId of made) {
      const mine = d.bookings.filter((b) => b.carId === carId && holdsCar(b));
      for (const b of mine) {
        const car = d.cars.find((c) => c.id === carId)!;
        expect(unavailableReason(car, { pickupAt: b.pickupAt, returnAt: b.returnAt, pickupLocationId: b.pickupLocationId, returnLocationId: b.returnLocationId, ignoreBookingId: b.id, now: T }, d)).not.toBe("booked");
      }
    }
  });

  it("runs the full lifecycle with correct charges", () => {
    let d = generateDemoData(now);
    const created = actions.create(d, { classId: "k-eco", pickupAt: "2026-09-28T14:00:00.000Z", returnAt: "2026-09-30T14:00:00.000Z", pickupLocationId: "l-city", returnLocationId: "l-city", extras: ["x-gps"], driver, source: "Counter" }, T);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    d = created.value.data;
    const b = created.value.booking;
    expect(b.quote.days).toBe(2);
    expect(b.quote.extrasCents).toBe(1200);
    const odo = d.cars.find((c) => c.id === b.carId)!.odometer;
    expect(actions.checkout(d, b.id, { odometer: odo - 1, fuel: 8 }, T).ok).toBe(false);
    const out = actions.checkout(d, b.id, { odometer: odo, fuel: 8 }, T);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    d = out.value;
    const back = actions.checkin(d, b.id, { odometer: odo + 300, fuel: 7, damage: "", otherChargesCents: 0 }, Date.parse("2026-09-30T16:30:00Z"));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const done = back.value.bookings.find((x) => x.id === b.id)!;
    expect(done.status).toBe("Returned");
    expect(done.checkin!.lateDays).toBe(1);
    expect(done.checkin!.fuelChargeCents).toBe(900);
    // Late day = daily rate + the GPS it kept (600/day) + fuel.
    expect(done.checkin!.finalTotalCents).toBe(b.quote.totalCents + Math.round((3900 + 600 + 900) * 1.1));
    expect(back.value.cars.find((c) => c.id === b.carId)!.odometer).toBe(odo + 300);
  });

  it("won't hand over a car that the previous renter hasn't returned", () => {
    let d = generateDemoData(now);
    const first = actions.create(d, { classId: "k-eco", pickupAt: "2026-09-28T13:00:00.000Z", returnAt: "2026-09-28T15:00:00.000Z", pickupLocationId: "l-city", returnLocationId: "l-city", extras: [], driver, source: "Counter" }, T);
    if (!first.ok) throw new Error(first.error);
    d = first.value.data;
    const carId = first.value.booking.carId;
    const odo = d.cars.find((c) => c.id === carId)!.odometer;
    const out = actions.checkout(d, first.value.booking.id, { odometer: odo, fuel: 8 }, T);
    if (!out.ok) throw new Error(out.error);
    // Simulate a second booking that was put on the same car for later that day.
    const second = { ...first.value.booking, id: "b-second", ref: "RC-SECOND", status: "Reserved" as const, pickupAt: "2026-09-28T19:00:00.000Z", returnAt: "2026-09-29T19:00:00.000Z", checkout: undefined };
    d = { ...out.value, bookings: [...out.value.bookings, second] };
    const res = actions.checkout(d, "b-second", { odometer: odo, fuel: 8 }, Date.parse("2026-09-28T19:00:00Z"));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/still out on booking/);
  });

  it("charges a day for late cancellation only", () => {
    const d = generateDemoData(now);
    const soon = d.bookings.find((b) => b.status === "Reserved" && Date.parse(b.pickupAt) - T < 24 * 3_600_000)!;
    const later = d.bookings.find((b) => b.status === "Reserved" && Date.parse(b.pickupAt) - T > 72 * 3_600_000)!;
    const r1 = actions.cancel(d, soon.id, T);
    const r2 = actions.cancel(d, later.id, T);
    expect(r1.ok && r1.value.bookings.find((b) => b.id === soon.id)!.cancellationFeeCents).toBe(Math.round(soon.quote.dailyRateCents * 1.1));
    expect(r2.ok && r2.value.bookings.find((b) => b.id === later.id)!.cancellationFeeCents).toBe(0);
    expect(actions.noShow(d, later.id, T).ok).toBe(false);
  });

  it("refuses maintenance that clashes with a booking", () => {
    const d = generateDemoData(now);
    const b = d.bookings.find((x) => x.status === "Reserved")!;
    const res = actions.addMaintenance(d, { id: "m", carId: b.carId, from: b.pickupAt, to: b.returnAt, reason: "x" }, T);
    expect(res.ok).toBe(false);
  });
});
