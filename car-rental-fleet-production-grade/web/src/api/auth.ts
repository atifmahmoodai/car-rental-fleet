import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyCatalog, CATALOG } from "../config";
import type { SessionUser } from "../../../shared/schemas";
import type { Car, Maintenance } from "../types";
import { api, ApiError, setCsrfToken } from "./client";

// Remembers that this browser has a staff login, so public pages only check the session for staff
// (customers never trigger a session lookup). Only a hint: the server still checks the real session.
const HINT = "staff-login";
export const hasStaffHint = () => {
  try {
    return localStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
};
const setHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT, "1");
    else localStorage.removeItem(HINT);
  } catch {
    // storage blocked: staff just won't get counter mode on the public pages
  }
};

interface MeResponse {
  user: SessionUser;
  csrfToken: string;
}

/** The signed-in staff member, or null (customers are never signed in). */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => {
      try {
        const r = await api<MeResponse>("/auth/me");
        setCsrfToken(r.csrfToken);
        return r.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api<MeResponse>("/auth/login", { method: "POST", body: input }),
    onSuccess: (r) => {
      setCsrfToken(r.csrfToken);
      setHint(true);
      qc.setQueryData(["me"], r.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      setCsrfToken("");
      setHint(false);
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });
}

export interface Fleet {
  user: SessionUser;
  cars: Car[];
  maintenance: Maintenance[];
  overdue: number;
  now: number;
}

/** Cars and servicing for staff screens (prices, classes and locations also refresh the catalog). */
export function useFleet(enabled = true) {
  return useQuery({
    queryKey: ["fleet"],
    enabled,
    queryFn: async () => {
      const f = await api<Fleet & Omit<typeof CATALOG, never>>("/staff/fleet");
      applyCatalog({ timeZone: f.timeZone, settings: f.settings, locations: f.locations, classes: f.classes, extras: f.extras });
      return f;
    },
    refetchInterval: 60_000,
  });
}

export const isAdmin = (u: SessionUser | null | undefined) => u?.role === "admin";
