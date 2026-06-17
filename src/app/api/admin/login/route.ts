import { NextRequest, NextResponse } from "next/server";
import { signSession, totpEnabled, verifyTotp } from "@/lib/admin-auth";

// otpauth + node crypto requieren runtime Node (no Edge).
export const runtime = "nodejs";

// Login del admin: clave (1er factor) + código TOTP (2do factor, si está
// configurado). Devuelve un token de sesión firmado para autorizar escrituras.
export async function POST(request: NextRequest) {
  const adminKey = process.env.ADMIN_KEY;
  const { key, token } = await request.json().catch(() => ({ key: "", token: "" }));

  // 1er factor: clave.
  if (adminKey && key !== adminKey) {
    return NextResponse.json({ error: "Clave incorrecta" }, { status: 401 });
  }

  // 2do factor: TOTP (solo si ADMIN_TOTP_SECRET está configurado).
  if (totpEnabled()) {
    if (!token) {
      return NextResponse.json({ error: "Ingresá el código de 6 dígitos", needsTotp: true }, { status: 401 });
    }
    if (!verifyTotp(token)) {
      return NextResponse.json({ error: "Código 2FA incorrecto", needsTotp: true }, { status: 401 });
    }
  }

  return NextResponse.json({ ok: true, token: signSession(), totp: totpEnabled() });
}
