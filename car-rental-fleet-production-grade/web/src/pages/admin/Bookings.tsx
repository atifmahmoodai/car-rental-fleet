import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useFleet } from "../../api/auth";
import { api, errorText } from "../../api/client";
import { CATALOG } from "../../config";
import { useDebounced } from "../../lib/useDebounced";
import { Link } from "react-router-dom";
import { StatusBadge, useMoney } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { BOOKING_STATUSES, type Booking } from "../../types";

type View = "upcoming" | "active" | "all";

export function Bookings() {
  const fleet = useFleet();
  const fmt = useMoney();
  const [view, setView] = useState<View>("upcoming");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const cars = new Map((fleet.data?.cars ?? []).map((c) => [c.id, c]));
  const classes = new Map(CATALOG.classes.map((c) => [c.id, c.name]));
  const loc = (id: string) => CATALOG.locations.find((l) => l.id === id)?.name ?? "?";
  const now = Date.now();
  const list = useInfiniteQuery({
    queryKey: ["bookings", view, status, search],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api<{ items: Booking[]; total: number }>(`/staff/bookings?view=${view}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(search)}&offset=${pageParam}&limit=100`, { signal }),
    getNextPageParam: (last, pages) => {
      const n = pages.reduce((s, p) => s + p.items.length, 0);
      return n < last.total ? n : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

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
            <button key={k} role="tab" aria-selected={view === k} onClick={() => { setView(k); setStatus(""); }}>
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
      {list.isError && <div className="notice">{errorText(list.error)}</div>}
      <p className="muted small">{list.isPending ? "Loading…" : `${total} bookings`}</p>
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
            {rows.map((b) => {
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
            {!list.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                  No bookings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.hasNextPage && (
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button className="btn" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Show more ({total - rows.length} left)
          </button>
        </div>
      )}
    </>
  );
}
