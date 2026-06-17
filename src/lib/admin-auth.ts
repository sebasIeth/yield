import crypto from "crypto";
import { TOTP, Secret } from "otpauth";

// Autenticación del admin: clave (1er factor) + TOTP (2do factor). Tras un
// login válido se emite un token de sesión firmado (HMAC) con vencimiento, que
// protege también las escrituras de /api/curation — así el 2FA cubre la API,
// no sólo la pantalla.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

function sessionSecret(): string {
  // El secreto de firma deriva de los secretos del servidor; nunca llega al
  // cliente. Cambiar la clave o el secreto TOTP invalida las sesiones viejas.
  return `${process.env.ADMIN_KEY ?? "dev"}::${process.env.ADMIN_TOTP_SECRET ?? "nototp"}`;
}

/** Devuelve la instancia TOTP si hay secreto configurado; si no, null (2FA off). */
export function getTotp(): TOTP | null {
  const s = process.env.ADMIN_TOTP_SECRET;
  if (!s) return null;
  return new TOTP({
    issuer: "Yield Admin",
    label: "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(s),
  });
}

export function totpEnabled(): boolean {
  return !!process.env.ADMIN_TOTP_SECRET;
}

/** Valida un código de 6 dígitos. Ventana ±1 para tolerar desfase de reloj. */
export function verifyTotp(token: string): boolean {
  const totp = getTotp();
  if (!totp) return true; // 2FA no configurado → no se exige
  const clean = String(token ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return totp.validate({ token: clean, window: 1 }) !== null;
}

export function signSession(): string {
  const payload = { exp: Date.now() + SESSION_TTL_MS };
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
