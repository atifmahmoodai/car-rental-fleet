// Booking state transitions: pure functions of (data, input, now) → new data or an error.
// The browser demo ran them against localStorage; the server runs them against the rows it has
// locked for the request and saves whatever changed.
import { assignCar, bookingRef, canCancelFree, quote, settleReturn, unavailableReason, validateDates, validateDriver } from "./rental";
import type { Booking, Driver, Maintenance, RentalData } from "./types";

export const newId = (p: string) => `${p}-${crypto.randomUUID()}`;

export interface NewBookingInput {
  classId: string;
  pickupAt: string;
  returnAt: string;
  pickupLocationId: string;
  returnLocationId: string;
  extras: string[];
  driver: Driver;
  source: Booking["source"];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Pure state transitions, exported for tests. */
export const actions = {
  create(d: RentalData, input: NewBookingInput, now: number): Result<{ data: RentalData; booking: Booking }> {
    const cls = d.classes.find((c) => c.id === input.classId);
    if (!cls) return { ok: false, error: "Unknown car class." };
    const dateError = validateDates(input.pickupAt, input.returnAt, now);
    if (dateError) return { ok: false, error: dateError };
    const driverErrors = Object.values(validateDriver(input.driver, input.pickupAt, d.settings));
    if (driverErrors.length) return { ok: false, error: driverErrors[0]! };
    if (!d.locations.some((l) => l.id === input.pickupLocationId) || !d.locations.some((l) => l.id === input.returnLocationId)) return { ok: false, error: "Unknown location." };
    const req = { pickupAt: input.pickupAt, returnAt: input.returnAt, pickupLocationId: input.pickupLocationId, returnLocationId: input.returnLocationId, now };
    const car = assignCar(req, d, cls.id);
    if (!car) return { ok: false, error: `Sorry, the last ${cls.name} for these dates has just been taken. Please choose another class.` };
    const booking: Booking = {
      id: newId("b"),
      ref: bookingRef(new Set(d.bookings.map((b) => b.ref))),
      carId: car.id,
      classId: cls.id,
      pickupLocationId: input.pickupLocationId,
      returnLocationId: input.returnLocationId,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      driver: { ...input.driver, name: input.driver.name.trim(), email: input.driver.email.trim().toLowerCase(), licenseNo: input.driver.licenseNo.trim().toUpperCase() },
      extras: input.extras,
      quote: quote({ ...req, cls, extras: d.extras.filter((e) => input.extras.includes(e.id)), driverDob: input.driver.dob }, d.settings),
      status: "Reserved",
      source: input.source,
      createdAt: new Date(now).toISOString(),
    };
    return { ok: true, value: { data: { ...d, bookings: [...d.bookings, booking] }, booking } };
  },
  cancel(d: RentalData, id: string, now: number): Result<RentalData> {
    const b = d.bookings.find((x) => x.id === id);
    if (!b || b.status !== "Reserved") return { ok: false, error: "Only reserved bookings can be cancelled." };
    const fee = canCancelFree(b, now, d.settings) ? 0 : Math.round(b.quote.dailyRateCents * (1 + d.settings.taxPercent / 100));
    return { ok: true, value: patch(d, id, { status: "Cancelled", cancelledAt: new Date(now).toISOString(), cancellationFeeCents: fee }) };
  },
  noShow(d: RentalData, id: string, now: number): Result<RentalData> {
    const b = d.bookings.find((x) => x.id === id);
    if (!b || b.status !== "Reserved") return { ok: false, error: "Only reserved bookings can be marked as no-show." };
    if (Date.parse(b.pickupAt) > now) return { ok: false, error: "The pick-up time hasn't passed yet." };
    return { ok: true, value: patch(d, id, { status: "No-show" }) };
  },
  checkout(d: RentalData, id: string, h: { odometer: number; fuel: number }, now: number): Result<RentalData> {
    const b = d.bookings.find((x) => x.id === id);
    if (!b || b.status !== "Reserved") return { ok: false, error: "This booking can't be checked out." };
    const car = d.cars.find((c) => c.id === b.carId);
    if (!(h.odometer >= (car?.odometer ?? 0))) return { ok: false, error: `Odometer can't be below the last reading (${car?.odometer}).` };
    if (!(h.fuel >= 0 && h.fuel <= 8)) return { ok: false, error: "Fuel must be 0–8 eighths." };
    if (Date.parse(b.pickupAt) - now > 12 * 3_600_000) return { ok: false, error: "Too early: pick-up is more than 12 hours away." };
    // The previous renter may be overdue with this very car.
    const stillOut = d.bookings.find((x) => x.carId === b.carId && x.status === "Active" && x.id !== b.id);
    if (stillOut) return { ok: false, error: `${car?.plate ?? "This car"} is still out on booking ${stillOut.ref}. Move this booking to another car first.` };
    const next = patch(d, id, { status: "Active", checkout: { at: new Date(now).toISOString(), odometer: h.odometer, fuel: h.fuel } });
    return { ok: true, value: { ...next, cars: next.cars.map((c) => (c.id === b.carId ? { ...c, odometer: h.odometer } : c)) } };
  },
  checkin(d: RentalData, id: string, r: { odometer: number; fuel: number; damage: string; otherChargesCents: number }, now: number): Result<RentalData> {
    const b = d.bookings.find((x) => x.id === id);
    if (!b || b.status !== "Active" || !b.checkout) return { ok: false, error: "This booking isn't out on rent." };
    if (!(r.odometer >= b.checkout.odometer)) return { ok: false, error: `Odometer can't be below the pick-up reading (${b.checkout.odometer}).` };
    if (!(r.fuel >= 0 && r.fuel <= 8)) return { ok: false, error: "Fuel must be 0–8 eighths." };
    if (!(r.otherChargesCents >= 0)) return { ok: false, error: "Other charges can't be negative." };
    const at = new Date(now).toISOString();
    const s = settleReturn(b, { at, fuel: r.fuel, otherChargesCents: r.otherChargesCents }, d.settings, d.extras);
    const next = patch(d, id, {
      status: "Returned",
      checkin: { at, odometer: r.odometer, fuel: r.fuel, damage: r.damage.trim(), lateDays: s.lateDays, fuelChargeCents: s.fuelChargeCents, otherChargesCents: r.otherChargesCents, finalTotalCents: s.finalTotalCents },
    });
    return { ok: true, value: { ...next, cars: next.cars.map((c) => (c.id === b.carId ? { ...c, odometer: r.odometer } : c)) } };
  },
  changeCar(d: RentalData, id: string, carId: string, now: number): Result<RentalData> {
    const b = d.bookings.find((x) => x.id === id);
    const car = d.cars.find((c) => c.id === carId);
    if (!b || !car || b.status !== "Reserved") return { ok: false, error: "Only reserved bookings can be moved to another car." };
    const why = unavailableReason(car, { pickupAt: b.pickupAt, returnAt: b.returnAt, pickupLocationId: b.pickupLocationId, returnLocationId: b.returnLocationId, ignoreBookingId: b.id, now }, d);
    if (why) return { ok: false, error: `${car.plate} isn't available (${why}).` };
    return { ok: true, value: patch(d, id, { carId, classId: car.classId }) };
  },
  addMaintenance(d: RentalData, m: Maintenance, now: number): Result<RentalData> {
    const f = Date.parse(m.from);
    const t = Date.parse(m.to);
    if (!(t > f)) return { ok: false, error: "The end must be after the start." };
    const car = d.cars.find((c) => c.id === m.carId);
    if (!car) return { ok: false, error: "Unknown car." };
    const clash = d.bookings.find(
      (b) => b.carId === m.carId && (b.status === "Reserved" || b.status === "Active") && Date.parse(b.pickupAt) < t && f < Math.max(Date.parse(b.returnAt), b.status === "Active" ? now : 0),
    );
    if (clash) return { ok: false, error: `Clashes with booking ${clash.ref}. Move that booking to another car first.` };
    return { ok: true, value: { ...d, maintenance: [...d.maintenance, m] } };
  },
};

function patch(d: RentalData, id: string, p: Partial<Booking>): RentalData {
  return { ...d, bookings: d.bookings.map((b) => (b.id === id ? { ...b, ...p } : b)) };
}

