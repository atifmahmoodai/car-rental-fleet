import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, errorText } from "../../api/client";
import { fmtDateTime } from "../../lib/format";

interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userName: string | null;
}

const LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.password_changed": "Changed password",
  "booking.create": "New booking",
  "booking.cancel": "Cancelled booking",
  "booking.no_show": "Marked no-show",
  "booking.checkout": "Handed over car",
  "booking.checkin": "Car returned",
  "booking.change_car": "Changed car",
  "maintenance.create": "Booked servicing",
  "maintenance.delete": "Removed servicing",
  "car.create": "Added car",
  "car.update": "Edited car",
  "class.update": "Changed class / price",
  "settings.update": "Changed settings",
  "user.create": "Added user",
  "user.update": "Edited user",
  "user.password_reset": "Reset password",
};

function summary(e: AuditEntry): string {
  const d = e.details;
  if (e.action === "booking.create") return `${d.ref} · ${d.source}`;
  if (e.action === "booking.checkout" || e.action === "booking.checkin") return `odometer ${d.odometer} · fuel ${d.fuel}/8`;
  return "";
}

const LINKS: Record<string, string> = { booking: "/admin/bookings/" };

/** Who did what, and when: for accountability and for tracing mistakes. */
export function AuditLog() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<{ items: AuditEntry[] }>("/staff/audit?limit=300") });
  return (
    <>
      <div className="page-head">
        <h1>Activity log</h1>
      </div>
      {q.isError && <div className="notice">{errorText(q.error)}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending && (
              <tr>
                <td colSpan={4} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {q.data?.items.map((e) => (
              <tr key={e.id}>
                <td className="num">{fmtDateTime(e.at)}</td>
                <td>{e.userName ?? <span className="muted">Customer (online)</span>}</td>
                <td>
                  {LINKS[e.entity] && e.entityId ? (
                    <Link to={`${LINKS[e.entity]}${e.entityId}`}>{LABELS[e.action] ?? e.action}</Link>
                  ) : (
                    (LABELS[e.action] ?? e.action)
                  )}
                </td>
                <td className="muted ellipsis" style={{ maxWidth: 360 }}>
                  {summary(e)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
