import crypto from "crypto";
import { TOTP, Secret } from "otpauth";

// Autenticación de admins: email + contraseña (scrypt) + TOTP (2FA por usuario).
// Tras login válido se emite un token de sesión firmado (HMAC) con vencimiento,
// que protege también las escrituras de /api/curation.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

// Secreto de firma del servidor (nunca llega al cliente).
function sessionSecret(): string {
  return process.env.ADMIN_KEY ?? "dev-session-secret";
}

// ── Contraseñas (scrypt) ──

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  try {
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ── TOTP (2FA) ──

export function makeTotp(base32Secret: string, label = "admin"): TOTP {
  return new TOTP({
    issuer: "Yield Admin",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(base32Secret),
  });
}

/** Valida un código de 6 dígitos contra el secreto del admin. Ventana ±1. */
export function verifyTotp(base32Secret: string, token: string): boolean {
  const clean = String(token ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return makeTotp(base32Secret).validate({ token: clean, window: 1 }) !== null;
  } catch {
    return false;
  }
}

// ── Token de sesión (HMAC firmado) ──

export function signSession(email: string): string {
  const payload = { sub: email, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | null): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  try {
    const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}
