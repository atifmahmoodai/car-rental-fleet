import type { ReactNode } from "react";
import { money } from "../lib/format";
import { useStore } from "../store/store";
import type { BookingStatus } from "../types";

export function useMoney() {
  const { data } = useStore();
  return (cents: number) => money(cents, data.settings);
}

const CLS: Record<BookingStatus, string> = { Reserved: "badge-brand", Active: "badge-good", Returned: "", Cancelled: "badge-bad", "No-show": "badge-warn" };
const ICON: Record<BookingStatus, string> = { Reserved: "◷", Active: "🚗", Returned: "✓", Cancelled: "✕", "No-show": "⚠" };

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`badge ${CLS[status]}`}>
      {ICON[status]} {status === "Active" ? "On rent" : status}
    </span>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function FuelGauge({ eighths }: { eighths: number }) {
  return (
    <span className="small" title={`${eighths}/8 tank`}>
      ⛽ {eighths}/8
    </span>
  );
}
