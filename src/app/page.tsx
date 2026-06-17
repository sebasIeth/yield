"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useBalance,
  useChainId,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { projectGrowth, yearsToReach } from "@/lib/compound";
import {
  RISK_PROFILES,
  RISK_ORDER,
  autoBag,
  EMPTY_CURATION,
  type RiskLevel,
  type Curation,
} from "@/lib/risk";
import "./globals.css";

// ── Types ──

interface YieldItem {
  id: string;
  apy?: number;
  network?: string;
  provider?: string;
  type?: string;
  token?: { name?: string; symbol?: string; logoURI?: string };
}

interface Position {
  integrationId: string;
  balances: {
    type: string;
    amount: string;
    token: {
      name: string;
      symbol: string;
      logoURI?: string;
      network: string;
      address?: string;
      decimals?: number;
      coinGeckoId?: string;
    };
    pendingActions: string[];
  }[];
}

type PriceMap = Record<string, { price: number; price_24_h?: number }>;

// ── Icons ──

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

// ── Helpers ──

const fmtApy = (v?: number) => (v ? (v * 100).toFixed(2) + "%" : "—");

const fmtType = (t?: string) =>
  t ? t.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "";

const fmtAmount = (v: string) => {
  const n = parseFloat(v);
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (n < 1) return n.toPrecision(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

// USD formatter — scales decimals to magnitude. Tiny values stay precise,
// large balances drop cents for a cleaner executive look.
const fmtUsd = (v: number, opts?: { decimals?: number; compact?: boolean }) => {
  if (!isFinite(v)) return "$0";
  const decimals =
    opts?.decimals ??
    (v !== 0 && Math.abs(v) < 0.01 ? 4 : Math.abs(v) < 1000 ? 2 : opts?.compact ? 1 : 0);
  return (
    "$" +
    v.toLocaleString(undefined, {
      minimumFractionDigits: opts?.compact ? 0 : decimals,
      maximumFractionDigits: decimals,
      notation: opts?.compact && Math.abs(v) >= 1_000_000 ? "compact" : "standard",
    })
  );
};

// Build the price-map key the /api/prices endpoint uses: `${network}-${address}`.
const priceKeyFor = (network?: string, address?: string) =>
  `${network ?? ""}-${(address ?? "undefined").toLowerCase()}`;

// Map a connected chainId to the metadata Yield.xyz needs to price the native
// token. `network` must match the API's network naming.
const NATIVE_CHAINS: Record<number, { network: string; name: string; coinGeckoId: string }> = {
  1: { network: "ethereum", name: "Ethereum", coinGeckoId: "ethereum" },
  137: { network: "polygon", name: "Polygon", coinGeckoId: "matic-network" },
  8453: { network: "base", name: "Ethereum", coinGeckoId: "ethereum" },
  42161: { network: "arbitrum", name: "Ethereum", coinGeckoId: "ethereum" },
  10: { network: "optimism", name: "Ethereum", coinGeckoId: "ethereum" },
  56: { network: "bsc", name: "BNB", coinGeckoId: "binancecoin" },
  43114: { network: "avalanche", name: "Avalanche", coinGeckoId: "avalanche-2" },
};

// ── Shared tx signing logic ──

async function signAndSendTxs(
  transactions: any[],
  sendTransactionAsync: any,
  switchChainAsync: any,
  onStatus: (s: string) => void,
  onHash: (h: `0x${string}`) => void
) {
  for (const tx of transactions) {
    if (!tx.unsignedTransaction) continue;

    onStatus("signing");

    const unsigned =
      typeof tx.unsignedTransaction === "string"
        ? JSON.parse(tx.unsignedTransaction)
        : tx.unsignedTransaction;

    const chainId = unsigned.chainId
      ? typeof unsigned.chainId === "string" && unsigned.chainId.startsWith("0x")
        ? parseInt(unsigned.chainId, 16)
        : Number(unsigned.chainId)
      : undefined;

    if (chainId) {
      await switchChainAsync({ chainId });
    }

    const hash = await sendTransactionAsync({
      to: unsigned.to as `0x${string}`,
      data: unsigned.data as `0x${string}`,
      value: unsigned.value ? BigInt(unsigned.value) : undefined,
      chainId,
    });

    onHash(hash);
    onStatus("confirming");

    await fetch("/api/transactions/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: tx.id, hash }),
    });
  }
}

function parseApiError(error: string, symbol?: string): string {
  try {
    const parsed = JSON.parse(error.replace(/^API \d+: /, ""));
    if (parsed.message === "MinimumAmountNotReachedError") {
      return `Minimum amount is ${parsed.details?.amount ?? "?"} ${symbol ?? ""}`;
    }
    return parsed.message || error;
  } catch {
    return error;
  }
}

// ── Stake Modal ──

function StakeModal({
  yield: y,
  onClose,
}: {
  yield: YieldItem;
  onClose: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (txConfirmed && status === "confirming") setStatus("success");
  }, [txConfirmed, status]);

  const handleStake = useCallback(async () => {
    if (!isConnected || !address || !amount) return;
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/yields/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yieldId: y.id, address, amount }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(parseApiError(data.error || "Failed", y.token?.symbol));
      }

      await signAndSendTxs(
        data.transactions ?? [],
        sendTransactionAsync,
        switchChainAsync,
        setStatus,
        setTxHash
      );
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(
        err.message?.includes("rejected") || err.message?.includes("denied")
          ? "Transaction rejected"
          : err.message || "Something went wrong"
      );
    }
  }, [isConnected, address, amount, y.id, sendTransactionAsync, switchChainAsync]);

  return (
    <ModalShell
      title={y.token?.symbol ?? y.id}
      subtitle={y.token?.name}
      logoURI={y.token?.logoURI}
      onClose={onClose}
    >
      <div className="modal-stats">
        <div className="modal-stat">
          <span className="modal-stat-label">APY</span>
          <span className="modal-stat-value green">{fmtApy(y.apy)}</span>
        </div>
        <div className="modal-stat">
          <span className="modal-stat-label">Network</span>
          <span className="modal-stat-value">{y.network}</span>
        </div>
        <div className="modal-stat">
          <span className="modal-stat-label">Provider</span>
          <span className="modal-stat-value">{y.provider}</span>
        </div>
        <div className="modal-stat">
          <span className="modal-stat-label">Type</span>
          <span className="modal-stat-value">{fmtType(y.type)}</span>
        </div>
      </div>

      {!isConnected ? (
        <div className="modal-connect">
          <p>Connect your wallet to stake</p>
          <div className="modal-connect-btn"><ConnectButton /></div>
        </div>
      ) : status === "success" ? (
        <SuccessView txHash={txHash} onClose={onClose} />
      ) : (
        <TxForm
          amount={amount}
          setAmount={setAmount}
          status={status}
          errorMsg={errorMsg}
          symbol={y.token?.symbol ?? ""}
          actionLabel="Stake"
          onSubmit={handleStake}
        />
      )}
    </ModalShell>
  );
}

// ── Withdraw Modal ──

function WithdrawModal({
  position,
  yieldInfo,
  onClose,
  onSuccess,
}: {
  position: Position;
  yieldInfo?: YieldItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const bal = position.balances[0];
  const symbol = bal?.token.symbol ?? "";

  useEffect(() => {
    if (txConfirmed && status === "confirming") {
      setStatus("success");
      onSuccess();
    }
  }, [txConfirmed, status, onSuccess]);

  const handleWithdraw = useCallback(async () => {
    if (!isConnected || !address || !amount) return;
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/yields/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yieldId: position.integrationId,
          address,
          amount,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(parseApiError(data.error || "Failed", symbol));
      }

      await signAndSendTxs(
        data.transactions ?? [],
        sendTransactionAsync,
        switchChainAsync,
        setStatus,
        setTxHash
      );
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(
        err.message?.includes("rejected") || err.message?.includes("denied")
          ? "Transaction rejected"
          : err.message || "Something went wrong"
      );
    }
  }, [isConnected, address, amount, position.integrationId, sendTransactionAsync, switchChainAsync]);

  return (
    <ModalShell
      title={`Withdraw ${symbol}`}
      subtitle={position.integrationId}
      logoURI={bal?.token.logoURI}
      onClose={onClose}
    >
      <div className="modal-stats">
        <div className="modal-stat">
          <span className="modal-stat-label">Balance</span>
          <span className="modal-stat-value">{fmtAmount(bal?.amount ?? "0")} {symbol}</span>
        </div>
        <div className="modal-stat">
          <span className="modal-stat-label">Network</span>
          <span className="modal-stat-value">{bal?.token.network}</span>
        </div>
        <div className="modal-stat">
          <span className="modal-stat-label">Type</span>
          <span className="modal-stat-value">{bal?.type}</span>
        </div>
        {yieldInfo?.apy && (
          <div className="modal-stat">
            <span className="modal-stat-label">APY</span>
            <span className="modal-stat-value green">{fmtApy(yieldInfo.apy)}</span>
          </div>
        )}
      </div>

      {status === "success" ? (
        <SuccessView txHash={txHash} onClose={onClose} label="Withdrawal confirmed!" />
      ) : (
        <TxForm
          amount={amount}
          setAmount={setAmount}
          status={status}
          errorMsg={errorMsg}
          symbol={symbol}
          actionLabel="Withdraw"
          onSubmit={handleWithdraw}
          maxAmount={bal?.amount}
        />
      )}
    </ModalShell>
  );
}

// ── Shared modal components ──

function ModalShell({
  title,
  subtitle,
  logoURI,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  logoURI?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title-row">
            {logoURI ? (
              <img src={logoURI} alt="" width={28} height={28} className="token-logo-sm" />
            ) : (
              <div className="token-avatar-sm">{title.slice(0, 3)}</div>
            )}
            <div>
              <h2 className="modal-title">{title}</h2>
              {subtitle && <p className="modal-sub">{subtitle}</p>}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><CloseIcon /></button>
        </div>
        {children}
      </div>
    </>
  );
}

function SuccessView({
  txHash,
  onClose,
  label = "Transaction confirmed!",
}: {
  txHash?: `0x${string}`;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="modal-success">
      <div className="success-check">&#10003;</div>
      <p>{label}</p>
      {txHash && (
        <a className="tx-link" href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
          View on Explorer <ArrowIcon />
        </a>
      )}
      <button className="btn btn-secondary" onClick={onClose}>Done</button>
    </div>
  );
}

function TxForm({
  amount,
  setAmount,
  status,
  errorMsg,
  symbol,
  actionLabel,
  onSubmit,
  maxAmount,
}: {
  amount: string;
  setAmount: (v: string) => void;
  status: string;
  errorMsg: string;
  symbol: string;
  actionLabel: string;
  onSubmit: () => void;
  maxAmount?: string;
}) {
  const busy = status !== "idle" && status !== "error";
  return (
    <div className="modal-form">
      <div className="input-label-row">
        <label className="input-label">Amount</label>
        {maxAmount && (
          <button className="max-btn" onClick={() => setAmount(maxAmount)}>
            MAX
          </button>
        )}
      </div>
      <div className="input-wrap">
        <input
          className="amount-input"
          type="number"
          placeholder="0.00"
          step="any"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
        <span className="input-suffix">{symbol}</span>
      </div>
      {errorMsg && <p className="form-error">{errorMsg}</p>}
      <button
        className="btn btn-primary"
        disabled={!amount || Number(amount) <= 0 || busy}
        onClick={onSubmit}
      >
        {status === "loading" && "Preparing..."}
        {status === "signing" && "Sign in wallet..."}
        {status === "confirming" && "Confirming..."}
        {(status === "idle" || status === "error") && `${actionLabel} ${symbol}`}
      </button>
      <p className="form-hint">Non-custodial. You sign with your own wallet.</p>
    </div>
  );
}

// ── Yield row (shared by Explore & Suggested) ──

function YieldRow({
  y,
  maxApy,
  onSelect,
}: {
  y: YieldItem;
  maxApy: number;
  onSelect: (y: YieldItem) => void;
}) {
  return (
    <div className="row" onClick={() => onSelect(y)}>
      <div className="token">
        {y.token?.logoURI ? (
          <img className="token-logo" src={y.token.logoURI} alt="" width={34} height={34} />
        ) : (
          <div className="token-avatar">{(y.token?.symbol ?? "?").slice(0, 3)}</div>
        )}
        <div className="token-text">
          <div className="token-symbol">{y.token?.symbol ?? y.id.split("-").pop()}</div>
          <div className="token-name">{y.token?.name}</div>
        </div>
      </div>
      <span className="network">{y.network}</span>
      <span className="provider">{y.provider}</span>
      <span className="type-badge">{fmtType(y.type)}</span>
      <div className="apy-cell">
        <div className="apy-num">{fmtApy(y.apy)}</div>
        <div className="apy-bar-wrap">
          <div className="apy-bar" style={{ width: `${((y.apy ?? 0) / maxApy) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Onboarding quiz: infer a risk profile from a few questions ──

const QUIZ: { q: string; options: { label: string; level: RiskLevel }[] }[] = [
  {
    q: "¿Cuál es tu objetivo principal al invertir?",
    options: [
      { label: "Preservar mi capital", level: "low" },
      { label: "Crecer de forma equilibrada", level: "medium" },
      { label: "Maximizar el retorno", level: "high" },
    ],
  },
  {
    q: "Si tu inversión cayera 20% en una semana, ¿qué harías?",
    options: [
      { label: "Retiraría todo de inmediato", level: "low" },
      { label: "Esperaría a que se recupere", level: "medium" },
      { label: "Aprovecharía para invertir más", level: "high" },
    ],
  },
  {
    q: "¿Por cuánto tiempo podés dejar el capital invertido?",
    options: [
      { label: "Menos de 6 meses", level: "low" },
      { label: "Entre 6 y 24 meses", level: "medium" },
      { label: "Más de 2 años", level: "high" },
    ],
  },
  {
    q: "¿Cuánta experiencia tenés en DeFi / cripto?",
    options: [
      { label: "Poca — recién empiezo", level: "low" },
      { label: "Algo — ya usé alguna app", level: "medium" },
      { label: "Mucha — manejo varios protocolos", level: "high" },
    ],
  },
];

const RISK_SCORE: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function inferProfile(answers: RiskLevel[]): RiskLevel {
  const avg = answers.reduce((s, l) => s + RISK_SCORE[l], 0) / answers.length;
  if (avg <= 0.66) return "low";
  if (avg <= 1.33) return "medium";
  return "high";
}

function OnboardingQuiz({ onComplete }: { onComplete: (level: RiskLevel) => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<RiskLevel[]>([]);
  const total = QUIZ.length;
  const done = step >= total;
  const result = done ? inferProfile(answers) : null;

  const choose = (level: RiskLevel) => {
    const next = [...answers];
    next[step] = level;
    setAnswers(next);
    setStep(step + 1);
  };

  if (result) {
    const p = RISK_PROFILES[result];
    return (
      <div className="onboarding">
        <div className="quiz-result">
          <span className="quiz-result-kicker">Tu perfil de inversor</span>
          <span className="profile-dot quiz-result-dot" style={{ background: p.accent }} />
          <h2 className="quiz-result-label" style={{ color: p.accent }}>{p.label}</h2>
          <p className="quiz-result-short">{p.short} · {p.apyHint}</p>
          <p className="quiz-result-desc">{p.description}</p>
          <button className="btn btn-primary quiz-cta" onClick={() => onComplete(result)}>
            Ver mi bolsa sugerida
          </button>
          <button
            className="quiz-retake"
            onClick={() => {
              setAnswers([]);
              setStep(0);
            }}
          >
            Rehacer el test
          </button>
        </div>
      </div>
    );
  }

  const current = QUIZ[step];
  return (
    <div className="onboarding">
      <div className="onboarding-head">
        <h2>Descubrí tu perfil de inversor</h2>
        <p>Respondé {total} preguntas rápidas y te armamos una bolsa de yields a tu medida.</p>
      </div>

      <div className="quiz-progress">
        <div className="quiz-progress-bar" style={{ width: `${(step / total) * 100}%` }} />
      </div>
      <span className="quiz-step-count">Pregunta {step + 1} de {total}</span>

      <div className="quiz-card">
        <h3 className="quiz-question">{current.q}</h3>
        <div className="quiz-options">
          {current.options.map((opt) => (
            <button
              key={opt.label}
              className={`quiz-option ${answers[step] === opt.level ? "active" : ""}`}
              onClick={() => choose(opt.level)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {step > 0 && (
          <button className="quiz-back" onClick={() => setStep(step - 1)}>&larr; Atrás</button>
        )}
      </div>
    </div>
  );
}

// ── Suggested: curated bag for the chosen profile ──

function SuggestedView({
  yields,
  curation,
  profile,
  maxApy,
  onChangeProfile,
  onRetake,
  onSelect,
}: {
  yields: YieldItem[];
  curation: Curation;
  profile: RiskLevel;
  maxApy: number;
  onChangeProfile: (level: RiskLevel) => void;
  onRetake: () => void;
  onSelect: (y: YieldItem) => void;
}) {
  const p = RISK_PROFILES[profile];

  // Curated picks for this profile, in admin order. If the admin hasn't curated
  // it, fall back to the automatic classification so the bag is never empty.
  const curatedIds = curation[profile] ?? [];
  const byId = new Map(yields.map((y) => [y.id, y]));
  // Picks curados por el admin (en su orden). Si no curó este perfil —o los ids
  // ya no existen— caemos a la bolsa automática, que nunca queda vacía.
  const curatedBag = curatedIds
    .map((id) => byId.get(id))
    .filter((y): y is YieldItem => !!y);
  const isCurated = curatedBag.length > 0;
  const sorted = isCurated
    ? [...curatedBag].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
    : autoBag(yields, profile);
  const avgApy = sorted.length
    ? sorted.reduce((s, y) => s + (y.apy ?? 0), 0) / sorted.length
    : 0;

  return (
    <div>
      {/* Profile switcher */}
      <div className="profile-switch">
        {RISK_ORDER.map((level) => {
          const pp = RISK_PROFILES[level];
          return (
            <button
              key={level}
              className={`profile-pill ${profile === level ? "active" : ""}`}
              onClick={() => onChangeProfile(level)}
              style={profile === level ? { borderColor: pp.accent, color: pp.accent } : undefined}
            >
              <span className="profile-dot" style={{ background: pp.accent }} />
              {pp.label}
            </button>
          );
        })}
        <button className="profile-retake" onClick={onRetake}>Rehacer test</button>
      </div>

      <div className="suggested-hero" style={{ borderColor: "transparent" }}>
        <div>
          <span className="suggested-kicker" style={{ color: p.accent }}>{p.short} · {p.apyHint}</span>
          <h2 className="suggested-title">Sugeridos para un perfil {p.label.toLowerCase()}</h2>
          <p className="suggested-desc">{p.description}</p>
        </div>
        <div className="suggested-metrics">
          <div className="suggested-metric">
            <span className="suggested-metric-value green">{fmtApy(avgApy)}</span>
            <span className="suggested-metric-label">APY promedio</span>
          </div>
          <div className="suggested-metric">
            <span className="suggested-metric-value">{sorted.length}</span>
            <span className="suggested-metric-label">opciones</span>
          </div>
        </div>
      </div>

      {!isCurated && sorted.length > 0 && (
        <p className="wealth-note">
          Selección automática según tu perfil de riesgo, ordenada por APY.
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="empty-state">
          No encontramos oportunidades para este perfil en este momento. Probá con otro perfil.
        </div>
      ) : (
        <>
          <div className="list-header">
            <span>Token</span>
            <span>Network</span>
            <span>Provider</span>
            <span>Type</span>
            <span>APY</span>
          </div>
          <div className="list">
            {sorted.map((y) => (
              <YieldRow key={y.id} y={y} maxApy={maxApy} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Portfolio Section ──

function Portfolio({
  yields,
  onWithdraw,
}: {
  yields: YieldItem[];
  onWithdraw: (pos: Position) => void;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: nativeBal } = useBalance({ address });
  const [positions, setPositions] = useState<Position[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [walletUsd, setWalletUsd] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Demo mode (?demo=1): inject sample holdings so the executive view and
  // calculator can be shown without connecting a wallet. Harmless in prod.
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(new URLSearchParams(window.location.search).get("demo") === "1");
  }, []);

  useEffect(() => {
    if (!isDemo || !yields.length) return;
    const picks = [...yields]
      .filter((y) => y.token?.symbol && y.apy)
      .sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
      .slice(0, 4);
    const targets = [9850, 8200, 6400, 4300]; // USD value per holding
    const amounts = [5.42, 8200, 2100, 12.5];
    const pos: Position[] = [];
    const pr: PriceMap = {};
    picks.forEach((y, i) => {
      const address = `0xde${i}00000000000000000000000000000000000000`;
      const amt = amounts[i];
      pos.push({
        integrationId: y.id,
        balances: [
          {
            type: "staked",
            amount: String(amt),
            token: {
              name: y.token?.name ?? y.token?.symbol ?? "",
              symbol: y.token?.symbol ?? "",
              network: y.network ?? "ethereum",
              logoURI: y.token?.logoURI,
              address,
              decimals: 18,
            },
            pendingActions: [],
          },
        ],
      });
      pr[priceKeyFor(y.network, address)] = { price: targets[i] / amt };
    });
    setPositions(pos);
    setPrices(pr);
    setWalletUsd(12450.32);
    setLoading(false);
  }, [isDemo, yields]);

  // Value the connected wallet's native balance (e.g. ETH) in USD. This is the
  // "saldo de billetera" — capital available to invest. ERC-20 token scanning
  // would need an indexer; native balance is enough for the financial summary.
  useEffect(() => {
    if (isDemo) return;
    const meta = NATIVE_CHAINS[chainId];
    if (!address || !nativeBal || !meta) {
      setWalletUsd(null);
      return;
    }
    const amount = parseFloat(nativeBal.formatted);
    let cancelled = false;
    fetch("/api/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenList: [
          {
            network: meta.network,
            name: meta.name,
            symbol: nativeBal.symbol,
            decimals: nativeBal.decimals,
            coinGeckoId: meta.coinGeckoId,
          },
        ],
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const price = (d.prices as PriceMap)?.[priceKeyFor(meta.network)]?.price;
        setWalletUsd(price != null ? amount * price : null);
      })
      .catch(() => !cancelled && setWalletUsd(null));
    return () => {
      cancelled = true;
    };
  }, [isDemo, address, chainId, nativeBal?.formatted, nativeBal?.symbol, nativeBal?.decimals]);

  const fetchPositions = useCallback(async () => {
    if (!address || !yields.length) return;
    setLoading(true);

    try {
      // Only scan chains where you likely have positions
      const scanNetworks = new Set(["ethereum", "polygon", "base"]);
      const integrationIds = yields
        .filter((y) => y.network && scanNetworks.has(y.network))
        .map((y) => y.id);
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, integrationIds }),
      });
      const data = await res.json();
      const pos: Position[] = data.positions ?? [];
      setPositions(pos);

      // Price every token we hold, in a single request, so we can value the
      // portfolio in USD.
      const tokenList = pos.flatMap((p) =>
        p.balances.map((b) => ({
          network: b.token.network,
          name: b.token.name,
          symbol: b.token.symbol,
          decimals: b.token.decimals ?? 18,
          address: b.token.address,
          coinGeckoId: b.token.coinGeckoId,
        }))
      );
      if (tokenList.length) {
        try {
          const pr = await fetch("/api/prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tokenList }),
          });
          const pd = await pr.json();
          setPrices(pd.prices ?? {});
        } catch {
          setPrices({});
        }
      }
    } catch (err) {
      console.error("Portfolio fetch error:", err);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [address, yields]);

  // Fetch on mount — runs once when component appears
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Expose refresh for after withdraw
  useEffect(() => {
    (window as any).__refreshPortfolio = fetchPositions;
    return () => { delete (window as any).__refreshPortfolio; };
  }, [fetchPositions]);

  if (!isConnected && !isDemo) {
    return (
      <div className="portfolio-empty">
        Connect your wallet to see your positions.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="portfolio-loading">
        <div className="loader" />
        <span>Scanning positions...</span>
      </div>
    );
  }

  if (positions.length === 0 && !loading) {
    return (
      <div>
        <div className="portfolio-empty">
          No tenés posiciones activas todavía. Simulá tu crecimiento futuro:
        </div>
        <WealthProjection initialAmount={0} defaultApy={0} />
      </div>
    );
  }

  // Flatten balances into priced rows.
  const rows = positions.flatMap((pos) => {
    const yInfo = yields.find((y) => y.id === pos.integrationId);
    const apy = yInfo?.apy ?? 0;
    return pos.balances.map((bal, i) => {
      const amount = parseFloat(bal.amount || "0");
      const price = prices[priceKeyFor(bal.token.network, bal.token.address)]?.price;
      const usd = price != null ? amount * price : null;
      return { pos, bal, i, yInfo, apy, amount, usd };
    });
  });

  // Portfolio-level totals, all in USD.
  let invested = 0; // balance invertido
  let annualIncome = 0; // sum of usd * apy
  let unpriced = 0;
  for (const r of rows) {
    if (r.usd != null) {
      invested += r.usd;
      annualIncome += r.usd * r.apy;
    } else {
      unpriced++;
    }
  }
  const blendedApy = invested > 0 ? annualIncome / invested : 0;
  const monthlyIncome = annualIncome / 12;
  const dailyIncome = annualIncome / 365;
  const networks = new Set(rows.map((r) => r.bal.token.network)).size;

  // Saldo de billetera (token nativo) + patrimonio total.
  const wallet = walletUsd ?? 0;
  const totalWealth = invested + wallet;

  // Total acumulado proyectado a 1 año: todo el patrimonio trabajando a la APY
  // combinada, reinvirtiendo ganancias.
  const oneYear = projectGrowth({
    principal: totalWealth,
    monthlyContribution: 0,
    apy: blendedApy,
    years: 1,
  }).finalReinvested;

  return (
    <div>
      {/* Executive hero — total wealth + yield */}
      <div className="wealth-hero">
        <div className="wealth-hero-main">
          <span className="wealth-hero-label">Patrimonio total</span>
          <span className="wealth-hero-value">{fmtUsd(totalWealth, { decimals: 2 })}</span>
          <div className="wealth-hero-meta">
            <span className="apy-pill">{fmtApy(blendedApy)} APY combinada</span>
            <span className="wealth-hero-income">
              Genera <strong>{fmtUsd(dailyIncome, { decimals: 2 })}</strong> / día
            </span>
          </div>
        </div>
        <div className="wealth-hero-side">
          <span className="wealth-hero-side-label">Proyección a 1 año (reinvirtiendo)</span>
          <span className="wealth-hero-side-value green">{fmtUsd(oneYear, { decimals: 2 })}</span>
          <span className="wealth-hero-side-sub">
            +{fmtUsd(oneYear - totalWealth, { decimals: 2 })} en rendimiento
          </span>
        </div>
      </div>

      {unpriced > 0 && (
        <p className="wealth-note">
          {unpriced} {unpriced === 1 ? "posición" : "posiciones"} sin precio de mercado
          disponible (no suma al total en USD).
        </p>
      )}

      {/* Summary stats */}
      <div className="stats" style={{ marginBottom: "1.5rem" }}>
        <div className="stat">
          <div className="stat-label">Saldo billetera</div>
          <div className="stat-value">{walletUsd != null ? fmtUsd(walletUsd) : "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Balance invertido</div>
          <div className="stat-value">{fmtUsd(invested)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ingreso anual est.</div>
          <div className="stat-value green">{fmtUsd(annualIncome)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ingreso mensual</div>
          <div className="stat-value green">{fmtUsd(monthlyIncome)}</div>
        </div>
      </div>

      {/* Wealth projection calculator */}
      <WealthProjection initialAmount={totalWealth} defaultApy={blendedApy} />

      {/* Positions */}
      <h3 className="section-title">
        Tus posiciones{" "}
        <span className="stat-dim">
          {rows.length} · {networks} {networks === 1 ? "red" : "redes"}
        </span>
      </h3>
      <div className="portfolio-list">
        {rows.map(({ pos, bal, i, yInfo, apy, amount, usd }) => {
          const dailyYieldUsd = usd != null ? (usd * apy) / 365 : null;
          const monthlyYieldUsd = usd != null ? (usd * apy) / 12 : null;

          return (
            <div key={`${pos.integrationId}-${i}`} className="portfolio-card">
              <div className="portfolio-card-header">
                <div className="token">
                  {bal.token.logoURI ? (
                    <img className="token-logo" src={bal.token.logoURI} alt="" width={38} height={38} />
                  ) : (
                    <div className="token-avatar">{bal.token.symbol.slice(0, 3)}</div>
                  )}
                  <div className="token-text">
                    <div className="token-symbol">{bal.token.symbol}</div>
                    <div className="token-name">
                      {yInfo?.provider ?? ""} &middot; {fmtType(yInfo?.type)} &middot; {bal.token.network}
                    </div>
                  </div>
                </div>
                <div className="portfolio-card-value">
                  <span className="pcard-usd">{usd != null ? fmtUsd(usd, { decimals: 2 }) : "—"}</span>
                  <button className="btn-withdraw" onClick={() => onWithdraw(pos)}>
                    Withdraw
                  </button>
                </div>
              </div>

              <div className="portfolio-card-stats">
                <div className="pcard-stat">
                  <span className="pcard-label">Balance</span>
                  <span className="pcard-value">{fmtAmount(bal.amount)} {bal.token.symbol}</span>
                </div>
                <div className="pcard-stat">
                  <span className="pcard-label">APY</span>
                  <span className="pcard-value green">{fmtApy(apy)}</span>
                </div>
                <div className="pcard-stat">
                  <span className="pcard-label">Ingreso diario</span>
                  <span className="pcard-value green">
                    {dailyYieldUsd != null ? `+${fmtUsd(dailyYieldUsd, { decimals: 2 })}` : "—"}
                  </span>
                </div>
                <div className="pcard-stat">
                  <span className="pcard-label">Ingreso mensual</span>
                  <span className="pcard-value green">
                    {monthlyYieldUsd != null ? `+${fmtUsd(monthlyYieldUsd, { decimals: 2 })}` : "—"}
                  </span>
                </div>
                <div className="pcard-stat">
                  <span className="pcard-label">Estado</span>
                  <span className="pcard-value">{bal.type}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Wealth projection calculator ──

function WealthProjection({
  initialAmount,
  defaultApy,
}: {
  initialAmount: number;
  defaultApy: number;
}) {
  const [mode, setMode] = useState<"project" | "goal">("project");
  const [initial, setInitial] = useState("10000");
  const [monthly, setMonthly] = useState("500");
  const [apyPct, setApyPct] = useState("5");
  const [years, setYears] = useState(10);
  const [goal, setGoal] = useState("250000");

  // Prefill from the real portfolio once it loads, without clobbering edits.
  const applied = useRef(false);
  useEffect(() => {
    if (!applied.current && initialAmount > 0) {
      setInitial(String(Math.round(initialAmount)));
      if (defaultApy > 0) setApyPct((defaultApy * 100).toFixed(2));
      applied.current = true;
    }
  }, [initialAmount, defaultApy]);

  const p = Math.max(0, parseFloat(initial) || 0);
  const c = Math.max(0, parseFloat(monthly) || 0);
  const apy = Math.max(0, (parseFloat(apyPct) || 0) / 100);

  const result = useMemo(
    () => projectGrowth({ principal: p, monthlyContribution: c, apy, years }),
    [p, c, apy, years]
  );

  const goalTarget = Math.max(0, parseFloat(goal) || 0);
  const goalYears = useMemo(
    () => (mode === "goal" ? yearsToReach(goalTarget, p, c, apy) : null),
    [mode, goalTarget, p, c, apy]
  );

  return (
    <div className="calc">
      <div className="calc-head">
        <div>
          <h3 className="calc-title">Calculadora de patrimonio</h3>
          <p className="calc-sub">
            Proyectá tu crecimiento reinvirtiendo las ganancias (interés compuesto).
          </p>
        </div>
        <div className="calc-modes">
          <button
            className={`calc-mode ${mode === "project" ? "active" : ""}`}
            onClick={() => setMode("project")}
          >
            Proyección
          </button>
          <button
            className={`calc-mode ${mode === "goal" ? "active" : ""}`}
            onClick={() => setMode("goal")}
          >
            Objetivo
          </button>
        </div>
      </div>

      <div className="calc-grid">
        <div className="calc-inputs">
          <label className="calc-field">
            <span>Monto inicial</span>
            <div className="calc-input-wrap">
              <span className="calc-prefix">$</span>
              <input type="number" min="0" value={initial} onChange={(e) => setInitial(e.target.value)} />
            </div>
          </label>
          <label className="calc-field">
            <span>Aporte mensual</span>
            <div className="calc-input-wrap">
              <span className="calc-prefix">$</span>
              <input type="number" min="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
          </label>
          <label className="calc-field">
            <span>APY anual</span>
            <div className="calc-input-wrap">
              <input type="number" min="0" step="0.1" value={apyPct} onChange={(e) => setApyPct(e.target.value)} />
              <span className="calc-suffix">%</span>
            </div>
          </label>

          {mode === "project" ? (
            <label className="calc-field">
              <span>
                Horizonte <strong>{years} {years === 1 ? "año" : "años"}</strong>
              </span>
              <input
                className="calc-slider"
                type="range"
                min="1"
                max="40"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className="calc-field">
              <span>Meta de patrimonio</span>
              <div className="calc-input-wrap">
                <span className="calc-prefix">$</span>
                <input type="number" min="0" value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>
            </label>
          )}
        </div>

        <div className="calc-result">
          {mode === "project" ? (
            <>
              <div className="calc-headline">
                <span className="calc-headline-label">
                  Valor estimado en {years} {years === 1 ? "año" : "años"}
                </span>
                <span className="calc-headline-value green">{fmtUsd(result.finalReinvested)}</span>
              </div>
              <GrowthChart points={result.points} />
              <div className="calc-breakdown">
                <div className="calc-bd-item">
                  <span className="calc-bd-dot dot-contrib" />
                  <span className="calc-bd-label">Aportado</span>
                  <span className="calc-bd-value">{fmtUsd(result.totalContributed)}</span>
                </div>
                <div className="calc-bd-item">
                  <span className="calc-bd-dot dot-yield" />
                  <span className="calc-bd-label">Rendimiento</span>
                  <span className="calc-bd-value green">+{fmtUsd(result.yieldReinvested)}</span>
                </div>
                <div className="calc-bd-item">
                  <span className="calc-bd-label">Extra por reinvertir</span>
                  <span className="calc-bd-value green">+{fmtUsd(result.reinvestmentBonus)}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="calc-goal">
              {goalYears == null ? (
                <p className="calc-goal-fail">
                  No alcanzás {fmtUsd(goalTarget)} en 100 años con estos parámetros.
                  Aumentá el aporte mensual o el APY.
                </p>
              ) : (
                <>
                  <span className="calc-headline-label">
                    Para llegar a {fmtUsd(goalTarget)} necesitás
                  </span>
                  <span className="calc-goal-value green">
                    {goalYears === 0 ? "Ya lo lograste" : `${goalYears.toFixed(1)} años`}
                  </span>
                  {goalYears > 0 && (
                    <span className="calc-goal-sub">
                      reinvirtiendo a {apyPct}% APY, aportando {fmtUsd(c)} / mes
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Growth chart (inline SVG area) ──

function GrowthChart({ points }: { points: ReturnType<typeof projectGrowth>["points"] }) {
  const W = 580;
  const H = 200;
  const pad = { t: 14, r: 6, b: 6, l: 6 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const lastMonth = points[points.length - 1]?.month || 1;
  const maxY = Math.max(...points.map((p) => p.reinvested), 1);

  const sx = (m: number) => pad.l + (m / lastMonth) * innerW;
  const sy = (v: number) => pad.t + innerH - (v / maxY) * innerH;

  const lineFor = (sel: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.month).toFixed(1)},${sy(sel(p)).toFixed(1)}`).join(" ");

  const baseline = sy(0).toFixed(1);
  const areaReinv = `${lineFor((p) => p.reinvested)} L${sx(lastMonth).toFixed(1)},${baseline} L${sx(0).toFixed(1)},${baseline} Z`;
  const areaContrib = `${lineFor((p) => p.contributed)} L${sx(lastMonth).toFixed(1)},${baseline} L${sx(0).toFixed(1)},${baseline} Z`;

  return (
    <svg className="growth-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="yieldGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--green)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="contribGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {/* Total (reinvested) area sits behind; contributed area on top so the
          gap between them reads as earned yield. */}
      <path d={areaReinv} fill="url(#yieldGrad)" />
      <path d={areaContrib} fill="url(#contribGrad)" />
      <path d={lineFor((p) => p.reinvested)} fill="none" stroke="var(--green)" strokeWidth="2" />
      <path d={lineFor((p) => p.contributed)} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  );
}

// ── Main page ──

export default function Home() {
  const [yields, setYields] = useState<YieldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<YieldItem | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<Position | null>(null);
  const [view, setView] = useState<"sugeridos" | "portfolio">("sugeridos");
  const [profile, setProfile] = useState<RiskLevel | null>(null);
  const [curation, setCuration] = useState<Curation>(EMPTY_CURATION);

  // Restore the saved risk profile (set during onboarding).
  useEffect(() => {
    const saved = localStorage.getItem("riskProfile") as RiskLevel | null;
    if (saved && (saved === "low" || saved === "medium" || saved === "high")) {
      setProfile(saved);
    }
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setView("portfolio");
    }
  }, []);

  // Load the admin's curated bags.
  useEffect(() => {
    fetch("/api/curation")
      .then((r) => r.json())
      .then((d) => d.curation && setCuration(d.curation))
      .catch(() => {});
  }, []);

  const pickProfile = useCallback((level: RiskLevel) => {
    setProfile(level);
    localStorage.setItem("riskProfile", level);
  }, []);

  const retakeQuiz = useCallback(() => {
    setProfile(null);
    localStorage.removeItem("riskProfile");
  }, []);

  useEffect(() => {
    fetch("/api/yields?limit=100")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setYields(data.yields ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Yields apagados por el admin: no se muestran a usuarios (ni en Explore ni
  // en las bolsas). El Portfolio sigue usando `yields` completo para valuar
  // posiciones que el usuario ya tenga.
  const visibleYields = useMemo(
    () => yields.filter((y) => !curation.hidden?.includes(y.id)),
    [yields, curation]
  );

  const maxApy = useMemo(() => Math.max(...yields.map((y) => y.apy ?? 0), 0.01), [yields]);

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen">
          <div className="loader" />
          <span className="loading-text">Fetching yields...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <nav className="nav">
          <div className="nav-brand"><h1>yield</h1><span>by yield.xyz</span></div>
          <ConnectButton />
        </nav>
        <div className="error-box">
          <p>{error}</p>
          <p className="hint">Check your YIELD_API_KEY in .env.local</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <nav className="nav">
        <div className="nav-brand">
          <h1>yield</h1>
                  </div>
        <div className="nav-actions">
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
        </div>
      </nav>

      {/* View toggle */}
      <div className="view-toggle-row">
        <div className="view-toggle">
          <button
            className={`view-btn ${view === "sugeridos" ? "active" : ""}`}
            onClick={() => setView("sugeridos")}
          >
            Sugeridos
          </button>
          <button
            className={`view-btn ${view === "portfolio" ? "active" : ""}`}
            onClick={() => setView("portfolio")}
          >
            Portfolio
          </button>
        </div>
        <a className="admin-link" href="/admin">Admin</a>
      </div>

      {view === "sugeridos" ? (
        profile ? (
          <SuggestedView
            yields={visibleYields}
            curation={curation}
            profile={profile}
            maxApy={maxApy}
            onChangeProfile={pickProfile}
            onRetake={retakeQuiz}
            onSelect={setSelected}
          />
        ) : (
          <OnboardingQuiz onComplete={pickProfile} />
        )
      ) : (
        <Portfolio
          yields={yields}
          onWithdraw={(pos) => setWithdrawTarget(pos)}
        />
      )}

      {selected && (
        <StakeModal yield={selected} onClose={() => setSelected(null)} />
      )}

      {withdrawTarget && (
        <WithdrawModal
          position={withdrawTarget}
          yieldInfo={yields.find((y) => y.id === withdrawTarget.integrationId)}
          onClose={() => setWithdrawTarget(null)}
          onSuccess={() => {
            (window as any).__refreshPortfolio?.();
          }}
        />
      )}
    </div>
  );
}
