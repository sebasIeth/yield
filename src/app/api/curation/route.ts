import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { EMPTY_CURATION, RISK_ORDER, type Curation } from "@/lib/risk";

// Curación de bolsas por perfil de riesgo, persistida en MongoDB.
// Colección `curation`, documento único con _id "default":
//   { _id: "default", low: string[], medium: string[], high: string[] }
const COLLECTION = "curation";
const DOC_ID = "default";

// El driver de Mongo abre sockets — esta ruta debe correr en Node, no Edge.
export const runtime = "nodejs";

async function readCuration(): Promise<Curation> {
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID as any });
  if (!doc) return { ...EMPTY_CURATION };
  return {
    low: Array.isArray(doc.low) ? doc.low : [],
    medium: Array.isArray(doc.medium) ? doc.medium : [],
    high: Array.isArray(doc.high) ? doc.high : [],
    hidden: Array.isArray(doc.hidden) ? doc.hidden : [],
  };
}

export async function GET() {
  try {
    return NextResponse.json({ curation: await readCuration() });
  } catch (error: any) {
    // Si Mongo no está disponible, devolvemos bolsas vacías (la app cae al
    // fallback automático por riesgo) en vez de romper la UI.
    console.error("Curation GET error:", error);
    return NextResponse.json({ curation: { ...EMPTY_CURATION }, error: error.message });
  }
}

export async function POST(request: NextRequest) {
  // Solo el admin puede curar. La vista de usuario es de solo lectura.
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && request.headers.get("x-admin-key") !== adminKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const clean = (ids: unknown) =>
      Array.from(
        new Set((Array.isArray(ids) ? ids : []).filter((x: unknown) => typeof x === "string"))
      ) as string[];

    const next: Curation = { low: [], medium: [], high: [], hidden: [] };
    for (const level of RISK_ORDER) {
      next[level] = clean(body?.[level]);
    }
    next.hidden = clean(body?.hidden);

    const db = await getDb();
    await db.collection(COLLECTION).updateOne(
      { _id: DOC_ID as any },
      { $set: { ...next, updatedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, curation: next });
  } catch (error: any) {
    console.error("Curation POST error:", error);
    return NextResponse.json({ error: error.message ?? "Error saving" }, { status: 500 });
  }
}
