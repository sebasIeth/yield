import { NextRequest, NextResponse } from "next/server";
import { getYields, isApiKeyConfigured } from "@/lib/yield-api";

export async function GET(request: NextRequest) {
  try {
    if (!isApiKeyConfigured()) {
      return NextResponse.json(
        { error: "YIELD_API_KEY not configured in .env.local" },
        { status: 500 }
      );
    }

    const { searchParams } = request.nextUrl;
    const network = searchParams.get("network") || undefined;
    const limit = Number(searchParams.get("limit")) || 50;

    const raw = await getYields({ network, limit });

    // Only show Ethereum, Polygon, and Base
    const allowedNetworks = new Set(["ethereum", "polygon", "base"]);

    const yields = raw
      .filter((y) => allowedNetworks.has(y.token.network))
      .map((y) => ({
        id: y.id,
        apy: y.apy,
        network: y.token.network,
        provider: y.metadata.provider?.name ?? y.metadata.provider?.id,
        type: y.metadata.type,
        token: {
          name: y.token.name,
          symbol: y.token.symbol,
          logoURI: y.token.logoURI,
        },
        providerLogoURI: y.metadata.provider?.logoURI,
      }));

    return NextResponse.json({ yields });
  } catch (error: any) {
    console.error("Yields API error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error fetching yields" },
      { status: 500 }
    );
  }
}
