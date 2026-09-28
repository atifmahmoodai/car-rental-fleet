import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, useMoney } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { useStore } from "../../store/store";
import { BOOKING_STATUSES } from "../../types";

type View = "upcoming" | "active" | "all";

export function Bookings() {
  const { data } = useStore();
  const fmt = useMoney();
  const [view, setView] = useState<View>("upcoming");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(100);
  const cars = useMemo(() => new Map(data.cars.map((c) => [c.id, c])), [data.cars]);
  const classes = useMemo(() => new Map(data.classes.map((c) => [c.id, c.name])), [data.classes]);
  const loc = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "?";
  const now = Date.now();

  const rows = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.bookings
      .filter((b) => (view === "upcoming" ? b.status === "Reserved" : view === "active" ? b.status === "Active" : true))
      .filter((b) => !status || b.status === status)
      .filter((b) => tokens.every((t) => `${b.ref} ${b.driver.name} ${b.driver.email} ${b.driver.phone} ${cars.get(b.carId)?.plate ?? ""}`.toLowerCase().includes(t)))
      .sort((a, b) => (view === "all" ? b.pickupAt.localeCompare(a.pickupAt) : a.pickupAt.localeCompare(b.pickupAt)));
  }, [data.bookings, view, status, q, cars]);

  return (
    <>
      <div className="page-head">
        <h1>Bookings</h1>
        <span className="spacer" />
        <Link to="/" className="btn btn-primary">
          + New booking
        </Link>
      </div>
      <div className="filter-bar">
        <div className="tabs" role="tablist" style={{ minWidth: 300 }}>
          {(
            [
              ["upcoming", "Upcoming"],
              ["active", "On rent"],
              ["all", "All"],
            ] as [View, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => { setView(k); setStatus(""); setLimit(100); }}>
              {l}
            </button>
          ))}
        </div>
        {view === "all" && (
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {BOOKING_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <label style={{ flex: 1, minWidth: 200 }}>
          Search
          <input type="search" placeholder="Reference, name, email, plate…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <p className="muted small">{rows.length} bookings</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Driver</th>
              <th>Pick-up</th>
              <th>Return</th>
              <th>Car</th>
              <th>Status</th>
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((b) => {
              const overdue = b.status === "Active" && Date.parse(b.returnAt) < now;
              return (
                <tr key={b.id}>
                  <td>
                    <Link to={`/admin/bookings/${b.id}`}>{b.ref}</Link>
                  </td>
                  <td>{b.driver.name}</td>
                  <td>
                    {fmtDateTime(b.pickupAt)} <span className="muted small">· {loc(b.pickupLocationId)}</span>
                  </td>
                  <td>
                    {fmtDateTime(b.returnAt)} <span className="muted small">· {loc(b.returnLocationId)}</span>
                    {overdue && <span className="badge badge-bad"> ⚠ overdue</span>}
                  </td>
                  <td>
                    {cars.get(b.carId)?.plate} <span className="muted small">· {classes.get(b.classId)}</span>
                  </td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="r">{fmt(b.checkin?.finalTotalCents ?? (b.status === "Cancelled" ? b.cancellationFeeCents ?? 0 : b.quote.totalCents))}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                  No bookings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button className="btn" onClick={() => setLimit(limit + 100)}>
            Show more ({rows.length - limit} left)
          </button>
        </div>
      )}
    </>
  );
}
