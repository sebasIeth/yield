const BASE_URL = "https://api.stakek.it/v1";

function getApiKey(): string | null {
  const key = process.env.YIELD_API_KEY;
  if (!key || key === "your-api-key-here") return null;
  return key;
}

export function isApiKeyConfigured(): boolean {
  return getApiKey() !== null;
}

async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("YIELD_API_KEY not configured");

  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "X-API-KEY": apiKey },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }

  return res.json();
}

export interface YieldToken {
  network: string;
  name: string;
  symbol: string;
  logoURI?: string;
}

export interface YieldItem {
  id: string;
  apy: number;
  token: YieldToken;
  metadata: {
    name: string;
    type: string;
    logoURI?: string;
    provider?: {
      id: string;
      name: string;
      logoURI?: string;
    };
  };
}

interface YieldsResponse {
  data: YieldItem[];
  hasNextPage: boolean;
  limit: number;
  page: number;
}

// In-memory cache (5 minutes)
let cachedYields: YieldItem[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function dedupe(yields: YieldItem[]): YieldItem[] {
  const seen = new Set<string>();
  return yields.filter((y) => {
    if (seen.has(y.id)) return false;
    seen.add(y.id);
    return true;
  });
}

export async function getYields(opts?: {
  network?: string;
}): Promise<YieldItem[]> {
  const now = Date.now();

  if (!opts?.network && cachedYields && now - cacheTime < CACHE_TTL) {
    return cachedYields;
  }

  const pageSize = 100;
  const maxPages = 10;
  // Fetch all pages in parallel (fire pages 0-9 at once)
  const pagePromises = Array.from({ length: maxPages }, (_, i) => {
    const params: Record<string, string> = {
      limit: String(pageSize),
      page: String(i),
    };
    if (opts?.network) params.network = opts.network;
    return apiFetch<YieldsResponse>("/yields", params).catch(() => null);
  );

  const pages = await Promise.all(pagePromises);

  const allYields: YieldItem[] = [];
  for (const page of pages) {
    if (page && page.data.length > 0) {
      allYields.push(...page.data);
    }
  }

  const unique = dedupe(allYields);

  if (!opts?.network) {
    cachedYields = unique;
    cacheTime = now;
  }

  return unique;
}

export async function getNetworks(): Promise<string[]> {
  const yields = await getYields();
  const networks = new Set(yields.map((y) => y.token.network));
  return Array.from(networks).sort();
}
