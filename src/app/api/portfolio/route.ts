import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://api.stakek.it/v1";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.YIELD_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const { address, integrationIds } = await request.json();

    if (!address || !integrationIds?.length) {
      return NextResponse.json({ positions: [] });
    }

    // API max is 15 integrations per request
    const BATCH_SIZE = 15;
    const chunks: string[][] = [];
    for (let i = 0; i < integrationIds.length; i += BATCH_SIZE) {
      chunks.push(integrationIds.slice(i, i + BATCH_SIZE));
    }

    const allResults: any[] = [];

    for (const chunk of chunks) {
      const queries = chunk.map((id: string) => ({
        integrationId: id,
        addresses: { address },
      }));

      try {
        const res = await fetch(`${BASE_URL}/yields/balances`, {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(queries),
        });

        if (res.status === 429) {
          console.log("Portfolio: rate limited, waiting 2s...");
          await new Promise((r) => setTimeout(r, 2000));
          const retry = await fetch(`${BASE_URL}/yields/balances`, {
            method: "POST",
            headers: {
              "X-API-KEY": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(queries),
          });
          if (retry.ok || retry.status === 201) {
            const data = await retry.json();
            allResults.push(...data);
          }
        } else if (res.ok || res.status === 201) {
          const data = await res.json();
          allResults.push(...data);
        } else {
          console.log(`Portfolio batch failed: ${res.status}`);
        }
      } catch (err) {
        console.log("Portfolio batch error:", err);
      }

      // Delay between batches
      await new Promise((r) => setTimeout(r, 300));
    }

    const positions = allResults
      .filter((d: any) => d?.balances && d.balances.length > 0)
      .map((d: any) => ({
        integrationId: d.integrationId,
        balances: d.balances.map((b: any) => ({
          type: b.type,
          amount: b.amount,
          token: {
            name: b.token.name,
            symbol: b.token.symbol,
            logoURI: b.token.logoURI,
            network: b.token.network,
          },
          pendingActions: b.pendingActions ?? [],
        })),
      }));

    console.log(`Portfolio: scanned ${allResults.length}/${integrationIds.length}, found ${positions.length} positions`);
    return NextResponse.json({ positions });
  } catch (error: any) {
    console.error("Portfolio error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error fetching portfolio" },
      { status: 500 }
    );
  }
}
