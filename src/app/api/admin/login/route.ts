import { NextRequest, NextResponse } from "next/server";

// Valida la clave de admin server-side. La usa el gate de /admin para revelar
// el panel solo con una clave correcta. Las escrituras (/api/curation) siguen
// validando la clave por su cuenta, así que esto es UX, no la única defensa.
export async function POST(request: NextRequest) {
  const adminKey = process.env.ADMIN_KEY;
  const { key } = await request.json().catch(() => ({ key: "" }));

  // Si no hay ADMIN_KEY configurada, permitimos el acceso (solo dev).
  if (!adminKey) return NextResponse.json({ ok: true });

  if (key !== adminKey) {
    return NextResponse.json({ error: "Clave incorrecta" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
