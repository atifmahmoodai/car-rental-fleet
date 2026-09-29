import { describe, expect, it } from "vitest";
import { CLASSES, DEFAULT_SETTINGS, EXTRAS, generateDemoData } from "./generate";
import type { Booking, Car, RentalData } from "./types";
import { ageOn, assignCar, availableCars, holdsCar, locationAt, quote, rentalDays, settleReturn, unavailableReason, utilisation, validateDates, validateDriver } from "./rental";

const S = DEFAULT_SETTINGS;
const eco = CLASSES[0];
const at = (s: string) => new Date(s).toISOString();

describe("rental days", () => {
  it("charges every started 24 h after a grace period", () => {
    expect(rentalDays(at("2026-10-01T10:00Z"), at("2026-10-02T10:00Z"), 59)).toBe(1);
    expect(rentalDays(at("2026-10-01T10:00Z"), at("2026-10-02T10:59Z"), 59)).toBe(1);
    expect(rentalDays(at("2026-10-01T10:00Z"), at("2026-10-02T11:00Z"), 59)).toBe(2);
    expect(rentalDays(at("2026-10-01T10:00Z"), at("2026-10-01T12:00Z"), 59)).toBe(1);
    expect(rentalDays(at("2026-10-01T10:00Z"), at("2026-10-01T09:00Z"), 59)).toBe(0);
  });
  it("computes age correctly around birthdays", () => {
    expect(ageOn("2000-10-05", at("2026-10-04T12:00Z"))).toBe(25);
    expect(ageOn("2000-10-05", at("2026-10-05T12:00Z"))).toBe(26);
    expect(ageOn("2004-02-29", at("2026-02-28T12:00Z"))).toBe(21);
  });
});

describe("quote", () => {
  const base = { cls: eco, pickupLocationId: "a", returnLocationId: "a", extras: [] as typeof EXTRAS };
  it("prices a simple rental with tax", () => {
    const q = quote({ ...base, pickupAt: at("2026-10-01T10:00Z"), returnAt: at("2026-10-04T10:00Z") }, S);
    expect(q.days).toBe(3);
    expect(q.baseCents).toBe(11700);
    expect(q.discountCents).toBe(0);
    expect(q.taxCents).toBe(1170);
    expect(q.totalCents).toBe(12870);
  });
  it("applies weekly/monthly discounts, capped extras, young-driver and one-way fees", () => {
    const q = quote(
      { ...base, returnLocationId: "b", pickupAt: at("2026-10-01T10:00Z"), returnAt: at("2026-10-11T10:00Z"), extras: EXTRAS.filter((e) => e.id === "x-seat" || e.id === "x-ins"), driverDob: "2003-01-01" },
      S,
    );
    expect(q.days).toBe(10);
    expect(q.discountPercent).toBe(15);
    expect(q.discountCents).toBe(Math.round(39000 * 0.15));
    expect(q.extrasCents).toBe(5600 + 18000); // child seat capped at 56
    expect(q.youngDriverCents).toBe(15000);
    expect(q.oneWayFeeCents).toBe(4500);
    expect(q.totalCents).toBe(q.subtotalCents + q.taxCents);
    expect(quote({ ...base, pickupAt: at("2026-10-01T10:00Z"), returnAt: at("2026-10-29T10:00Z") }, S).discountPercent).toBe(30);
  });
});

describe("availability", () => {
  const car: Car = { id: "c1", plate: "X", make: "T", model: "Y", year: 2025, classId: eco.id, homeLocationId: "a", odometer: 0, active: true };
  const bk = (id: string, p: string, r: string, extra: Partial<Booking> = {}): Booking => ({
    id, ref: id, carId: "c1", classId: eco.id, pickupLocationId: "a", returnLocationId: "a", pickupAt: at(p), returnAt: at(r),
    driver: { name: "A B", email: "a@b.co", phone: "1234567", licenseNo: "12345", dob: "1990-01-01" }, extras: [],
    quote: quote({ cls: eco, pickupAt: at(p), returnAt: at(r), pickupLocationId: "a", returnLocationId: "a", extras: [] }, S),
    status: "Reserved", source: "Web", createdAt: at("2026-09-01T00:00Z"), ...extra,
  });
  const data = (bookings: Booking[], maintenance: RentalData["maintenance"] = []) => ({ bookings, maintenance, settings: S });
  const req = (p: string, r: string, pl = "a", rl = "a") => ({ pickupAt: at(p), returnAt: at(r), pickupLocationId: pl, returnLocationId: rl, now: Date.parse("2026-09-28T12:00Z") });

  it("respects overlaps and the cleaning buffer on both sides", () => {
    const d = data([bk("b1", "2026-10-05T10:00Z", "2026-10-07T10:00Z")]);
    expect(unavailableReason(car, req("2026-10-06T10:00Z", "2026-10-08T10:00Z"), d)).toBe("booked");
    expect(unavailableReason(car, req("2026-10-07T11:00Z", "2026-10-08T10:00Z"), d)).toBe("booked"); // inside 2 h buffer
    expect(unavailableReason(car, req("2026-10-07T12:00Z", "2026-10-08T10:00Z"), d)).toBeNull();
    expect(unavailableReason(car, req("2026-10-03T10:00Z", "2026-10-05T09:00Z"), d)).toBe("booked"); // our buffer hits their pickup
    expect(unavailableReason(car, req("2026-10-03T10:00Z", "2026-10-05T08:00Z"), d)).toBeNull();
  });
  it("ignores cancelled bookings and the booking being edited", () => {
    const d = data([bk("b1", "2026-10-05T10:00Z", "2026-10-07T10:00Z", { status: "Cancelled" })]);
    expect(unavailableReason(car, req("2026-10-06T10:00Z", "2026-10-08T10:00Z"), d)).toBeNull();
    const d2 = data([bk("b1", "2026-10-05T10:00Z", "2026-10-07T10:00Z")]);
    expect(unavailableReason(car, { ...req("2026-10-06T10:00Z", "2026-10-08T10:00Z"), ignoreBookingId: "b1" }, d2)).toBeNull();
  });
  it("blocks maintenance and overdue cars", () => {
    expect(unavailableReason(car, req("2026-10-06T10:00Z", "2026-10-08T10:00Z"), data([], [{ id: "m", carId: "c1", from: at("2026-10-07T00:00Z"), to: at("2026-10-09T00:00Z"), reason: "" }]))).toBe("maintenance");
    const overdue = bk("b1", "2026-09-20T10:00Z", "2026-09-27T10:00Z", { status: "Active", checkout: { at: at("2026-09-20T10:00Z"), odometer: 0, fuel: 8 } });
    expect(unavailableReason(car, req("2026-09-28T13:00Z", "2026-09-30T10:00Z"), data([overdue]))).toBe("booked");
    expect(unavailableReason(car, req("2026-09-28T15:00Z", "2026-09-30T10:00Z"), data([overdue]))).toBeNull();
  });
  it("follows the car's location after one-way rentals", () => {
    const oneWay = bk("b1", "2026-10-01T10:00Z", "2026-10-03T10:00Z", { returnLocationId: "b" });
    const d = data([oneWay]);
    expect(locationAt(car, d.bookings, Date.parse("2026-10-04T00:00Z"))).toBe("b");
    expect(unavailableReason(car, req("2026-10-05T10:00Z", "2026-10-06T10:00Z", "a"), d)).toBe("wrong location");
    expect(unavailableReason(car, req("2026-10-05T10:00Z", "2026-10-06T10:00Z", "b", "b"), d)).toBeNull();
    // A one-way that would strand the car away from its next pickup is refused.
    const later = data([bk("b2", "2026-10-10T10:00Z", "2026-10-12T10:00Z")]);
    expect(unavailableReason(car, req("2026-10-05T10:00Z", "2026-10-06T10:00Z", "a", "b"), later)).toBe("needed elsewhere next");
  });
});

describe("validation & settlement", () => {
  it("validates dates and drivers", () => {
    const now = Date.parse("2026-09-28T12:00Z");
    expect(validateDates(at("2026-09-27T10:00Z"), at("2026-09-29T10:00Z"), now)).toMatch(/past/);
    expect(validateDates(at("2026-10-01T10:00Z"), at("2026-10-01T10:30Z"), now)).toMatch(/hour/);
    expect(validateDates(at("2026-10-01T10:00Z"), at("2027-01-30T10:00Z"), now)).toMatch(/90 days/);
    expect(validateDates(at("2026-10-01T10:00Z"), at("2026-10-03T10:00Z"), now)).toBeUndefined();
    const ok = { name: "Ann Lee", email: "ann@x.co", phone: "5551234", licenseNo: "D12345", dob: "1990-05-05" };
    expect(validateDriver(ok, at("2026-10-01T10:00Z"), S)).toEqual({});
    expect(validateDriver({ ...ok, dob: "2006-01-01" }, at("2026-10-01T10:00Z"), S).dob).toMatch(/at least 21/);
    expect(Object.keys(validateDriver({ name: "Ann", email: "x", phone: "1", licenseNo: "1", dob: "" }, at("2026-10-01T10:00Z"), S)).sort()).toEqual(["dob", "email", "licenseNo", "name", "phone"]);
  });
  it("charges late days and missing fuel at return", () => {
    const q = quote({ cls: eco, pickupAt: at("2026-10-01T10:00Z"), returnAt: at("2026-10-03T10:00Z"), pickupLocationId: "a", returnLocationId: "a", extras: [] }, S);
    const b = { quote: q, pickupAt: at("2026-10-01T10:00Z"), checkout: { at: at("2026-10-01T10:00Z"), odometer: 0, fuel: 8 } } as Booking;
    const onTime = settleReturn(b, { at: at("2026-10-03T10:30Z"), fuel: 8, otherChargesCents: 0 }, S);
    expect(onTime).toEqual({ lateDays: 0, lateCents: 0, fuelChargeCents: 0, finalTotalCents: q.totalCents });
    const late = settleReturn(b, { at: at("2026-10-03T14:00Z"), fuel: 6, otherChargesCents: 0 }, S);
    expect(late.lateDays).toBe(1);
    expect(late.fuelChargeCents).toBe(1800);
    expect(late.finalTotalCents).toBe(q.totalCents + Math.round((3900 + 1800) * 1.1));
  });
});

describe("demo data", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const data = generateDemoData(now);

  it("is deterministic and never double-books a car", () => {
    expect(generateDemoData(now)).toEqual(data);
    for (const car of data.cars) {
      const mine = data.bookings.filter((b) => b.carId === car.id && holdsCar(b)).sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
      for (let i = 1; i < mine.length; i++) {
        const prevEnd = Date.parse(mine[i - 1].checkin?.at ?? mine[i - 1].returnAt);
        expect(Date.parse(mine[i].pickupAt) - prevEnd, `${car.id} ${mine[i].ref}`).toBeGreaterThanOrEqual(S.bufferHours * 3_600_000);
        expect(mine[i].pickupLocationId, `${car.id} location chain`).toBe(mine[i - 1].returnLocationId);
      }
      for (const m of data.maintenance.filter((x) => x.carId === car.id)) {
        expect(mine.some((b) => Date.parse(b.pickupAt) < Date.parse(m.to) && Date.parse(m.from) < Date.parse(b.checkin?.at ?? b.returnAt))).toBe(false);
      }
    }
  });

  it("has statuses consistent with time", () => {
    const t = now.getTime();
    const refs = new Set<string>();
    for (const b of data.bookings) {
      expect(refs.has(b.ref)).toBe(false);
      refs.add(b.ref);
      expect(Date.parse(b.createdAt)).toBeLessThanOrEqual(t);
      if (b.status === "Returned") expect(Date.parse(b.checkin!.at)).toBeLessThanOrEqual(t);
      if (b.status === "Active") expect(Date.parse(b.pickupAt)).toBeLessThanOrEqual(t);
      if (b.status === "Reserved") expect(Date.parse(b.pickupAt)).toBeGreaterThan(t);
      if (b.status === "No-show") expect(Date.parse(b.pickupAt)).toBeLessThan(t);
    }
    expect(data.bookings.filter((b) => b.status === "Active").length).toBeGreaterThan(5);
  });

  it("gives realistic utilisation and lets the booking engine find cars", () => {
    const u = utilisation(data, "2026-08-01T00:00:00Z", "2026-09-28T00:00:00Z");
    expect(u.rate).toBeGreaterThan(0.5);
    expect(u.rate).toBeLessThan(0.95);
    const req = { pickupAt: "2026-10-20T10:00:00.000Z", returnAt: "2026-10-23T10:00:00.000Z", pickupLocationId: "l-airport", returnLocationId: "l-airport", now: now.getTime() };
    const cars = availableCars(req, data);
    expect(cars.length).toBeGreaterThan(0);
    const picked = assignCar(req, data, cars[0].classId)!;
    expect(unavailableReason(picked, req, data)).toBeNull();
  });
});

describe("desk time zone", () => {
  it("reads and shows times in the desks' zone, whatever the device's zone", async () => {
    const f = await import("./format");
    f.setDeskTimeZone("Asia/Karachi"); // UTC+5, no daylight saving
    expect(f.fromLocalInput("2026-10-01T10:00")).toBe("2026-10-01T05:00:00.000Z");
    expect(f.toLocalInput("2026-10-01T05:00:00.000Z")).toBe("2026-10-01T10:00");
    f.setDeskTimeZone("America/New_York");
    // Across the November daylight-saving change: 10:00 is UTC-4 before and UTC-5 after.
    expect(f.fromLocalInput("2026-10-31T10:00")).toBe("2026-10-31T14:00:00.000Z");
    expect(f.fromLocalInput("2026-11-02T10:00")).toBe("2026-11-02T15:00:00.000Z");
    expect(new Date(f.deskDayStart(Date.parse("2026-11-02T03:00:00Z"))).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    f.setDeskTimeZone("UTC");
  });
});
