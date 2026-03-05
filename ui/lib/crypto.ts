import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const secret = new TextEncoder().encode(
  process.env.JALZA_SESSION_SECRET || "fallback-insecure-change-me"
);

export interface JalzaTokenPayload extends JWTPayload {
  userId: string;
  name: string;
  role: string;
}

export async function createSessionToken(payload: {
  userId: string;
  name: string;
  role: string;
}): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<JalzaTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as JalzaTokenPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "jalza_session";
export const SESSION_MAX_AGE = 86400; // 24h
