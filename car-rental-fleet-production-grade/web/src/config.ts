import { setDeskTimeZone } from "../../shared/format";
import type { Catalog } from "../../shared/schemas";
import { DEFAULT_SETTINGS } from "../../shared/settings-defaults";

/**
 * Prices, locations, car classes and extras come from the server once at start-up (main.tsx)
 * and are read synchronously everywhere, like the demo's constants.
 */
export const CATALOG: Catalog = { timeZone: "UTC", settings: structuredClone(DEFAULT_SETTINGS), locations: [], classes: [], extras: [] };

export function applyCatalog(c: Catalog) {
  Object.assign(CATALOG, c);
  setDeskTimeZone(c.timeZone);
  document.title = `${c.settings.name} · Car rental`;
}

export const locationName = (id: string) => CATALOG.locations.find((l) => l.id === id)?.name ?? "?";
export const className = (id: string) => CATALOG.classes.find((c) => c.id === id)?.name ?? "?";
