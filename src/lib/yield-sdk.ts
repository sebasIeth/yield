import { sdk } from "@yieldxyz/sdk";

let configured = false;

export function isApiKeyConfigured(): boolean {
  const key = process.env.YIELD_API_KEY;
  return !!key && key !== "your-api-key-here";
}

export function getSDK() {
  if (!configured) {
    const apiKey = process.env.YIELD_API_KEY;
    if (!apiKey || apiKey === "your-api-key-here") {
      throw new Error("YIELD_API_KEY no configurada en .env.local");
    }
    sdk.configure({ apiKey });
    configured = true;
  }
  return sdk;
}
