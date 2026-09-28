import type { RentalData } from "../types";
import { holdsCar, utilisation } from "./rental";

const DAY = 86_400_000;

/** Start of the local day containing t. */
export const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Revenue is recognised on the pick-up date: the rental net of tax plus any late/fuel/other
 * charges, plus late-cancellation fees on the cancellation date.
 */
export function fleetStats(data: RentalData, from: number, to: number) {
  const tax = 1 + data.settings.taxPercent / 100;
  const inRange = (iso: string | undefined) => !!iso && Date.parse(iso) >= from && Date.parse(iso) < to;
  const rentals = data.bookings.filter((b) => holdsCar(b) && inRange(b.pickupAt));
  const extrasNet = (b: (typeof rentals)[number]) => (b.checkin ? Math.round((b.checkin.finalTotalCents - b.quote.totalCents) / tax) : 0);
  const rentalRevenue = rentals.reduce((s, b) => s + b.quote.subtotalCents + extrasNet(b), 0);
  const cancelFees = data.bookings.filter((b) => b.status === "Cancelled" && inRange(b.cancelledAt)).reduce((s, b) => s + Math.round((b.cancellationFeeCents ?? 0) / tax), 0);
  const rentalDays = rentals.reduce((s, b) => s + b.quote.days, 0);
  const created = data.bookings.filter((b) => inRange(b.createdAt));
  const lost = created.filter((b) => b.status === "Cancelled" || b.status === "No-show").length;
  const u = utilisation(data, new Date(from).toISOString(), new Date(to).toISOString());

  const daily: { day: number; label: string; utilisation: number }[] = [];
  for (let d = dayStart(from); d < to; d += DAY) {
    const end = Math.min(d + DAY, to);
    daily.push({
      day: d,
      label: new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      utilisation: utilisation(data, new Date(d).toISOString(), new Date(end).toISOString()).rate,
    });
  }

  const byClass = data.classes.map((c) => {
    const ids = new Set(data.cars.filter((car) => car.classId === c.id).map((car) => car.id));
    const rs = rentals.filter((b) => b.classId === c.id);
    return {
      id: c.id,
      name: c.name,
      cars: ids.size,
      rentals: rs.length,
      revenue: rs.reduce((s, b) => s + b.quote.subtotalCents + extrasNet(b), 0),
      utilisation: utilisation(data, new Date(from).toISOString(), new Date(to).toISOString(), ids).rate,
    };
  });

  return {
    revenue: rentalRevenue + cancelFees,
    rentals: rentals.length,
    rentalDays,
    adr: rentalDays ? rentalRevenue / rentalDays : 0,
    avgLength: rentals.length ? rentalDays / rentals.length : 0,
    utilisation: u.rate,
    lostRate: created.length ? lost / created.length : 0,
    daily,
    byClass,
  };
}
