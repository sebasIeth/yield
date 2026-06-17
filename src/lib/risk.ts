// ── Risk profiles & curation ──
//
// Three investor profiles. Each yield can be assigned to one or more profiles
// by an admin (see /api/curation). When an admin hasn't curated a profile yet,
// we fall back to an automatic heuristic so the "bag" is never empty.

export type RiskLevel = "low" | "medium" | "high";

export const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

export interface RiskProfile {
  id: RiskLevel;
  label: string; // investor archetype
  short: string; // risk wording
  tagline: string;
  description: string;
  apyHint: string;
  accent: string; // CSS color var
}

export const RISK_PROFILES: Record<RiskLevel, RiskProfile> = {
  low: {
    id: "low",
    label: "Conservador",
    short: "Riesgo bajo",
    tagline: "Preservar capital",
    description:
      "Stablecoins y staking líquido de primeras marcas. Prioriza rendimientos estables y previsibles sobre el máximo retorno.",
    apyHint: "~2–5% APY",
    accent: "var(--green)",
  },
  medium: {
    id: "medium",
    label: "Balanceado",
    short: "Riesgo medio",
    tagline: "Crecer con equilibrio",
    description:
      "Mezcla de staking, restaking y lending de activos sólidos. Más rendimiento aceptando algo de volatilidad.",
    apyHint: "~5–10% APY",
    accent: "var(--accent)",
  },
  high: {
    id: "high",
    label: "Agresivo",
    short: "Riesgo alto",
    tagline: "Maximizar retorno",
    description:
      "Pools de liquidez, vaults y estrategias de alto APY. Mayor potencial de rendimiento con mayor riesgo y volatilidad.",
    apyHint: "10%+ APY",
    accent: "var(--red)",
  },
};

// Minimal shape needed to classify a yield.
export interface ClassifiableYield {
  apy?: number;
  type?: string;
  token?: { symbol?: string };
}

const STABLES = new Set([
  "USDC", "USDT", "DAI", "USDS", "FRAX", "TUSD", "USDP", "GUSD", "LUSD",
  "PYUSD", "USDE", "SUSD", "CRVUSD", "GHO", "USD1", "SRUSD", "USDD", "MIM",
]);

/**
 * Automatic risk classification, dirigida principalmente por APY (el retorno es
 * el mejor proxy de riesgo cuando hay tantos productos distintos), con el tipo
 * de estrategia como modificador.
 */
export function classifyRisk(y: ClassifiableYield): RiskLevel {
  const apy = y.apy ?? 0;
  const type = (y.type ?? "").toLowerCase();
  const symbol = (y.token?.symbol ?? "").toUpperCase();
  const isStable = STABLES.has(symbol);
  const risky =
    type.includes("liquidity") ||
    type.includes("pool") ||
    type.includes("vault") ||
    type.includes("farm");

  // Sin APY conocida: clasificar por tipo. (Estos quedan fuera de las bolsas,
  // que sólo muestran APY > 0, pero el badge del admin lo usa igual.)
  if (apy <= 0) return risky ? "high" : "medium";

  // Alto: APY elevada o estrategias de mayor riesgo (LP / vault / farm).
  if (apy >= 0.08 || risky) return "high";
  // Bajo: APY contenida, o stablecoin con rendimiento moderado.
  if (apy <= 0.045 || (isStable && apy <= 0.06)) return "low";
  // Medio: el resto.
  return "medium";
}

export interface Curation {
  low: string[];
  medium: string[];
  high: string[];
  /** Yields "apagados": no se muestran en ningún perfil ni en Explore. */
  hidden: string[];
}

export const EMPTY_CURATION: Curation = { low: [], medium: [], high: [], hidden: [] };

/**
 * Construye la bolsa automática para un perfil cuando el admin no la curó.
 * Sólo considera yields con APY > 0 y garantiza que nunca quede vacía: si la
 * clasificación no produce nada para ese nivel, reparte por terciles de APY
 * (bajo = tercio inferior, alto = tercio superior). Devuelve hasta `limit`
 * ordenados por APY desc.
 */
export function autoBag<T extends ClassifiableYield>(
  yields: T[],
  level: RiskLevel,
  limit = 12
): T[] {
  const live = yields.filter((y) => (y.apy ?? 0) > 0);
  let bag = live.filter((y) => classifyRisk(y) === level);

  if (bag.length === 0 && live.length > 0) {
    const asc = [...live].sort((a, b) => (a.apy ?? 0) - (b.apy ?? 0));
    const t = Math.ceil(asc.length / 3);
    bag =
      level === "low"
        ? asc.slice(0, t)
        : level === "medium"
        ? asc.slice(t, 2 * t)
        : asc.slice(2 * t);
  }

  return [...bag].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0)).slice(0, limit);
}
