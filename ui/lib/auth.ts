"use client";

export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
  role: string;
}

const COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-purple-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-pink-600",
];

function makeAvatar(name: string): { avatar: string; color: string } {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const id = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const colorIndex = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length;
  return { avatar: initials, color: COLORS[colorIndex] };
}

export async function checkSession(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check" }),
    });
    const data = await res.json();
    if (data.authenticated && data.user) {
      const { avatar, color } = makeAvatar(data.user.name);
      return { ...data.user, avatar, color };
    }
    return null;
  } catch {
    return null;
  }
}

export async function hasUsers(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "has_users" }),
    });
    const data = await res.json();
    return data.has_users === true;
  } catch {
    return false;
  }
}

export async function loginUser(
  name: string,
  password: string
): Promise<{ user?: User; error?: string }> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", name, password }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Chyba prihlásenia" };
    const { avatar, color } = makeAvatar(data.user.name);
    return { user: { ...data.user, avatar, color } };
  } catch {
    return { error: "Server nedostupný" };
  }
}

export async function registerUser(
  name: string,
  password: string,
  setupKey: string
): Promise<{ user?: User; error?: string }> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", name, password, setup_key: setupKey }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Chyba registrácie" };
    const { avatar, color } = makeAvatar(data.user.name);
    return { user: { ...data.user, avatar, color } };
  } catch {
    return { error: "Server nedostupný" };
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
  } catch {
    // ignore
  }
}
