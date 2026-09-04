import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { db, query, transaction } from "@/lib/db";
import { localDate } from "@/lib/dates";
import { getAppOrigin, getSessionSecret, getSetupToken } from "@/lib/env";
import { AppError } from "@/lib/http";
import type { Role, User } from "@/lib/types";

const SESSION_COOKIE = "hoerspiel_session";
const SESSION_DAYS = 30;

interface UserRow {
  id: string;
  email: string;
  role: Role;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hmac(value: string): string {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

function safeTokenMatches(actual: string, expected: string): boolean {
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

async function setSessionCookie(rawToken: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: getAppOrigin().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: getAppOrigin().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

async function createSession(client: PoolClient, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await client.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hmac(token), userId, expiresAt],
  );
  return { token, expiresAt };
}

export async function hasUsers(): Promise<boolean> {
  const rows = await query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM users) AS exists");
  return rows[0]?.exists ?? false;
}

export async function createOwnerAccount(input: {
  email: string;
  password: string;
  setupToken: string;
}): Promise<User> {
  if (!safeTokenMatches(input.setupToken, getSetupToken())) {
    throw new AppError("Der Setup-Schlüssel ist ungültig.", 403, "INVALID_SETUP_TOKEN");
  }
  const email = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  const result = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [81073241]);
    const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users");
    if (Number(count.rows[0]?.count || 0) > 0) {
      throw new AppError("Die Ersteinrichtung ist bereits abgeschlossen.", 404, "SETUP_CLOSED");
    }
    const created = await client.query<UserRow>(
      `INSERT INTO users (email, password_hash, role, catalog_baseline_date)
       VALUES ($1, $2, 'owner', $3)
       RETURNING id, email, role`,
      [email, passwordHash, localDate()],
    );
    const session = await createSession(client, created.rows[0].id);
    return { user: created.rows[0], session };
  });

  await setSessionCookie(result.session.token, result.session.expiresAt);
  return result.user;
}

function requestIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function loginWithPassword(
  request: Request,
  emailInput: string,
  password: string,
): Promise<User> {
  const email = normalizeEmail(emailInput);
  const ipHash = hmac(requestIp(request));
  const recent = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM login_attempts
     WHERE succeeded = false
       AND attempted_at > now() - interval '15 minutes'
       AND (email = $1 OR ip_hash = $2)`,
    [email, ipHash],
  );
  if (Number(recent[0]?.count || 0) >= 5) {
    throw new AppError("Zu viele Versuche. Bitte warte 15 Minuten.", 429, "LOGIN_THROTTLED");
  }

  const found = await db().query<UserRow & { password_hash: string }>(
    "SELECT id, email, role, password_hash FROM users WHERE lower(email) = $1 LIMIT 1",
    [email],
  );
  const user = found.rows[0];
  const valid = user ? await argon2.verify(user.password_hash, password).catch(() => false) : false;

  await db().query(
    "INSERT INTO login_attempts (email, ip_hash, succeeded) VALUES ($1, $2, $3)",
    [email, ipHash, valid],
  );
  if (!valid) {
    throw new AppError("E-Mail oder Passwort ist falsch.", 401, "INVALID_CREDENTIALS");
  }

  const session = await transaction((client) => createSession(client, user.id));
  await setSessionCookie(session.token, session.expiresAt);
  return { id: user.id, email: user.email, role: user.role };
}

export async function logoutCurrentSession(): Promise<void> {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE)?.value;
  if (rawToken) await db().query("DELETE FROM sessions WHERE token_hash = $1", [hmac(rawToken)]);
  await clearSessionCookie();
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const result = await db().query<UserRow>(
    `UPDATE sessions s
     SET last_seen_at = now()
     FROM users u
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.id = s.user_id
     RETURNING u.id, u.email, u.role`,
    [hmac(rawToken)],
  );
  if (!result.rowCount) {
    return null;
  }
  return result.rows[0];
}

export async function requirePageUser(roles?: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/");
  return user;
}

export async function requireApiUser(roles?: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Bitte melde dich an.", 401, "UNAUTHENTICATED");
  if (roles && !roles.includes(user.role)) {
    throw new AppError("Dafür fehlen dir die Rechte.", 403, "FORBIDDEN");
  }
  return user;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const result = await db().query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId],
  );
  if (!result.rowCount || !(await argon2.verify(result.rows[0].password_hash, currentPassword))) {
    throw new AppError("Das aktuelle Passwort ist falsch.", 400, "INVALID_PASSWORD");
  }
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await transaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
      passwordHash,
      userId,
    ]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  });
  await clearSessionCookie();
}
