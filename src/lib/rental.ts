// Core rental rules: rental days, pricing, availability and car assignment.
// Everything here is pure and unit-tested; the UI only calls into it.
import type { Booking, Car, CarClass, Driver, Extra, Quote, RentalData, Settings } from "../types";

const HOUR = 3_600_000;
const MIN = 60_000;

/** Bookings that hold a car (cancelled and no-show ones don't). */
export const holdsCar = (b: Booking) => b.status === "Reserved" || b.status === "Active" || b.status === "Returned";

/** Charged days: every started 24 h counts, after a grace period. Minimum 1. */
export function rentalDays(pickupAt: string, returnAt: string, graceMinutes: number): number {
  const minutes = (Date.parse(returnAt) - Date.parse(pickupAt)) / MIN;
  if (!(minutes > 0)) return 0;
  return Math.max(1, Math.ceil((minutes - graceMinutes) / 1440));
}

/** Age in whole years on a given date. */
export function ageOn(dob: string, onIso: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  const on = new Date(onIso);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age--;
  return age;
}

export interface QuoteInput {
  cls: CarClass;
  pickupAt: string;
  returnAt: string;
  pickupLocationId: string;
  returnLocationId: string;
  extras: Extra[];
  driverDob?: string;
}

export function quote(q: QuoteInput, s: Settings): Quote {
  const days = rentalDays(q.pickupAt, q.returnAt, s.graceMinutes);
  const baseCents = days * q.cls.dailyRateCents;
  const discountPercent = days >= 28 ? s.monthlyDiscountPercent : days >= 7 ? s.weeklyDiscountPercent : 0;
  const discountCents = Math.round((baseCents * discountPercent) / 100);
  const extrasCents = q.extras.reduce((sum, e) => sum + Math.min(e.perDayCents * days, e.maxCents ?? Infinity), 0);
  const young = q.driverDob ? ageOn(q.driverDob, q.pickupAt) < s.youngDriverAge : false;
  const youngDriverCents = young ? s.youngDriverFeePerDayCents * days : 0;
  const oneWayFeeCents = q.pickupLocationId !== q.returnLocationId ? s.oneWayFeeCents : 0;
  const subtotalCents = baseCents - discountCents + extrasCents + youngDriverCents + oneWayFeeCents;
  const taxCents = Math.round((subtotalCents * s.taxPercent) / 100);
  return {
    days,
    dailyRateCents: q.cls.dailyRateCents,
    baseCents,
    discountPercent,
    discountCents,
    extrasCents,
    youngDriverCents,
    oneWayFeeCents,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    depositCents: q.cls.depositCents,
  };
}

/**
 * Time a booking really occupies the car, plus cleaning buffer: until the actual return if it
 * came back, and for a car that's out and overdue, at least until now (it isn't back yet).
 */
function occupied(b: Booking, bufferHours: number, now: number): [number, number] {
  const start = Date.parse(b.checkout?.at ?? b.pickupAt);
  let end = Date.parse(b.checkin?.at ?? b.returnAt);
  if (b.status === "Active" && !b.checkin) end = Math.max(end, now);
  return [start, end + bufferHours * HOUR];
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** Where the car will be at time `t`: the return location of its last rental that ended before t, else its home. */
export function locationAt(car: Car, bookings: Booking[], t: number): string {
  let last: Booking | undefined;
  for (const b of bookings) {
    if (b.carId !== car.id || !holdsCar(b)) continue;
    if (Date.parse(b.checkin?.at ?? b.returnAt) <= t && (!last || Date.parse(b.returnAt) > Date.parse(last.returnAt))) last = b;
  }
  return last ? last.returnLocationId : car.homeLocationId;
}

export interface AvailabilityRequest {
  pickupAt: string;
  returnAt: string;
  pickupLocationId: string;
  returnLocationId: string;
  /** Booking being edited, so it doesn't conflict with itself. */
  ignoreBookingId?: string;
  /** Current time (for overdue cars); defaults to Date.now(). */
  now?: number;
}

/** Why a car can't take a request, or null when it can. */
export function unavailableReason(car: Car, req: AvailabilityRequest, data: Pick<RentalData, "bookings" | "maintenance" | "settings">): string | null {
  if (!car.active) return "inactive";
  const p = Date.parse(req.pickupAt);
  const r = Date.parse(req.returnAt);
  if (!(r > p)) return "invalid dates";
  const buf = data.settings.bufferHours * HOUR;
  const mine = data.bookings.filter((b) => b.carId === car.id && holdsCar(b) && b.id !== req.ignoreBookingId);

  for (const b of mine) {
    const [s, e] = occupied(b, data.settings.bufferHours, req.now ?? Date.now());
    // Our own rental also needs its cleaning buffer before the next customer.
    if (overlaps(p, r + buf, s, e)) return "booked";
  }
  for (const m of data.maintenance) {
    if (m.carId === car.id && overlaps(p, r, Date.parse(m.from), Date.parse(m.to))) return "maintenance";
  }
  if (locationAt(car, mine, p) !== req.pickupLocationId) return "wrong location";
  // A one-way return must not strand the car away from its next pickup.
  const next = mine.filter((b) => Date.parse(b.pickupAt) >= r).sort((a, b) => Date.parse(a.pickupAt) - Date.parse(b.pickupAt))[0];
  if (next && next.pickupLocationId !== req.returnLocationId) return "needed elsewhere next";
  return null;
}

export function availableCars(req: AvailabilityRequest, data: RentalData, classId?: string): Car[] {
  return data.cars.filter((c) => (!classId || c.classId === classId) && unavailableReason(c, req, data) === null);
}

/** Picks the car in a class with the most idle time before this rental, to keep the fleet evenly used. */
export function assignCar(req: AvailabilityRequest, data: RentalData, classId: string): Car | undefined {
  const cars = availableCars(req, data, classId);
  const p = Date.parse(req.pickupAt);
  const lastEnd = (c: Car) =>
    Math.max(0, ...data.bookings.filter((b) => b.carId === c.id && holdsCar(b) && Date.parse(b.returnAt) <= p).map((b) => Date.parse(b.returnAt)));
  return cars.sort((a, b) => lastEnd(a) - lastEnd(b) || a.odometer - b.odometer)[0];
}

export interface BookingRequestErrors {
  dates?: string;
  name?: string;
  email?: string;
  phone?: string;
  licenseNo?: string;
  dob?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateDates(pickupAt: string, returnAt: string, now: number): string | undefined {
  const p = Date.parse(pickupAt);
  const r = Date.parse(returnAt);
  if (!Number.isFinite(p) || !Number.isFinite(r)) return "Choose pick-up and return times.";
  if (p < now - 5 * MIN) return "Pick-up can't be in the past.";
  if (r - p < HOUR) return "Return must be at least an hour after pick-up.";
  if (r - p > 90 * 24 * HOUR) return "Rentals are limited to 90 days; contact us for long-term leasing.";
  return undefined;
}

export function validateDriver(d: Driver, pickupAt: string, s: Settings): BookingRequestErrors {
  const e: BookingRequestErrors = {};
  if (d.name.trim().split(/\s+/).length < 2) e.name = "Enter first and last name as on the licence.";
  if (!EMAIL_RE.test(d.email.trim())) e.email = "Enter a valid email; we send the confirmation there.";
  if (d.phone.replace(/\D/g, "").length < 7) e.phone = "Enter a phone number.";
  if (d.licenseNo.trim().length < 5) e.licenseNo = "Enter the driving licence number.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dob)) e.dob = "Enter date of birth.";
  else if (ageOn(d.dob, pickupAt) < s.minDriverAge) e.dob = `Drivers must be at least ${s.minDriverAge} on the pick-up date.`;
  else if (ageOn(d.dob, pickupAt) > 99) e.dob = "Check the date of birth.";
  return e;
}

/** Final charges at return: late days, fuel and other charges on top of the quote. */
export function settleReturn(
  b: Booking,
  ret: { at: string; fuel: number; otherChargesCents: number },
  s: Settings,
): { lateDays: number; lateCents: number; fuelChargeCents: number; finalTotalCents: number } {
  const chargedDays = rentalDays(b.checkout?.at ?? b.pickupAt, ret.at, s.graceMinutes);
  const lateDays = Math.max(0, chargedDays - b.quote.days);
  const dailyAfterDiscount = Math.round(b.quote.dailyRateCents * (1 - b.quote.discountPercent / 100));
  const lateCents = lateDays * dailyAfterDiscount;
  const fuelOut = b.checkout?.fuel ?? 8;
  const fuelChargeCents = Math.max(0, fuelOut - ret.fuel) * s.fuelChargePerEighthCents;
  const extraNet = lateCents + fuelChargeCents + Math.max(0, ret.otherChargesCents);
  const extraTax = Math.round((extraNet * s.taxPercent) / 100);
  return { lateDays, lateCents, fuelChargeCents, finalTotalCents: b.quote.totalCents + extraNet + extraTax };
}

export function canCancelFree(b: Booking, now: number, s: Settings): boolean {
  return Date.parse(b.pickupAt) - now >= s.freeCancellationHours * HOUR;
}

export function bookingRef(existing: Set<string>, rnd: () => number = Math.random): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let r = "RC-";
    for (let i = 0; i < 6; i++) r += chars[Math.floor(rnd() * chars.length)];
    if (!existing.has(r)) return r;
  }
}

/** Share of available car-hours that were rented in [from, to), excluding maintenance. */
export function utilisation(data: RentalData, fromIso: string, toIso: string, carIds?: Set<string>) {
  const f = Date.parse(fromIso);
  const t = Date.parse(toIso);
  let available = 0;
  let rented = 0;
  for (const car of data.cars) {
    if (!car.active || (carIds && !carIds.has(car.id))) continue;
    let carAvail = t - f;
    for (const m of data.maintenance) {
      if (m.carId !== car.id) continue;
      carAvail -= Math.max(0, Math.min(t, Date.parse(m.to)) - Math.max(f, Date.parse(m.from)));
    }
    available += Math.max(0, carAvail);
    for (const b of data.bookings) {
      if (b.carId !== car.id || !holdsCar(b)) continue;
      const s = Date.parse(b.checkout?.at ?? b.pickupAt);
      const e = Date.parse(b.checkin?.at ?? b.returnAt);
      rented += Math.max(0, Math.min(t, e) - Math.max(f, s));
    }
  }
  return { available: available / HOUR, rented: rented / HOUR, rate: available ? rented / available : 0 };
}
