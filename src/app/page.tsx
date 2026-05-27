"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
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
    token: { name: string; symbol: string; logoURI?: string; network: string };
    pendingActions: string[];
  }[];
}

// ── Icons ──

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

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

// ── Portfolio Section ──

function Portfolio({
  yields,
  onWithdraw,
}: {
  yields: YieldItem[];
  onWithdraw: (pos: Position) => void;
}) {
  const { address, isConnected } = useAccount();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);

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
      console.log("Portfolio data:", data);
      setPositions(data.positions ?? []);
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

  if (!isConnected) {
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
      <div className="portfolio-empty">
        No active positions found for this wallet.
      </div>
    );
  }

  // Calculate totals
  const totalPositions = positions.reduce(
    (sum, pos) => sum + pos.balances.length,
    0
  );

  return (
    <div>
      {/* Portfolio summary */}
      <div className="stats" style={{ marginBottom: "1.5rem" }}>
        <div className="stat">
          <div className="stat-label">Positions</div>
          <div className="stat-value">{totalPositions}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Networks</div>
          <div className="stat-value">
            {new Set(positions.flatMap((p) => p.balances.map((b) => b.token.network))).size}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Best APY</div>
          <div className="stat-value green">
            {fmtApy(
              Math.max(
                ...positions.map((p) => {
                  const y = yields.find((y) => y.id === p.integrationId);
                  return y?.apy ?? 0;
                }),
                0
              )
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Est. Daily Yield</div>
          <div className="stat-value green">
            $
            {positions
              .reduce((sum, pos) => {
                const y = yields.find((y) => y.id === pos.integrationId);
                const apy = y?.apy ?? 0;
                const amount = pos.balances.reduce(
                  (s, b) => s + parseFloat(b.amount || "0"),
                  0
                );
                return sum + (amount * apy) / 365;
              }, 0)
              .toFixed(6)}
          </div>
        </div>
      </div>

      <div className="portfolio-list">
        {positions.map((pos) => {
          const yInfo = yields.find((y) => y.id === pos.integrationId);
          const apy = yInfo?.apy ?? 0;

          return pos.balances.map((bal, i) => {
            const amount = parseFloat(bal.amount || "0");
            const dailyYield = (amount * apy) / 365;
            const monthlyYield = (amount * apy) / 12;

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
                  <button className="btn-withdraw" onClick={() => onWithdraw(pos)}>
                    Withdraw
                  </button>
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
                    <span className="pcard-label">Daily Yield</span>
                    <span className="pcard-value green">
                      +{dailyYield > 0 ? dailyYield.toFixed(6) : "0"}
                    </span>
                  </div>
                  <div className="pcard-stat">
                    <span className="pcard-label">Monthly Yield</span>
                    <span className="pcard-value green">
                      +{monthlyYield > 0 ? monthlyYield.toFixed(6) : "0"}
                    </span>
                  </div>
                  <div className="pcard-stat">
                    <span className="pcard-label">Status</span>
                    <span className="pcard-value">{bal.type}</span>
                  </div>
                </div>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

// ── Main page ──

export default function Home() {
  const [yields, setYields] = useState<YieldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeNetwork, setActiveNetwork] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<YieldItem | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<Position | null>(null);
  const [view, setView] = useState<"explore" | "portfolio">("explore");

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

  const filtered = useMemo(() => {
    let result = yields;
    if (activeNetwork !== "all") result = result.filter((y) => y.network === activeNetwork);
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (y) =>
          y.id.toLowerCase().includes(q) ||
          y.provider?.toLowerCase().includes(q) ||
          y.network?.toLowerCase().includes(q) ||
          y.token?.symbol?.toLowerCase().includes(q) ||
          y.token?.name?.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
  }, [yields, activeNetwork, query]);

  const networks = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const y of yields) {
      if (y.network) counts[y.network] = (counts[y.network] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
  }, [yields]);

  const maxApy = useMemo(() => Math.max(...yields.map((y) => y.apy ?? 0), 0.01), [yields]);

  const stats = useMemo(() => {
    const withApy = filtered.filter((y) => y.apy && y.apy > 0);
    const avg = withApy.length > 0 ? withApy.reduce((s, y) => s + (y.apy ?? 0), 0) / withApy.length : 0;
    const best = Math.max(...filtered.map((y) => y.apy ?? 0), 0);
    const providers = new Set(filtered.map((y) => y.provider).filter(Boolean)).size;
    return { count: filtered.length, avg, best, providers };
  }, [filtered]);

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
          <span>by yield.xyz</span>
        </div>
        <div className="nav-actions">
          <div className="search-wrap">
            <SearchIcon />
            <input
              className="search"
              type="text"
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
        </div>
      </nav>

      {/* View toggle */}
      <div className="view-toggle">
        <button
          className={`view-btn ${view === "explore" ? "active" : ""}`}
          onClick={() => setView("explore")}
        >
          Explore
        </button>
        <button
          className={`view-btn ${view === "portfolio" ? "active" : ""}`}
          onClick={() => setView("portfolio")}
        >
          Portfolio
        </button>
      </div>

      {view === "explore" ? (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Opportunities</div>
              <div className="stat-value">{stats.count}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Best APY</div>
              <div className="stat-value green">{fmtApy(stats.best)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Average</div>
              <div className="stat-value green">{fmtApy(stats.avg)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Providers</div>
              <div className="stat-value">{stats.providers}</div>
            </div>
          </div>

          <div className="tabs">
            <button
              className={`tab ${activeNetwork === "all" ? "active" : ""}`}
              onClick={() => setActiveNetwork("all")}
            >
              All chains
            </button>
            {networks.map((n) => (
              <button
                key={n}
                className={`tab ${activeNetwork === n ? "active" : ""}`}
                onClick={() => setActiveNetwork(n)}
              >
                {n}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">No yields match your search.</div>
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
                {filtered.map((y) => (
                  <div key={y.id} className="row" onClick={() => setSelected(y)}>
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
                ))}
              </div>
            </>
          )}
        </>
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
