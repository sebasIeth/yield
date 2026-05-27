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

    const { yieldId, address, amount } = await request.json();

    if (!yieldId || !address || !amount) {
      return NextResponse.json(
        { error: "Missing yieldId, address, or amount" },
        { status: 400 }
      );
    }

    // Step 1: Create exit action
    const exitRes = await fetch(`${BASE_URL}/actions/exit`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        integrationId: yieldId,
        addresses: { address },
        args: { amount },
      }),
    });

    if (!exitRes.ok) {
      const errorBody = await exitRes.text().catch(() => "");
      return NextResponse.json(
        { error: `API ${exitRes.status}: ${errorBody || exitRes.statusText}` },
        { status: exitRes.status }
      );
    }

    const action = await exitRes.json();

    // Step 2: Prepare each transaction
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
    console.error("Exit yield error:", error);
    return NextResponse.json(
      { error: error.message ?? "Error exiting yield" },
      { status: 500 }
    );
  }
}
