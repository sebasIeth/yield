import { NextRequest, NextResponse } from "next/server";
import { getAdminByEmail } from "@/lib/admins";
import { verifyPassword, verifyTotp, signSession } from "@/lib/admin-auth";

// scrypt + otpauth + node crypto requieren runtime Node (no Edge).
export const runtime = "nodejs";

// Login de admin: email + contraseña + código TOTP (2FA por usuario).
// Devuelve un token de sesión firmado para autorizar escrituras.
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

  // 2do factor: código TOTP del authenticator.
  if (!token) {
    return NextResponse.json(
      { error: "Ingresá el código de 6 dígitos", needsTotp: true },
      { status: 401 }
    );
  }
  if (!verifyTotp(admin.totpSecret, token)) {
    return NextResponse.json({ error: "Código 2FA incorrecto", needsTotp: true }, { status: 401 });
  }

  return NextResponse.json({ ok: true, token: signSession(admin.email), email: admin.email });
}
