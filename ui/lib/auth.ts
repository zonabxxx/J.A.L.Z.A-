"use client";

export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
  createdAt: string;
}

const STORAGE_KEY = "jalza_user";

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

export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return null;
}

export function loginUser(name: string): User {
  const id = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const colorIndex = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length;
  const user: User = {
    id,
    name,
    avatar: initials,
    color: COLORS[colorIndex],
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));

  const users = getKnownUsers();
  if (!users.find((u) => u.id === user.id)) {
    users.push(user);
    localStorage.setItem("jalza_users", JSON.stringify(users));
  }
  return user;
}

export function logoutUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getKnownUsers(): User[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem("jalza_users");
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return [];
}
