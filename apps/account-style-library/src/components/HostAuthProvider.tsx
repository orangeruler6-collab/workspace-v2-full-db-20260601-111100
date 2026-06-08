"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type HostAuthUser = {
  id?: string | number;
  username?: string;
  display_name?: string;
  real_name?: string;
  group_name?: string;
  role?: string;
  title?: string;
  permissions?: string[];
};

type HostAuthContextValue = {
  user: HostAuthUser | null;
  ready: boolean;
  ownerKey: string;
};

const HOST_AUTH_STORAGE_KEY = "usagi_auth_user";
const HostAuthContext = createContext<HostAuthContextValue>({
  user: null,
  ready: true,
  ownerKey: ""
});

export function HostAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<HostAuthUser | null>(() => readStoredHostAuthUser());
  const [ready, setReady] = useState(() => !isEmbeddedInHost());

  useEffect(() => {
    let settled = false;

    function commit(nextUser: HostAuthUser | null) {
      const previousKey = ownerKeyFromUser(readStoredHostAuthUser());
      const nextKey = ownerKeyFromUser(nextUser);
      writeStoredHostAuthUser(nextUser);
      setUser(nextUser);
      setReady(true);
      settled = true;
      if (previousKey !== nextKey) {
        window.dispatchEvent(new CustomEvent("usagi:host-auth-changed", { detail: { ownerKey: nextKey } }));
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "usagi-auth-user") return;
      commit(normalizeHostAuthUser(event.data.user));
    }

    window.addEventListener("message", handleMessage);
    window.parent?.postMessage({ type: "usagi-auth-request" }, window.location.origin);

    const fallback = window.setTimeout(() => {
      if (!settled) setReady(true);
    }, 1200);

    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const ownerKey = ownerKeyFromUser(user);
  const value = useMemo(() => ({ user, ready, ownerKey }), [ownerKey, ready, user]);
  return <HostAuthContext.Provider value={value}>{children}</HostAuthContext.Provider>;
}

export function useHostAuth() {
  return useContext(HostAuthContext);
}

function isEmbeddedInHost() {
  if (typeof window === "undefined") return false;
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

function readStoredHostAuthUser() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HOST_AUTH_STORAGE_KEY);
    return raw ? normalizeHostAuthUser(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStoredHostAuthUser(user: HostAuthUser | null) {
  try {
    if (user) window.localStorage.setItem(HOST_AUTH_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(HOST_AUTH_STORAGE_KEY);
  } catch {}
}

function normalizeHostAuthUser(value: unknown): HostAuthUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as HostAuthUser;
  return {
    id: user.id,
    username: typeof user.username === "string" ? user.username : undefined,
    display_name: typeof user.display_name === "string" ? user.display_name : undefined,
    real_name: typeof user.real_name === "string" ? user.real_name : undefined,
    group_name: typeof user.group_name === "string" ? user.group_name : undefined,
    role: typeof user.role === "string" ? user.role : undefined,
    title: typeof user.title === "string" ? user.title : undefined,
    permissions: Array.isArray(user.permissions) ? user.permissions.filter((item): item is string => typeof item === "string") : []
  };
}

function ownerKeyFromUser(user: HostAuthUser | null) {
  const stable = user?.id ?? user?.username ?? user?.display_name ?? "";
  return stable ? `user:${String(stable)}` : "";
}
