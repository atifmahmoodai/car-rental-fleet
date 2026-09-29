import { bookingRef, quote, settleReturn } from "../lib/rental";
import { createRng } from "../lib/random";
import type { Booking, Car, CarClass, Extra, Location, Maintenance, RentalData, Settings } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  name: "DriveEasy Rentals",
  phone: "+1 (555) 019-4400",
  email: "bookings@driveeasy.example",
  currency: "USD",
  locale: "en-US",
  taxPercent: 10,
  bufferHours: 2,
  graceMinutes: 59,
  minDriverAge: 21,
  youngDriverAge: 25,
  youngDriverFeePerDayCents: 1500,
  oneWayFeeCents: 4500,
  weeklyDiscountPercent: 15,
  monthlyDiscountPercent: 30,
  fuelChargePerEighthCents: 900,
  freeCancellationHours: 48,
};

export const LOCATIONS: Location[] = [
  { id: "l-airport", name: "Airport", address: "Terminal 2 car park, Springfield Airport" },
  { id: "l-city", name: "City Centre", address: "14 Market Street, Springfield" },
];

export const CLASSES: CarClass[] = [
  { id: "k-eco", name: "Economy", example: "Toyota Yaris or similar", seats: 5, bags: 2, transmission: "Automatic", bodyType: "Hatchback", dailyRateCents: 3900, depositCents: 20000, colorHex: "#b91c1c" },
  { id: "k-cmp", name: "Compact", example: "Toyota Corolla or similar", seats: 5, bags: 3, transmission: "Automatic", bodyType: "Sedan", dailyRateCents: 4900, depositCents: 25000, colorHex: "#f1f5f9" },
  { id: "k-suv", name: "SUV", example: "Toyota RAV4 or similar", seats: 5, bags: 4, transmission: "Automatic", bodyType: "SUV", dailyRateCents: 6900, depositCents: 35000, colorHex: "#4b5563" },
  { id: "k-prm", name: "Premium", example: "BMW 5 Series or similar", seats: 5, bags: 3, transmission: "Automatic", bodyType: "Sedan", dailyRateCents: 10900, depositCents: 75000, colorHex: "#111827" },
  { id: "k-van", name: "People carrier", example: "Hyundai Staria (8 seats) or similar", seats: 8, bags: 5, transmission: "Automatic", bodyType: "Van", dailyRateCents: 9500, depositCents: 50000, colorHex: "#1e3a8a" },
];

export const EXTRAS: Extra[] = [
  { id: "x-ins", name: "Zero-excess cover", perDayCents: 1800 },
  { id: "x-drv", name: "Additional driver", perDayCents: 1000, maxCents: 7000 },
  { id: "x-seat", name: "Child seat", perDayCents: 800, maxCents: 5600 },
  { id: "x-gps", name: "Sat nav", perDayCents: 600, maxCents: 4200 },
];

const FLEET: [classId: string, count: number, make: string, model: string][] = [
  ["k-eco", 8, "Toyota", "Yaris"],
  ["k-cmp", 8, "Toyota", "Corolla"],
  ["k-suv", 7, "Toyota", "RAV4"],
  ["k-prm", 3, "BMW", "5 Series"],
  ["k-van", 2, "Hyundai", "Staria"],
];

const FIRST = ["Ava", "Noah", "Liam", "Emma", "Zara", "Ali", "Hana", "Ethan", "Mia", "Yusuf", "Sofia", "Daniel", "Aisha", "Leo", "Grace", "Ryan", "Fatima", "Oliver", "Chloe", "Adam"];
const LAST = ["Smith", "Khan", "Garcia", "Patel", "Nguyen", "Brown", "Wilson", "Ali", "Martin", "Lee", "Hassan", "Clark", "Lopez", "Walker", "Young", "Rahman"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Local-time timestamp for a day offset and hour, so the demo shows sensible office hours in any timezone. */
function localAt(base: Date, dayOffset: number, hour: number): number {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, Math.floor(hour), Math.round((hour % 1) * 60)).getTime();
}

/**
 * 120 days of rental history and 30 days of forward bookings around `now`,
 * built car by car so a car never has overlapping rentals.
 */
export function generateDemoData(now: Date, seed = 99): RentalData {
  const r = createRng(seed);
  const settings = { ...DEFAULT_SETTINGS };
  const nowMs = now.getTime();

  const cars: Car[] = [];
  let n = 1;
  for (const [classId, count, make, model] of FLEET) {
    for (let i = 0; i < count; i++) {
      cars.push({
        id: `car-${String(n).padStart(2, "0")}`,
        plate: `DE${String(100 + n)} ${"ABCDEFGHJKLMNPRSTUVWXYZ"[r.int(0, 22)]}${"ABCDEFGHJKLMNPRSTUVWXYZ"[r.int(0, 22)]}`,
        make,
        model,
        year: now.getFullYear() - r.int(0, 3),
        classId,
        homeLocationId: r.chance(0.6) ? "l-airport" : "l-city",
        odometer: r.int(8000, 60000),
        active: true,
      });
      n++;
    }
  }

  const bookings: Booking[] = [];
  const maintenance: Maintenance[] = [];
  const refs = new Set<string>();
  const clsById = new Map(CLASSES.map((c) => [c.id, c]));
  let bid = 1;

  const driver = () => {
    const f = r.pick(FIRST);
    const l = r.pick(LAST);
    const age = r.chance(0.12) ? r.int(21, 24) : r.int(25, 70);
    const dob = new Date(now.getFullYear() - age, r.int(0, 11), r.int(1, 28));
    return {
      name: `${f} ${l}`,
      email: `${f}.${l}${r.int(1, 99)}@example.com`.toLowerCase(),
      phone: `+1 (555) ${r.int(200, 999)}-${String(r.int(0, 9999)).padStart(4, "0")}`,
      licenseNo: `D${r.int(1000000, 9999999)}`,
      dob: `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, "0")}-${String(dob.getDate()).padStart(2, "0")}`,
    };
  };

  for (const car of cars) {
    const cls = clsById.get(car.classId)!;
    let location = car.homeLocationId;
    let odo = car.odometer;
    /** When the car is next free (back from the last rental or service). */
    let free = localAt(now, -120 + r.int(0, 2), r.float(8, 12));

    while (free < nowMs + 30 * DAY) {
      // Idle time between rentals; tuned for roughly 60% utilisation, so the demo has cars to book.
      const gap = r.weighted(["same day", "short", "long"] as const, [15, 35, 50]);
      let pickup =
        gap === "same day"
          ? free + settings.bufferHours * HOUR + r.float(0.5, 3) * HOUR
          : localAt(new Date(free), gap === "short" ? r.int(1, 2) : r.int(3, 10), r.float(8, 18));
      // Keep hand-overs inside opening hours (08:00–19:00).
      const ph = new Date(pickup).getHours();
      if (ph >= 19) pickup = localAt(new Date(pickup), 1, r.float(8, 10));
      else if (ph < 8) pickup = localAt(new Date(pickup), 0, r.float(8, 10));

      // Occasional servicing instead of a rental.
      if (r.chance(0.035)) {
        const days = r.int(1, 3);
        maintenance.push({
          id: `m-${maintenance.length + 1}`,
          carId: car.id,
          from: new Date(pickup).toISOString(),
          to: new Date(pickup + days * DAY).toISOString(),
          reason: r.pick(["Scheduled service", "Tyre change", "Windscreen repair", "Bodywork"]),
        });
        free = pickup + days * DAY;
        continue;
      }

      const days = r.weighted([r.int(1, 3), r.int(4, 7), r.int(8, 14), r.int(15, 30)], [45, 35, 15, 5]);
      const ret = pickup + days * DAY + r.int(-3, 2) * HOUR;
      free = ret;
      const retLocation = r.chance(0.12) ? (location === "l-airport" ? "l-city" : "l-airport") : location;
      // Fewer bookings exist the further ahead you look, as in real life.
      const daysAhead = (pickup - nowMs) / DAY;
      if (daysAhead > 0 && !r.chance(Math.max(0.1, 0.55 - daysAhead / 40))) continue;

      const extras = EXTRAS.filter((e) => r.chance(e.id === "x-ins" ? 0.35 : 0.12)).map((e) => e.id);
      const d = driver();
      const pickupAt = new Date(pickup).toISOString();
      const returnAt = new Date(ret).toISOString();
      const q = quote(
        { cls, pickupAt, returnAt, pickupLocationId: location, returnLocationId: retLocation, extras: EXTRAS.filter((e) => extras.includes(e.id)), driverDob: d.dob },
        settings,
      );
      const ref = bookingRef(refs, r.next);
      refs.add(ref);
      const b: Booking = {
        id: `b-${String(bid++).padStart(5, "0")}`,
        ref,
        carId: car.id,
        classId: car.classId,
        pickupLocationId: location,
        returnLocationId: retLocation,
        pickupAt,
        returnAt,
        driver: d,
        extras,
        quote: q,
        status: "Reserved",
        source: r.chance(0.75) ? "Web" : "Counter",
        createdAt: new Date(Math.min(nowMs - HOUR, pickup - r.int(0, 35) * DAY - r.int(1, 20) * HOUR)).toISOString(),
      };

      if (pickup <= nowMs) {
        b.status = "Active";
        b.checkout = { at: pickupAt, odometer: odo, fuel: 8 };
        const late = r.chance(0.05) ? r.int(2, 26) * HOUR : 0;
        const checkinMs = ret - r.int(0, 60) * 60_000 + late;
        if (checkinMs <= nowMs) {
          odo += r.int(60, 220) * days;
          const fuel = r.weighted([8, 7, 6, 4], [70, 15, 10, 5]);
          const at = new Date(checkinMs).toISOString();
          const settled = settleReturn(b, { at, fuel, otherChargesCents: 0 }, settings, EXTRAS);
          b.status = "Returned";
          b.checkin = { at, odometer: odo, fuel, damage: r.chance(0.03) ? "Scratch on rear bumper" : "", lateDays: settled.lateDays, fuelChargeCents: settled.fuelChargeCents, otherChargesCents: 0, finalTotalCents: settled.finalTotalCents };
          free = Math.max(free, checkinMs);
        }
      }
      location = retLocation;
      bookings.push(b);

      // Some customers cancel or never show up; those records don't hold the car.
      if (r.chance(0.08)) {
        const p2 = pickup + r.int(1, 5) * DAY;
        const cancelledAt = Math.min(nowMs - HOUR, p2 - r.int(1, 72) * HOUR);
        const ghostDriver = driver();
        const ghost: Booking = {
          ...b,
          id: `b-${String(bid++).padStart(5, "0")}`,
          ref: bookingRef(refs, r.next),
          driver: ghostDriver,
          extras: [],
          pickupAt: new Date(p2).toISOString(),
          returnAt: new Date(p2 + r.int(1, 5) * DAY).toISOString(),
          status: p2 < nowMs && r.chance(0.3) ? "No-show" : "Cancelled",
          checkout: undefined,
          checkin: undefined,
          createdAt: new Date(cancelledAt - r.int(1, 10) * DAY).toISOString(),
        };
        if (ghost.status === "Cancelled") ghost.cancelledAt = new Date(cancelledAt).toISOString();
        ghost.quote = quote(
          { cls, pickupAt: ghost.pickupAt, returnAt: ghost.returnAt, pickupLocationId: ghost.pickupLocationId, returnLocationId: ghost.returnLocationId, extras: [], driverDob: ghostDriver.dob },
          settings,
        );
        refs.add(ghost.ref);
        bookings.push(ghost);
      }
    }
    car.odometer = odo;
  }

  bookings.sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
  return { settings, locations: LOCATIONS, classes: CLASSES, cars, extras: EXTRAS, bookings, maintenance };
}
