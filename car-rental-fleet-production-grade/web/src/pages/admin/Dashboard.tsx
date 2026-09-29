import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Kpi, StatusBadge, useMoney } from "../../components/ui";
import { fmtDateTime, fmtPct } from "../../lib/format";
import { api, errorText } from "../../api/client";
import { CATALOG } from "../../config";
import type { fleetStats } from "../../lib/stats";

interface Brief {
  id: string;
  ref: string;
  name: string;
  plate: string;
  pickupAt: string;
  returnAt: string;
  pickupLocationId: string;
  returnLocationId: string;
}
interface DashboardData {
  now: number;
  stats: ReturnType<typeof fleetStats>;
  pickupsToday: Brief[];
  returnsToday: Brief[];
  overdue: Brief[];
  onRent: number;
  byLocation: { id: string; name: string; count: number }[];
  readyNow: number;
  inService: number;
}
const axis = { stroke: "var(--chart-grid)", tick: { fill: "var(--chart-axis)", fontSize: 12 }, tickLine: false };

export function Dashboard() {
  const fmt = useMoney();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["dashboard", days], queryFn: () => api<DashboardData>(`/staff/dashboard?days=${days}`), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  if (q.isError) return <div className="notice">{errorText(q.error)}</div>;
  if (!q.data) return <p className="muted">Loading dashboard…</p>;
  const { stats: s, pickupsToday, returnsToday, overdue, onRent, byLocation, readyNow, inService } = q.data;
  const loc = (id: string) => CATALOG.locations.find((l) => l.id === id)?.name ?? "?";

  const list = (items: Brief[], when: (b: Brief) => string, empty: string) =>
    items.length ? (
      <div className="table-wrap">
        <table>
          <tbody>
            {items
              .sort((a, b) => when(a).localeCompare(when(b)))
              .map((b) => (
                <tr key={b.id}>
                  <td>{fmtDateTime(when(b)).replace(/^\w+, /, "")}</td>
                  <td>
                    <Link to={`/admin/bookings/${b.id}`}>{b.ref}</Link>
                  </td>
                  <td>{b.name}</td>
                  <td>{b.plate}</td>
                  <td>{loc(when(b) === b.pickupAt ? b.pickupLocationId : b.returnLocationId)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="muted">{empty}</p>
    );

  return (
    <>
      <div className="page-head">
        <h1>Fleet dashboard</h1>
        <span className="spacer" />
        <label>
          Period
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>

      <div className="kpi-grid">
        <Kpi label="Utilisation" value={fmtPct(s.utilisation)} sub="rented ÷ available car-hours" />
        <Kpi label="Revenue (ex. tax)" value={fmt(s.revenue)} sub={`${s.rentals} rentals started`} />
        <Kpi label="Average daily rate" value={fmt(s.adr)} sub={`${s.avgLength.toFixed(1)} days average rental`} />
        <Kpi label="Cancelled / no-show" value={fmtPct(s.lostRate)} sub="of bookings made in period" />
        <Kpi label="On rent now" value={String(onRent)} sub={overdue.length ? <span className="badge badge-bad">⚠ {overdue.length} overdue</span> : "none overdue"} />
        <Kpi label="Ready to rent now" value={String(readyNow)} sub={byLocation.map((l) => `${l.name} ${l.count}`).join(" · ") + (inService ? ` · ${inService} in service` : "")} />
      </div>

      <div className="chart-grid">
        <section className="chart-card wide" aria-label="Daily utilisation">
          <header>
            <div>
              <h3>Daily utilisation</h3>
              <p className="muted small">Share of the fleet's available hours that were on rent each day; the dashed line is the period average</p>
            </div>
          </header>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={s.daily.map((d) => ({ ...d, pct: Math.round(d.utilisation * 1000) / 10 }))} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} axisLine={false} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                formatter={(v) => [`${v}%`, "Utilisation"]}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text)" }}
              />
              <ReferenceLine y={Math.round(s.utilisation * 1000) / 10} stroke="var(--chart-ref)" strokeDasharray="5 4" />
              <Line dataKey="pct" stroke="var(--series-1)" strokeWidth={2} dot={days <= 30 ? { r: 3 } : false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="chart-card" aria-label="Today's pick-ups">
          <header>
            <h3>Pick-ups today ({pickupsToday.length})</h3>
          </header>
          {list(pickupsToday, (b) => b.pickupAt, "No more pick-ups today.")}
        </section>
        <section className="chart-card" aria-label="Today's returns">
          <header>
            <h3>Returns due today ({returnsToday.length})</h3>
          </header>
          {list(returnsToday, (b) => b.returnAt, "No more returns due today.")}
          {overdue.length > 0 && (
            <>
              <h3 style={{ marginTop: "1rem" }}>Overdue</h3>
              {list(overdue, (b) => b.returnAt, "")}
            </>
          )}
        </section>

        <section className="chart-card wide" aria-label="By car class">
          <header>
            <h3>By car class</h3>
          </header>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="r">Cars</th>
                  <th className="r">Rentals</th>
                  <th>Utilisation</th>
                  <th className="r">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {s.byClass.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="r">{c.cars}</td>
                    <td className="r">{c.rentals}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <div className="meter" style={{ flex: 1, minWidth: 60 }}>
                          <span style={{ width: `${Math.min(100, c.utilisation * 100)}%` }} />
                        </div>
                        <span className="num small">{fmtPct(c.utilisation)}</span>
                      </div>
                    </td>
                    <td className="r">{fmt(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
            Classes running above ~85% utilisation are turning customers away: consider adding cars or raising rates. Below ~50%, consider promotions.
          </p>
        </section>
      </div>
      <p className="muted small">
        Tip: open the <Link to="/admin/calendar">fleet calendar</Link> to see every car's bookings on a timeline. <StatusBadge status="Active" /> = currently on rent.
      </p>
    </>
  );
}
