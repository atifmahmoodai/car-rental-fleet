import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { generateDemoData } from "../data/generate";
import { assignCar, bookingRef, canCancelFree, quote, settleReturn, unavailableReason, validateDates, validateDriver } from "../lib/rental";
import type { Booking, Car, CarClass, Driver, Maintenance, RentalData, Settings } from "../types";

const KEY = "car-rental:v1";

export function isRentalData(x: unknown): x is RentalData {
  const d = x as RentalData;
  return (
    !!d &&
    typeof d.settings?.name === "string" &&
    ["locations", "classes", "cars", "extras", "bookings", "maintenance"].every((k) => Array.isArray((d as unknown as Record<string, unknown>)[k])) &&
    d.bookings.every((b) => typeof b?.id === "string" && typeof b.pickupAt === "string" && typeof b.quote?.totalCents === "number") &&
    d.cars.every((c) => typeof c?.id === "string" && typeof c.classId === "string")
  );
}

function load(): RentalData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isRentalData(parsed)) return parsed;
    }
  } catch {
    // blocked or corrupt storage → fresh demo data
  }
  return generateDemoData(new Date());
}

export const newId = (p: string) =>
  `${p}-${Date.now().toString(36)}${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 6) : Math.random().toString(36).slice(2, 8)}`;

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
    const s = settleReturn(b, { at, fuel: r.fuel, otherChargesCents: r.otherChargesCents }, d.settings);
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

interface Store {
  data: RentalData;
  persisted: boolean;
  /** Runs a transition; returns an error message or null. */
  run(fn: (d: RentalData, now: number) => Result<RentalData>): string | null;
  createBooking(input: NewBookingInput): Result<Booking>;
  saveCar(c: Car): void;
  saveClass(c: CarClass): void;
  removeMaintenance(id: string): void;
  saveSettings(s: Settings): void;
  replaceData(d: RentalData): void;
  resetDemo(): void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RentalData>(load);
  const [persisted, setPersisted] = useState(true);
  const first = useRef(true);
  // Mirror of the latest state so transitions can validate synchronously and report errors.
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      try {
        if (localStorage.getItem(KEY)) return;
      } catch {
        setPersisted(false);
        return;
      }
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      setPersisted(true);
    } catch {
      setPersisted(false);
    }
  }, [data]);

  const commit = (next: RentalData) => {
    latest.current = next;
    setData(next);
  };

  const run = useCallback((fn: (d: RentalData, now: number) => Result<RentalData>) => {
    const res = fn(latest.current, Date.now());
    if (!res.ok) return res.error;
    commit(res.value);
    return null;
  }, []);

  const createBooking = useCallback((input: NewBookingInput): Result<Booking> => {
    const res = actions.create(latest.current, input, Date.now());
    if (!res.ok) return res;
    commit(res.value.data);
    return { ok: true, value: res.value.booking };
  }, []);

  const upsert = <K extends "cars" | "classes">(key: K) =>
    (item: RentalData[K][number]) => {
      const list = latest.current[key] as { id: string }[];
      commit({ ...latest.current, [key]: list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item] });
    };
  const saveCar = useCallback(upsert("cars"), []);
  const saveClass = useCallback(upsert("classes"), []);
  const removeMaintenance = useCallback((id: string) => commit({ ...latest.current, maintenance: latest.current.maintenance.filter((m) => m.id !== id) }), []);
  const saveSettings = useCallback((s: Settings) => commit({ ...latest.current, settings: s }), []);
  const replaceData = useCallback((d: RentalData) => commit(d), []);
  const resetDemo = useCallback(() => commit(generateDemoData(new Date())), []);

  const value = useMemo<Store>(
    () => ({ data, persisted, run, createBooking, saveCar, saveClass, removeMaintenance, saveSettings, replaceData, resetDemo }),
    [data, persisted, run, createBooking, saveCar, saveClass, removeMaintenance, saveSettings, replaceData, resetDemo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}
