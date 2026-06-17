"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RISK_PROFILES,
  RISK_ORDER,
  classifyRisk,
  EMPTY_CURATION,
  type RiskLevel,
  type Curation,
} from "@/lib/risk";
import "../globals.css";

interface AdminYield {
  id: string;
  apy?: number;
  network?: string;
  provider?: string;
  type?: string;
  token?: { name?: string; symbol?: string; logoURI?: string };
}

function PowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  );
}

const fmtApy = (v?: number) => (v ? (v * 100).toFixed(2) + "%" : "—");
const fmtType = (t?: string) =>
  t ? t.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "";

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [checking, setChecking] = useState(true);

  // Auto-login si ya hay una clave válida guardada en la sesión.
  useEffect(() => {
    const saved = sessionStorage.getItem("adminKey");
    if (!saved) {
      setChecking(false);
      return;
    }
    verifyKey(saved)
      .then((ok) => {
        if (ok) {
          setAdminKey(saved);
          setAuthed(true);
        } else {
          sessionStorage.removeItem("adminKey");
        }
      })
      .finally(() => setChecking(false));
  }, []);

  async function verifyKey(key: string): Promise<boolean> {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    return res.ok;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const ok = await verifyKey(keyInput);
    if (ok) {
      sessionStorage.setItem("adminKey", keyInput);
      setAdminKey(keyInput);
      setAuthed(true);
    } else {
      setAuthError("Clave incorrecta. Intentá de nuevo.");
    }
  };

  const logout = () => {
    sessionStorage.removeItem("adminKey");
    setAuthed(false);
    setAdminKey("");
    setKeyInput("");
  };

  if (checking) {
    return (
      <div className="page">
        <div className="loading-screen">
          <div className="loader" />
          <span className="loading-text">Verificando acceso...</span>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="page">
        <div className="admin-login">
          <div className="admin-login-card">
            <h1 className="admin-login-brand">yield</h1>
            <h2 className="admin-login-title">Panel de administración</h2>
            <p className="admin-login-sub">
              Curación de bolsas de yield por perfil de riesgo. Ingresá la clave de admin para
              continuar.
            </p>
            <form onSubmit={handleLogin} className="admin-login-form">
              <input
                className="amount-input admin-login-input"
                type="password"
                placeholder="Clave de admin"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoFocus
              />
              {authError && <p className="form-error">{authError}</p>}
              <button className="btn btn-primary" type="submit" disabled={!keyInput}>
                Ingresar
              </button>
            </form>
            <a className="admin-login-back" href="/">&larr; Volver a la app</a>
          </div>
        </div>
      </div>
    );
  }

  return <AdminPanel adminKey={adminKey} onLogout={logout} />;
}

function AdminPanel({ adminKey, onLogout }: { adminKey: string; onLogout: () => void }) {
  const [yields, setYields] = useState<AdminYield[]>([]);
  const [curation, setCuration] = useState<Curation>(EMPTY_CURATION);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/yields?limit=100").then((r) => r.json()),
      fetch("/api/curation").then((r) => r.json()),
    ])
      .then(([y, c]) => {
        setYields(y.yields ?? []);
        if (c.curation) setCuration(c.curation);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string, level: RiskLevel) => {
    setStatus("idle");
    setCuration((prev) => {
      const set = new Set(prev[level]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [level]: Array.from(set) };
    });
  };

  // "Apagar" un yield: lo oculta en toda la app. Al apagarlo lo sacamos también
  // de las 3 bolsas (no tiene sentido tenerlo asignado y oculto a la vez).
  const toggleHidden = (id: string) => {
    setStatus("idle");
    setCuration((prev) => {
      const hidden = new Set(prev.hidden);
      if (hidden.has(id)) {
        hidden.delete(id);
        return { ...prev, hidden: Array.from(hidden) };
      }
      hidden.add(id);
      return {
        ...prev,
        hidden: Array.from(hidden),
        low: prev.low.filter((x) => x !== id),
        medium: prev.medium.filter((x) => x !== id),
        high: prev.high.filter((x) => x !== id),
      };
    });
  };

  const save = async () => {
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/curation", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify(curation),
      });
      if (res.status === 401) throw new Error("Clave de admin inválida");
      if (!res.ok) throw new Error((await res.json()).error ?? "Error al guardar");
      setStatus("saved");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message);
    }
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q
      ? yields.filter(
          (y) =>
            y.id.toLowerCase().includes(q) ||
            y.provider?.toLowerCase().includes(q) ||
            y.token?.symbol?.toLowerCase().includes(q)
        )
      : yields;
    return [...list].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
  }, [yields, query]);

  return (
    <div className="page">
      <nav className="nav">
        <div className="nav-brand">
          <h1>yield</h1>
          <span>admin · curación</span>
        </div>
        <div className="nav-actions">
          <a className="admin-link" href="/">&larr; Volver a la app</a>
          <button className="admin-link" onClick={onLogout}>Salir</button>
        </div>
      </nav>

      <div className="admin-bar">
        <input
          className="search"
          type="text"
          placeholder="Buscar yield..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="admin-bar-right">
          {status === "saved" && <span className="admin-saved">✓ Guardado</span>}
          {status === "error" && <span className="form-error">{errorMsg}</span>}
          <button className="btn btn-primary admin-save" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Guardando..." : "Guardar curación"}
          </button>
        </div>
      </div>

      {/* Per-profile counts */}
      <div className="stats" style={{ marginBottom: "1.5rem" }}>
        {RISK_ORDER.map((level) => {
          const p = RISK_PROFILES[level];
          return (
            <div className="stat" key={level}>
              <div className="stat-label">
                <span className="profile-dot" style={{ background: p.accent }} /> {p.label}
              </div>
              <div className="stat-value">{curation[level].length}</div>
            </div>
          );
        })}
        <div className="stat">
          <div className="stat-label">
            <span className="profile-dot" style={{ background: "var(--text-tertiary)" }} /> Apagados
          </div>
          <div className="stat-value">{curation.hidden.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="portfolio-loading">
          <div className="loader" />
          <span>Cargando yields...</span>
        </div>
      ) : (
        <>
          <div className="admin-list-header">
            <span>Yield</span>
            <span>APY</span>
            <span>Auto</span>
            <span>Asignar a perfil</span>
            <span>Estado</span>
          </div>
          <div className="list">
            {filtered.map((y) => {
              const auto = classifyRisk(y);
              const hidden = curation.hidden.includes(y.id);
              return (
                <div key={y.id} className={`admin-row ${hidden ? "admin-row-off" : ""}`}>
                  <div className="token">
                    {y.token?.logoURI ? (
                      <img className="token-logo" src={y.token.logoURI} alt="" width={32} height={32} />
                    ) : (
                      <div className="token-avatar">{(y.token?.symbol ?? "?").slice(0, 3)}</div>
                    )}
                    <div className="token-text">
                      <div className="token-symbol">{y.token?.symbol ?? y.id}</div>
                      <div className="token-name">
                        {y.provider} &middot; {fmtType(y.type)} &middot; {y.network}
                      </div>
                    </div>
                  </div>
                  <span className="apy-num">{fmtApy(y.apy)}</span>
                  <span className="auto-badge" style={{ color: RISK_PROFILES[auto].accent }}>
                    {RISK_PROFILES[auto].short}
                  </span>
                  <div className="assign-btns">
                    {RISK_ORDER.map((level) => {
                      const active = curation[level].includes(y.id);
                      const p = RISK_PROFILES[level];
                      return (
                        <button
                          key={level}
                          className={`assign-btn ${active ? "active" : ""}`}
                          style={active ? { background: p.accent, borderColor: p.accent } : undefined}
                          onClick={() => toggle(y.id, level)}
                          disabled={hidden}
                          title={hidden ? "Yield apagado — encendelo para asignarlo" : undefined}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className={`power-btn ${hidden ? "off" : "on"}`}
                    onClick={() => toggleHidden(y.id)}
                    title={hidden ? "Encender (mostrar a usuarios)" : "Apagar (ocultar de toda la app)"}
                  >
                    <PowerIcon />
                    {hidden ? "Apagado" : "Activo"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
