import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { isAdmin, useFleet } from "../../api/auth";
import { api, errorText } from "../../api/client";
import { CATALOG } from "../../config";
import { fmtDateTime, fmtPct, fromLocalInput } from "../../lib/format";
import type { Car } from "../../types";

interface CarStatus {
  carId: string;
  activeReturnAt: string | null;
  activeRef: string | null;
  locationId: string;
  utilisation30: number;
}

export function Fleet() {
  const fleet = useFleet();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["fleet-status"], queryFn: () => api<{ items: CarStatus[] }>("/staff/fleet/status") });
  const admin = isAdmin(fleet.data?.user);
  const data = { ...CATALOG, cars: fleet.data?.cars ?? [], maintenance: fleet.data?.maintenance ?? [] };
  const now = Date.now();
  const [form, setForm] = useState<(Car & { isNew?: boolean }) | null>(null);
  const [formErr, setFormErr] = useState<string[]>([]);
  const [m, setM] = useState({ carId: "", from: "", to: "", reason: "Scheduled service" });
  const [mMsg, setMMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loc = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "?";
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["fleet"] });
    void qc.invalidateQueries({ queryKey: ["fleet-status"] });
  };
  const saveCar = useMutation({
    mutationFn: (c: Car & { isNew?: boolean }) => {
      const body = { plate: c.plate, make: c.make, model: c.model, year: c.year, classId: c.classId, homeLocationId: c.homeLocationId, odometer: c.odometer, active: c.active };
      return c.isNew ? api("/staff/cars", { method: "POST", body }) : api(`/staff/cars/${c.id}`, { method: "PUT", body });
    },
    onSuccess: () => {
      refresh();
      setForm(null);
    },
    onError: (e) => setFormErr([errorText(e)]),
  });
  const addMaintenance = useMutation({
    mutationFn: (body: object) => api("/staff/maintenance", { method: "POST", body }),
    onSuccess: () => {
      refresh();
      setMMsg({ ok: true, text: "Car blocked for maintenance." });
    },
    onError: (e) => setMMsg({ ok: false, text: errorText(e) }),
  });
  const removeMaintenance = useMutation({ mutationFn: (id: string) => api(`/staff/maintenance/${id}`, { method: "DELETE" }), onSuccess: refresh });

  const byCar = new Map((status.data?.items ?? []).map((x) => [x.carId, x]));
  const rows = data.cars.map((c) => {
    const st = byCar.get(c.id);
    const serv = data.maintenance.find((x) => x.carId === c.id && Date.parse(x.from) <= now && Date.parse(x.to) > now);
    return { c, active: st?.activeReturnAt ? { returnAt: st.activeReturnAt } : undefined, serv, at: st?.locationId ?? c.homeLocationId, u: st?.utilisation30 ?? 0 };
  });

  function saveForm(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const errs: string[] = [];
    if (!form.plate.trim()) errs.push("Plate is required.");
    if (data.cars.some((c) => c.id !== form.id && c.plate.replace(/\s/g, "").toUpperCase() === form.plate.replace(/\s/g, "").toUpperCase())) errs.push("That plate is already in the fleet.");
    if (!form.make.trim() || !form.model.trim()) errs.push("Make and model are required.");
    if (!(form.year >= 2000 && form.year <= new Date().getFullYear() + 1)) errs.push("Check the year.");
    if (!(form.odometer >= 0)) errs.push("Odometer can't be negative.");
    setFormErr(errs);
    if (errs.length) return;
    saveCar.mutate({ ...form, plate: form.plate.trim().toUpperCase() });
  }

  function addMaint(e: FormEvent) {
    e.preventDefault();
    const from = fromLocalInput(m.from);
    const to = fromLocalInput(m.to);
    if (!m.carId || !from || !to) {
      setMMsg({ ok: false, text: "Choose a car, start and end." });
      return;
    }
    addMaintenance.mutate({ carId: m.carId, from, to, reason: m.reason.trim() || "Maintenance" });
  }

  const upcomingMaint = data.maintenance.filter((x) => Date.parse(x.to) > now).sort((a, b) => a.from.localeCompare(b.from));

  return (
    <>
      <div className="page-head">
        <h1>Fleet</h1>
        <span className="muted">{data.cars.filter((c) => c.active).length} active cars</span>
        <span className="spacer" />
        {admin && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setFormErr([]);
              setForm({ id: "", isNew: true, plate: "", make: "", model: "", year: new Date().getFullYear(), classId: data.classes[0].id, homeLocationId: data.locations[0].id, odometer: 0, active: true });
            }}
          >
            + Add car
          </button>
        )}
      </div>

      {form && (
        <form className="card stack" onSubmit={saveForm} noValidate style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{form.isNew ? "New car" : `Edit ${form.plate}`}</h2>
          <div className="form-grid">
            <label>
              Plate
              <input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
            </label>
            <label>
              Make
              <input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </label>
            <label>
              Model
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </label>
            <label>
              Year
              <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
            </label>
            <label>
              Class
              <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Home location
              <select value={form.homeLocationId} onChange={(e) => setForm({ ...form, homeLocationId: e.target.value })}>
                {data.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Odometer (km)
              <input type="number" min={0} value={form.odometer} onChange={(e) => setForm({ ...form, odometer: Number(e.target.value) })} />
            </label>
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Available for rent
            </label>
          </div>
          {formErr.map((er) => (
            <div key={er} className="field-error">
              {er}
            </div>
          ))}
          <div className="row">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saveCar.isPending}>
              Save car
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Car</th>
              <th>Class</th>
              <th>Now</th>
              <th className="r">Odometer</th>
              <th>30-day utilisation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, active, serv, at, u }) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.plate}</strong>
                </td>
                <td>
                  {c.year} {c.make} {c.model}
                </td>
                <td>{data.classes.find((k) => k.id === c.classId)?.name}</td>
                <td>
                  {!c.active ? (
                    <span className="badge">Retired</span>
                  ) : active ? (
                    <span className="badge badge-good">On rent · back {fmtDateTime(active.returnAt)}</span>
                  ) : serv ? (
                    <span className="badge badge-warn">In service · {serv.reason}</span>
                  ) : (
                    <span className="badge badge-brand">Ready at {loc(at)}</span>
                  )}
                </td>
                <td className="r">{c.odometer.toLocaleString("en-US")}</td>
                <td>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <div className="meter" style={{ flex: 1, minWidth: 60 }}>
                      <span style={{ width: `${Math.min(100, u * 100)}%` }} />
                    </div>
                    <span className="num small">{fmtPct(u)}</span>
                  </div>
                </td>
                <td>
                  {admin && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setFormErr([]);
                        setForm({ ...c });
                      }}
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card stack" style={{ marginTop: "1rem" }}>
        <h2 style={{ margin: 0 }}>Maintenance</h2>
        <form className="form-grid" onSubmit={addMaint} noValidate>
          <label>
            Car
            <select value={m.carId} onChange={(e) => setM({ ...m, carId: e.target.value })}>
              <option value="">Choose…</option>
              {data.cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.plate} · {c.model}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="datetime-local" value={m.from} onChange={(e) => setM({ ...m, from: e.target.value })} />
          </label>
          <label>
            To
            <input type="datetime-local" value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} />
          </label>
          <label>
            Reason
            <input value={m.reason} onChange={(e) => setM({ ...m, reason: e.target.value })} />
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn btn-primary" type="submit" disabled={addMaintenance.isPending}>
              Block car
            </button>
          </div>
        </form>
        {mMsg && <div className={`notice ${mMsg.ok ? "notice-good" : ""}`}>{mMsg.text}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Car</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {upcomingMaint.map((x) => (
                <tr key={x.id}>
                  <td>{data.cars.find((c) => c.id === x.carId)?.plate}</td>
                  <td>{fmtDateTime(x.from)}</td>
                  <td>{fmtDateTime(x.to)}</td>
                  <td>{x.reason}</td>
                  <td>
                    <button className="btn btn-sm btn-danger" disabled={removeMaintenance.isPending} onClick={() => removeMaintenance.mutate(x.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {upcomingMaint.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No current or upcoming maintenance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
