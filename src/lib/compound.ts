// ── Compound growth / wealth projection ──
//
// Models how a portfolio grows over time when yield is reinvested
// (compounded) vs. paid out (simple), with optional recurring contributions.
// All amounts are in the portfolio's display currency (USD).

export interface ProjectionInput {
  /** Starting balance (e.g. current invested USD). */
  principal: number;
  /** Recurring contribution added every month. */
  monthlyContribution: number;
  /** Annual percentage yield as a decimal (e.g. 0.05 = 5%). */
  apy: number;
  /** Horizon in years. */
  years: number;
}

export interface ProjectionPoint {
  /** Months elapsed from start. */
  month: number;
  /** Total money the user has put in (principal + contributions so far). */
  contributed: number;
  /** Balance if every reward is reinvested (compounded). */
  reinvested: number;
  /** Balance if rewards are withdrawn instead of reinvested. */
  simple: number;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  /** Final values at the end of the horizon. */
  finalReinvested: number;
  finalSimple: number;
  totalContributed: number;
  /** Yield earned when reinvesting (finalReinvested - totalContributed). */
  yieldReinvested: number;
  /** Extra money earned purely from reinvesting vs. withdrawing. */
  reinvestmentBonus: number;
}

/**
 * Convert an APY into the equivalent effective monthly rate, so that
 * compounding monthly over a year reproduces the stated APY exactly.
 */
function monthlyRate(apy: number): number {
  return Math.pow(1 + apy, 1 / 12) - 1;
}

/**
 * Project portfolio growth month by month.
 *
 * Reinvested track: balance compounds each month and contributions are added.
 *   B_{n+1} = B_n * (1 + r) + C
 *
 * Simple track: rewards are paid out (not compounded). The balance only grows
 * via contributions, while earned yield accrues linearly on the principal that
 * is actually deposited at each point in time.
 */
export function projectGrowth(input: ProjectionInput): ProjectionResult {
  const { principal, monthlyContribution, apy, years } = input;
  const totalMonths = Math.max(0, Math.round(years * 12));
  const r = monthlyRate(apy);

  const points: ProjectionPoint[] = [];

  let reinvested = principal;
  let contributed = principal;
  // Simple track: separate the deposited capital from paid-out earnings.
  let simpleCapital = principal;
  let simpleEarnings = 0;

  points.push({ month: 0, contributed, reinvested, simple: simpleCapital });

  for (let m = 1; m <= totalMonths; m++) {
    // Reinvested: compound then contribute.
    reinvested = reinvested * (1 + r) + monthlyContribution;

    // Simple: yield is earned on the deposited capital but paid out, so it
    // accumulates separately and never compounds.
    simpleEarnings += simpleCapital * r;
    simpleCapital += monthlyContribution;

    contributed += monthlyContribution;

    points.push({
      month: m,
      contributed,
      reinvested,
      simple: simpleCapital + simpleEarnings,
    });
  }

  const finalReinvested = reinvested;
  const finalSimple = simpleCapital + simpleEarnings;

  return {
    points,
    finalReinvested,
    finalSimple,
    totalContributed: contributed,
    yieldReinvested: finalReinvested - contributed,
    reinvestmentBonus: finalReinvested - finalSimple,
  };
}

/**
 * Goal solver: how many years until the portfolio reaches `target`,
 * given a starting balance, monthly contribution and APY (with reinvestment).
 * Returns null if the goal is unreachable within `maxYears`.
 */
export function yearsToReach(
  target: number,
  principal: number,
  monthlyContribution: number,
  apy: number,
  maxYears = 100
): number | null {
  if (target <= principal) return 0;
  const r = monthlyRate(apy);
  let balance = principal;
  const maxMonths = maxYears * 12;
  for (let m = 1; m <= maxMonths; m++) {
    balance = balance * (1 + r) + monthlyContribution;
    if (balance >= target) return m / 12;
  }
  return null;
}
