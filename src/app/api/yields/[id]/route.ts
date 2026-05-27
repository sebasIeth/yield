import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://api.stakek.it/v1";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const apiKey = process.env.YIELD_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const { id } = await params;

    const res = await fetch(`${BASE_URL}/yields/${id}`, {
      headers: { "X-API-KEY": apiKey },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `API ${res.status}: ${errorBody || res.statusText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Yield detail error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error fetching yield" },
      { status: 500 }
    );
  }
}
