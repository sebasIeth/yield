import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://api.stakek.it/v1";

// Token shape the price endpoint requires. name/symbol/decimals are mandatory;
// address (ERC-20) and coinGeckoId are used to resolve the actual price.
interface PriceToken {
  network: string;
  name: string;
  symbol: string;
  decimals: number;
  address?: string;
  coinGeckoId?: string;
}

// The endpoint keys its response by `${network}-${address}`. Native tokens have
// no address, so they come back as `${network}-undefined`. The client rebuilds
// the same key (see `priceKeyFor` in page.tsx) to look prices up.
function priceKey(network: string, address?: string): string {
  return `${network}-${(address ?? "undefined").toLowerCase()}`;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.YIELD_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const { tokenList } = (await request.json()) as { tokenList: PriceToken[] };
    if (!tokenList?.length) {
      return NextResponse.json({ prices: {} });
    }

    // Dedupe by network+address so we don't price the same token twice.
    const seen = new Set<string>();
    const unique = tokenList.filter((t) => {
      const k = priceKey(t.network, t.address);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const res = await fetch(`${BASE_URL}/tokens/prices`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ currency: "USD", tokenList: unique }),
    });

    if (!res.ok && res.status !== 201) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Prices API ${res.status}: ${body}`, prices: {} },
        { status: 200 }
      );
    }

    const prices = await res.json();
    return NextResponse.json({ prices });
  } catch (error: any) {
    console.error("Prices error:", error);
    return NextResponse.json({ error: error.message, prices: {} }, { status: 200 });
  }
}
