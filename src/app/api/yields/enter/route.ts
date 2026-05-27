import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://api.stakek.it/v1";

function apiHeaders() {
  return {
    "X-API-KEY": process.env.YIELD_API_KEY!,
    "Content-Type": "application/json",
  };
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.YIELD_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { yieldId, address, amount } = body;

    if (!yieldId || !address || !amount) {
      return NextResponse.json(
        { error: "Missing yieldId, address, or amount" },
        { status: 400 }
      );
    }

    // Step 1: Create the action
    const enterRes = await fetch(`${BASE_URL}/actions/enter`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        integrationId: yieldId,
        addresses: { address },
        args: { amount },
      }),
    });

    if (!enterRes.ok) {
      const errorBody = await enterRes.text().catch(() => "");
      return NextResponse.json(
        { error: `API ${enterRes.status}: ${errorBody || enterRes.statusText}` },
        { status: enterRes.status }
      );
    }

    const action = await enterRes.json();

    // Step 2: For each transaction, request the unsigned tx data
    const preparedTxs = [];

    for (const tx of action.transactions ?? []) {
      const patchRes = await fetch(`${BASE_URL}/transactions/${tx.id}`, {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({ status: "WAITING_FOR_SIGNATURE" }),
      });

      if (!patchRes.ok) {
        const errorBody = await patchRes.text().catch(() => "");
        return NextResponse.json(
          { error: `Failed to prepare transaction: ${errorBody}` },
          { status: patchRes.status }
        );
      }

      const prepared = await patchRes.json();
      preparedTxs.push(prepared);
    }

    return NextResponse.json({
      actionId: action.id,
      transactions: preparedTxs,
    });
  } catch (error: any) {
    console.error("Enter yield error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error entering yield" },
      { status: 500 }
    );
  }
}
