import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { defaultTime, fromLocalInput, toLocalInput } from "../lib/format";
import { validateDates } from "../lib/rental";
import { useStore } from "../store/store";

export interface SearchValues {
  pl: string;
  rl: string;
  from: string; // datetime-local value
  to: string;
}

export function searchFromParams(p: URLSearchParams, fallbackLocation: string): SearchValues {
  return {
    pl: p.get("pl") || fallbackLocation,
    rl: p.get("rl") || p.get("pl") || fallbackLocation,
    from: p.get("from") || defaultTime(1, 10),
    to: p.get("to") || defaultTime(4, 10),
  };
}

export const searchToParams = (v: SearchValues) => new URLSearchParams({ pl: v.pl, rl: v.rl, from: v.from, to: v.to });

export function SearchForm({ initial, compact }: { initial?: SearchValues; compact?: boolean }) {
  const { data } = useStore();
  const navigate = useNavigate();
  const first = data.locations[0]?.id ?? "";
  const [v, setV] = useState<SearchValues>(initial ?? { pl: first, rl: first, from: defaultTime(1, 10), to: defaultTime(4, 10) });
  const [sameReturn, setSameReturn] = useState(v.pl === v.rl);
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const values = { ...v, rl: sameReturn ? v.pl : v.rl };
    const err = validateDates(fromLocalInput(values.from), fromLocalInput(values.to), Date.now());
    setError(err);
    if (err) return;
    navigate(`/search?${searchToParams(values)}`);
  }

  const locSelect = (key: "pl" | "rl", label: string) => (
    <label>
      {label}
      <select value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })}>
        {data.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form className={`search-form ${compact ? "compact" : ""}`} onSubmit={submit} noValidate>
      {locSelect("pl", "Pick-up location")}
      {!sameReturn && locSelect("rl", "Return location")}
      <label>
        Pick-up
        <input
          type="datetime-local"
          value={v.from}
          min={toLocalInput(Date.now())}
          step={1800}
          onChange={(e) => setV({ ...v, from: e.target.value })}
        />
      </label>
      <label>
        Return
        <input type="datetime-local" value={v.to} min={v.from} step={1800} onChange={(e) => setV({ ...v, to: e.target.value })} />
      </label>
      <button className="btn btn-primary" type="submit">
        {compact ? "Update" : "Find cars"}
      </button>
      <label className="check">
        <input type="checkbox" checked={sameReturn} onChange={(e) => setSameReturn(e.target.checked)} /> Return to the same location
      </label>
      {error && (
        <div className="field-error span-all" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
