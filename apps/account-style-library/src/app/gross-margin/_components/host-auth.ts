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

export const HOST_AUTH_STORAGE_KEY = "usagi_auth_user";
export const HOST_AUTH_HEADER = "x-usagi-auth-user";

export function readHostAuthUser(): HostAuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HOST_AUTH_STORAGE_KEY);
    return raw ? normalizeHostAuthUser(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeHostAuthUser(user: HostAuthUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) window.localStorage.setItem(HOST_AUTH_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(HOST_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures; live postMessage auth still updates the page.
  }
}

export function normalizeHostAuthUser(value: unknown): HostAuthUser | null {
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

export function isHostAdmin(user: HostAuthUser | null) {
  return user?.role === "admin";
}

export function encodeHostAuthHeader(user: HostAuthUser | null) {
  if (!user) return "";
  try {
    return encodeURIComponent(JSON.stringify(user));
  } catch {
    return "";
  }
}
