import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getAdminByEmail, markEnrolled } from "@/lib/admins";
import { verifyPassword, verifyTotp, signSession, makeTotp } from "@/lib/admin-auth";

// scrypt + otpauth + node crypto + qrcode requieren runtime Node (no Edge).
export const runtime = "nodejs";

// Login de admin en 2 pasos:
//   Paso 1 — { email, password }: valida la contraseña.
//      · Si todavía no activó el 2FA → stage "enroll": devuelve QR + secreto
//        para cargar en Google Authenticator / Authy.
//      · Si ya lo activó → stage "totp": pide el código.
//   Paso 2 — { email, password, token }: valida el código TOTP, marca el 2FA
//      como activado (si era alta) y devuelve el token de sesión firmado.
export async function POST(request: NextRequest) {
  const { email, password, token } = await request
    .json()
    .catch(() => ({ email: "", password: "", token: "" }));

  if (!email || !password) {
    return NextResponse.json({ error: "Ingresá email y contraseña" }, { status: 400 });
  }

  const admin = await getAdminByEmail(email).catch(() => null);

  // Mensaje genérico para email/contraseña (evita enumerar usuarios).
  if (!admin || !verifyPassword(password, admin.salt, admin.hash)) {
    return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
  }

  // Paso 1: sin código todavía.
  if (!token) {
    if (!admin.totpEnrolled) {
      // Alta del 2FA: revelar el secreto/QR (la contraseña ya se validó).
      const otpauth = makeTotp(admin.totpSecret, admin.email).toString();
      const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
      return NextResponse.json({ stage: "enroll", qr, secret: admin.totpSecret });
    }
    return NextResponse.json({ stage: "totp" });
  }

  // Paso 2: validar el código TOTP.
  if (!verifyTotp(admin.totpSecret, token)) {
    return NextResponse.json({ error: "Código incorrecto. Probá con el actual.", stage: admin.totpEnrolled ? "totp" : "enroll" }, { status: 401 });
  }

  if (!admin.totpEnrolled) {
    await markEnrolled(admin.email).catch(() => {});
  }

  return NextResponse.json({ ok: true, token: signSession(admin.email), email: admin.email });
}
