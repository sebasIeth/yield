import { NextResponse } from "next/server";
import { getNetworks, isApiKeyConfigured } from "@/lib/yield-api";

export async function GET() {
  try {
    if (!isApiKeyConfigured()) {
      return NextResponse.json(
        { error: "YIELD_API_KEY not configured" },
        { status: 500 }
      );
    }

    const networks = await getNetworks();
    return NextResponse.json({
      networks: networks.map((n) => ({ id: n, name: n })),
    });
  } catch (error: any) {
    console.error("Networks API error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error fetching networks" },
      { status: 500 }
    );
  }
}
