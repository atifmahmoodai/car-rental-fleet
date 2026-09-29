// API contract: request schemas validated on the server.
import { z } from "zod";
import type { Booking, CarClass, Extra, Location, Settings } from "./types";

const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(100_000_000);
const isoTime = z.string().max(40).refine((s) => Number.isFinite(Date.parse(s)), "Not a valid date/time");
const id = z.string().min(1).max(64);

export const ROLES = ["admin", "agent"] as const;
export type Role = (typeof ROLES)[number];

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });
export const PASSWORD_MIN = 10;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use letters and at least one number");
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

// Field-level rules (name, age…) are applied by the shared validateDriver, so messages match the demo.
export const driverSchema = z.object({
  name: text(120),
  email: text(200).toLowerCase(),
  phone: text(40),
  licenseNo: text(40).toUpperCase(),
  dob: text(10),
});

export const searchSchema = z.object({
  pickupAt: isoTime,
  returnAt: isoTime,
  pickupLocationId: id,
  returnLocationId: id,
});

export const bookingSchema = searchSchema.extend({
  classId: id,
  extras: z.array(id).max(20).default([]),
  driver: driverSchema,
});

export const publicBookingSchema = bookingSchema.extend({
  acceptTerms: z.literal(true, { message: "Please accept the rental terms." }),
  /** Honeypot: humans never fill it. */
  website: z.string().max(200).optional(),
});

export const lookupSchema = z.object({
  ref: text(12).toUpperCase().regex(/^RC-[A-Z0-9]{6}$/, "Booking references look like RC-AB12CD."),
  email: text(200).toLowerCase(),
});

export const checkoutSchema = z.object({ odometer: z.number().int().min(0).max(2_000_000), fuel: z.number().int().min(0).max(8) });
export const checkinSchema = checkoutSchema.extend({ damage: text(1000).default(""), otherChargesCents: cents.default(0) });
export const changeCarSchema = z.object({ carId: id });
export const maintenanceSchema = z.object({ carId: id, from: isoTime, to: isoTime, reason: text(200).default("") });

export const carSchema = z.object({
  plate: text(20).min(1, "Enter the plate.").toUpperCase(),
  make: text(60).min(1),
  model: text(60).min(1),
  year: z.number().int().min(1990).max(2100),
  classId: id,
  homeLocationId: id,
  odometer: z.number().int().min(0).max(2_000_000),
  active: z.boolean(),
});

export const classSchema = z.object({
  name: text(60).min(1),
  example: text(120).min(1),
  seats: z.number().int().min(1).max(20),
  bags: z.number().int().min(0).max(20),
  transmission: z.enum(["Automatic", "Manual"]),
  bodyType: z.enum(["Hatchback", "Sedan", "SUV", "Van", "Coupe"]),
  dailyRateCents: cents.min(1),
  depositCents: cents,
  colorHex: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export const settingsSchema = z.object({
  name: text(120).min(1),
  phone: text(40),
  email: z.string().trim().email().max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  taxPercent: z.number().min(0).max(50),
  bufferHours: z.number().min(0).max(48),
  graceMinutes: z.number().int().min(0).max(240),
  minDriverAge: z.number().int().min(16).max(30),
  youngDriverAge: z.number().int().min(16).max(35),
  youngDriverFeePerDayCents: cents,
  oneWayFeeCents: cents,
  weeklyDiscountPercent: z.number().min(0).max(90),
  monthlyDiscountPercent: z.number().min(0).max(90),
  fuelChargePerEighthCents: cents,
  freeCancellationHours: z.number().int().min(0).max(720),
});

export const userCreateSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: text(120).min(2), role: z.enum(ROLES), password: passwordSchema });
export const userUpdateSchema = z.object({ name: text(120).min(2), role: z.enum(ROLES), active: z.boolean() });
export const resetPasswordSchema = z.object({ password: passwordSchema });

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Everything the public site needs to show prices and run the booking form. */
export interface Catalog {
  /** IANA zone of the rental desks: all pick-up and return times are in it. */
  timeZone: string;
  settings: Settings;
  locations: Location[];
  classes: CarClass[];
  extras: Extra[];
}

/** A customer's view of their booking: no car id, odometer or internal notes. */
export type PublicBooking = Pick<
  Booking,
  "ref" | "classId" | "pickupLocationId" | "returnLocationId" | "pickupAt" | "returnAt" | "extras" | "quote" | "status" | "createdAt" | "cancelledAt" | "cancellationFeeCents"
> & { driver: { name: string; email: string; phone: string } };
