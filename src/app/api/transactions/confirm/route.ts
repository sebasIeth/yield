import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://api.stakek.it/v1";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.YIELD_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const { transactionId, hash } = await request.json();

    if (!transactionId || !hash) {
      return NextResponse.json(
        { error: "Missing transactionId or hash" },
        { status: 400 }
      );
    }

    const res = await fetch(`${BASE_URL}/transactions/${transactionId}`, {
      method: "PATCH",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "BROADCASTED", hash }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `API ${res.status}: ${errorBody}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Confirm tx error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error confirming transaction" },
      { status: 500 }
    );
  }
}
