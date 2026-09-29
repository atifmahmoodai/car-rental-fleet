import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { isAdmin, useFleet, useMe } from "../../api/auth";
import { api, ApiError, errorText } from "../../api/client";
import { CATALOG } from "../../config";
import type { Role } from "../../../../shared/schemas";
import type { CarClass, Settings } from "../../types";

const toCents = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s) * 100) : NaN);
const fromCents = (c: number) => (c / 100).toFixed(2);

const MONEY_FIELDS: [keyof Settings, string][] = [
  ["youngDriverFeePerDayCents", "Young driver fee / day"],
  ["oneWayFeeCents", "One-way fee"],
  ["fuelChargePerEighthCents", "Fuel charge per 1/8 tank"],
];
const NUMBER_FIELDS: [keyof Settings, string, number, number][] = [
  ["taxPercent", "Tax %", 0, 50],
  ["weeklyDiscountPercent", "7+ day discount %", 0, 90],
  ["monthlyDiscountPercent", "28+ day discount %", 0, 90],
  ["bufferHours", "Cleaning buffer (hours)", 0, 48],
  ["graceMinutes", "Late-return grace (minutes)", 0, 240],
  ["minDriverAge", "Minimum driver age", 16, 30],
  ["youngDriverAge", "Young driver under", 16, 35],
  ["freeCancellationHours", "Free cancellation until (hours before)", 0, 720],
];
const WHOLE_NUMBERS = new Set<keyof Settings>(["graceMinutes", "minDriverAge", "youngDriverAge", "freeCancellationHours"]);

export function AdminSettings() {
  const me = useMe();
  if (!isAdmin(me.data)) return <Navigate to="/admin" replace />;
  return (
    <>
      <div className="page-head">
        <h1>Prices, settings &amp; users</h1>
      </div>
      <PricesForm />
      <Users />
    </>
  );
}

function PricesForm() {
  const qc = useQueryClient();
  // The fleet query also refreshes CATALOG (settings and classes) that the form starts from.
  useFleet();
  const [s, setS] = useState<Settings>(() => structuredClone(CATALOG.settings));
  const [money, setMoney] = useState<Record<string, string>>(() => Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, fromCents(CATALOG.settings[k] as number)])));
  const [rates, setRates] = useState<Record<string, { rate: string; deposit: string }>>(() =>
    Object.fromEntries(CATALOG.classes.map((c) => [c.id, { rate: fromCents(c.dailyRateCents), deposit: fromCents(c.depositCents) }])),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async ({ settings, classes }: { settings: Settings; classes: CarClass[] }) => {
      await api("/staff/settings", { method: "PUT", body: settings });
      // Only classes whose price changed are sent.
      for (const { id, ...cls } of classes) await api(`/staff/classes/${id}`, { method: "PUT", body: cls });
    },
    onSuccess: () => setSaved(true),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["fleet"] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const errs: string[] = [];
    if (!s.name.trim()) errs.push("Business name is required.");
    for (const [k, label, min, max] of NUMBER_FIELDS) {
      const v = s[k] as number;
      if (!(Number.isFinite(v) && v >= min && v <= max)) errs.push(`${label} must be between ${min} and ${max}.`);
      else if (WHOLE_NUMBERS.has(k) && !Number.isInteger(v)) errs.push(`${label} must be a whole number.`);
    }
    if (s.youngDriverAge < s.minDriverAge) errs.push("Young-driver age can't be below the minimum age.");
    for (const [k, label] of MONEY_FIELDS) if (!(toCents(money[k] ?? "") >= 0)) errs.push(`${label} must be an amount like 12.50.`);
    for (const c of CATALOG.classes) {
      const r = rates[c.id];
      if (!r || !(toCents(r.rate) > 0)) errs.push(`${c.name}: enter a daily rate above 0.`);
      if (!r || !(toCents(r.deposit) >= 0)) errs.push(`${c.name}: enter a deposit.`);
    }
    const currency = s.currency.trim().toUpperCase();
    try {
      new Intl.NumberFormat(s.locale.trim(), { style: "currency", currency });
    } catch {
      errs.push("Currency / locale isn't valid (e.g. USD / en-US, PKR / en-PK, AED / en-AE).");
    }
    setErrors(errs);
    if (errs.length) return;
    const settings = { ...s, name: s.name.trim(), currency, locale: s.locale.trim() };
    for (const [k] of MONEY_FIELDS) (settings as Record<string, unknown>)[k] = toCents(money[k]);
    const classes = CATALOG.classes
      .map((c) => ({ ...c, dailyRateCents: toCents(rates[c.id].rate), depositCents: toCents(rates[c.id].deposit) }))
      .filter((c, i) => c.dailyRateCents !== CATALOG.classes[i].dailyRateCents || c.depositCents !== CATALOG.classes[i].depositCents);
    save.mutate({ settings, classes });
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Daily rates</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Daily rate</th>
                <th>Deposit</th>
              </tr>
            </thead>
            <tbody>
              {CATALOG.classes.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name} <span className="muted small">· {c.example}</span>
                  </td>
                  <td>
                    <input
                      aria-label={`${c.name} daily rate`}
                      inputMode="decimal"
                      value={rates[c.id]?.rate ?? ""}
                      onChange={(e) => setRates({ ...rates, [c.id]: { ...rates[c.id], rate: e.target.value } })}
                      style={{ marginTop: 0, maxWidth: 140 }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${c.name} deposit`}
                      inputMode="decimal"
                      value={rates[c.id]?.deposit ?? ""}
                      onChange={(e) => setRates({ ...rates, [c.id]: { ...rates[c.id], deposit: e.target.value } })}
                      style={{ marginTop: 0, maxWidth: 140 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Business &amp; rules</h2>
        <div className="form-grid">
          {(["name", "phone", "email", "currency", "locale"] as const).map((k) => (
            <label key={k}>
              {k[0].toUpperCase() + k.slice(1)}
              <input value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
            </label>
          ))}
          {NUMBER_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                type="number"
                value={Number.isNaN(s[k]) ? "" : String(s[k])}
                onChange={(e) => setS({ ...s, [k]: e.target.value === "" ? NaN : Number(e.target.value) })}
              />
            </label>
          ))}
          {MONEY_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              <input inputMode="decimal" value={money[k] ?? ""} onChange={(e) => setMoney({ ...money, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Desk time zone: {CATALOG.timeZone} (set by the server's TIMEZONE setting).
        </p>
      </section>
      {errors.length > 0 && (
        <div className="notice" role="alert">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {errors.map((er) => (
              <li key={er}>{er}</li>
            ))}
          </ul>
        </div>
      )}
      {save.isError && (
        <div className="notice" role="alert">
          {errorText(save.error)}
        </div>
      )}
      {saved && (
        <div className="notice notice-good" role="status">
          Saved. New prices apply to new bookings; existing bookings keep the price they were quoted.
        </div>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save prices & settings"}
        </button>
      </div>
    </form>
  );
}

interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  locked: boolean;
}

const ROLE_LABELS: { id: Role; label: string }[] = [
  { id: "agent", label: "Agent (desk: bookings, check-out/in, fleet)" },
  { id: "admin", label: "Admin (also prices, cars, users)" },
];

function Users() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<{ items: StaffUser[] }>("/staff/users") });
  const [editing, setEditing] = useState<StaffUser | "new" | null>(null);
  return (
    <section className="card stack" style={{ marginTop: "1rem" }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>Staff logins</h2>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
          + Add user
        </button>
      </div>
      {q.isError && <div className="notice">{errorText(q.error)}</div>}
      {q.data?.items.map((u) => (
        <div key={u.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            <strong>{u.name}</strong> <span className="muted small">{u.email} · {u.role}</span>{" "}
            {!u.active ? <span className="badge">Disabled</span> : u.locked ? <span className="badge badge-bad">Locked</span> : null}
          </span>
          <button className="btn btn-sm" onClick={() => setEditing(u)}>
            Edit
          </button>
        </div>
      ))}
      {editing && <UserDialog user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ["users"] })} />}
    </section>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: StaffUser | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? ("agent" as Role), active: user?.active ?? true, password: "" });
  const [done, setDone] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (!user) return api("/staff/users", { method: "POST", body: { email: f.email, name: f.name, role: f.role, password: f.password } });
      await api(`/staff/users/${user.id}`, { method: "PUT", body: { name: f.name, role: f.role, active: f.active } });
      if (f.password) await api(`/staff/users/${user.id}/password`, { method: "POST", body: { password: f.password } });
    },
    onSuccess: () => {
      onSaved();
      if (user && f.password) setDone("Saved. The new password is active and their other sessions were signed out.");
      else onClose();
    },
  });
  const errs = save.error instanceof ApiError ? save.error.details : {};
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={user ? "Edit user" : "Add user"} onClick={onClose}>
      <form
        className="card modal stack"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <h2 style={{ margin: 0 }}>{user ? `Edit ${user.name}` : "Add user"}</h2>
        <label>
          Name
          <input value={f.name} onChange={(e) => set("name", e.target.value)} />
          {errs.name && <div className="field-error">{errs.name}</div>}
        </label>
        <label>
          Email
          <input type="email" value={f.email} disabled={!!user} onChange={(e) => set("email", e.target.value)} />
          {errs.email && <div className="field-error">{errs.email}</div>}
        </label>
        <label>
          Role
          <select value={f.role} onChange={(e) => set("role", e.target.value)}>
            {ROLE_LABELS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {user ? "New password (leave blank to keep)" : "Password"}
          <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} />
          <span className="muted small">At least 10 characters with letters and a number.</span>
          {errs.password && <div className="field-error">{errs.password}</div>}
        </label>
        {user && (
          <label style={{ display: "flex", alignItems: "center" }}>
            <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Active (untick when someone leaves)
          </label>
        )}
        {save.isError && !Object.keys(errs).length && <div className="field-error">{errorText(save.error)}</div>}
        {done && <div className="notice notice-good">{done}</div>}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
