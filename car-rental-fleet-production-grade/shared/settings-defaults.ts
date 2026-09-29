import type { Settings } from "./types";

// Kept free of zod so the public site bundle stays small.
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
