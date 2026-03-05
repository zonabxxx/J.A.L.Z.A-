import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/crypto";
import { backendPost, backendGet } from "@/lib/api-client";

const LOGIN_ATTEMPTS = new Map<
  string,
  { count: number; resetAt: number }
>();

function checkLoginRate(ip: string): boolean {
  const now = Date.now();
  const entry = LOGIN_ATTEMPTS.get(ip);
  if (!entry || now > entry.resetAt) {
    LOGIN_ATTEMPTS.set(ip, { count: 1, resetAt: now + 900_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (action === "check") {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ authenticated: false });

    const payload = await verifySessionToken(token);
    if (!payload) {
      jar.delete(SESSION_COOKIE);
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({
      authenticated: true,
      user: {
        id: payload.userId,
        name: payload.name,
        role: payload.role,
      },
    });
  }

  if (action === "has_users") {
    try {
      const res = await backendGet("/auth/check");
      return NextResponse.json(await res.json());
    } catch {
      return NextResponse.json({ has_users: false });
    }
  }

  if (action === "register") {
    if (!checkLoginRate(ip)) {
      return NextResponse.json(
        { error: "Príliš veľa pokusov. Skús o 15 minút." },
        { status: 429 }
      );
    }

    const setupKey = process.env.JALZA_SETUP_KEY;
    if (setupKey && body.setup_key !== setupKey) {
      return NextResponse.json(
        { error: "Neplatný registračný kľúč." },
        { status: 403 }
      );
    }

    try {
      const res = await backendPost("/auth/register", {
        name: body.name,
        password: body.password,
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json(data, { status: res.status });

      const token = await createSessionToken({
        userId: data.user.id,
        name: data.user.name,
        role: data.user.role || "user",
      });

      const jar = await cookies();
      jar.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });

      return NextResponse.json({ user: data.user });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Server error" },
        { status: 500 }
      );
    }
  }

  if (action === "login") {
    if (!checkLoginRate(ip)) {
      return NextResponse.json(
        { error: "Príliš veľa pokusov. Skús o 15 minút." },
        { status: 429 }
      );
    }

    try {
      const res = await backendPost("/auth/login", {
        name: body.name,
        password: body.password,
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json(data, { status: res.status });

      const token = await createSessionToken({
        userId: data.user.id,
        name: data.user.name,
        role: data.user.role || "user",
      });

      const jar = await cookies();
      jar.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });

      return NextResponse.json({ user: data.user });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Server error" },
        { status: 500 }
      );
    }
  }

  if (action === "logout") {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    return NextResponse.json({ status: "ok" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
