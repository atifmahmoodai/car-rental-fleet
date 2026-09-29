export const BOOKING_STATUSES = ["Reserved", "Active", "Returned", "Cancelled", "No-show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface Settings {
  name: string;
  phone: string;
  email: string;
  currency: string;
  locale: string;
  taxPercent: number;
  /** Hours a car is blocked after a return for cleaning and checks. */
  bufferHours: number;
  /** Minutes of lateness forgiven before an extra day is charged. */
  graceMinutes: number;
  minDriverAge: number;
  youngDriverAge: number;
  youngDriverFeePerDayCents: number;
  oneWayFeeCents: number;
  /** Discount for rentals of 7+ days and 28+ days (percent). */
  weeklyDiscountPercent: number;
  monthlyDiscountPercent: number;
  /** Charge per missing eighth of a tank on return. */
  fuelChargePerEighthCents: number;
  freeCancellationHours: number;
}

export interface Location {
  id: string;
  name: string;
  address: string;
}

export interface CarClass {
  id: string;
  name: string;
  example: string;
  seats: number;
  bags: number;
  transmission: "Automatic" | "Manual";
  bodyType: "Hatchback" | "Sedan" | "SUV" | "Van" | "Coupe";
  dailyRateCents: number;
  depositCents: number;
  colorHex: string;
}

export interface Car {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  classId: string;
  homeLocationId: string;
  odometer: number;
  active: boolean;
}

export interface Extra {
  id: string;
  name: string;
  /** Charged per rental day, capped at `maxCents` per rental when set. */
  perDayCents: number;
  maxCents?: number;
}

export interface Driver {
  name: string;
  email: string;
  phone: string;
  licenseNo: string;
  /** YYYY-MM-DD */
  dob: string;
}

export interface Quote {
  days: number;
  dailyRateCents: number;
  baseCents: number;
  discountPercent: number;
  discountCents: number;
  extrasCents: number;
  youngDriverCents: number;
  oneWayFeeCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
}

export interface Handover {
  at: string;
  odometer: number;
  /** Eighths of a tank, 0–8. */
  fuel: number;
}

export interface ReturnInfo extends Handover {
  damage: string;
  lateDays: number;
  fuelChargeCents: number;
  otherChargesCents: number;
  finalTotalCents: number;
}

export interface Booking {
  id: string;
  ref: string;
  carId: string;
  classId: string;
  pickupLocationId: string;
  returnLocationId: string;
  /** ISO datetime */
  pickupAt: string;
  /** ISO datetime */
  returnAt: string;
  driver: Driver;
  extras: string[];
  quote: Quote;
  status: BookingStatus;
  source: "Web" | "Counter";
  createdAt: string;
  cancelledAt?: string;
  /** Charged when cancelled inside the free-cancellation window (one day's rate). */
  cancellationFeeCents?: number;
  checkout?: Handover;
  checkin?: ReturnInfo;
}

export interface Maintenance {
  id: string;
  carId: string;
  from: string;
  to: string;
  reason: string;
}

export interface RentalData {
  settings: Settings;
  locations: Location[];
  classes: CarClass[];
  cars: Car[];
  extras: Extra[];
  bookings: Booking[];
  maintenance: Maintenance[];
}
