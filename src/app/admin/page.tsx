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

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
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

type Stage = "creds" | "enroll" | "totp";

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);

  const [stage, setStage] = useState<Stage>("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // El token de sesión lleva su propio vencimiento (exp); lo validamos local
  // para decidir si mostrar el panel. La firma se verifica en el servidor en
  // cada escritura.
  function sessionLive(t: string): boolean {
    try {
      const payload = JSON.parse(atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      return typeof payload.exp === "number" && payload.exp > Date.now();
    } catch {
      return false;
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("adminToken");
    if (saved && sessionLive(saved)) {
      setToken(saved);
      setAuthed(true);
    } else if (saved) {
      sessionStorage.removeItem("adminToken");
    }
    setChecking(false);
  }, []);

  async function postLogin(body: object) {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  // Paso 1: email + contraseña → enroll (QR) o totp (código).
  const submitCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setSubmitting(true);
    try {
      const { res, data } = await postLogin({ email, password });
      if (!res.ok) {
        setAuthError(data.error ?? "No se pudo ingresar");
        return;
      }
      if (data.stage === "enroll") {
        setQr(data.qr);
        setSecret(data.secret);
        setStage("enroll");
      } else {
        setStage("totp");
      }
      setCode("");
    } catch {
      setAuthError("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  // Paso 2: validar el código TOTP.
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setSubmitting(true);
    try {
      const { res, data } = await postLogin({ email, password, token: code });
      if (res.ok && data.token) {
        sessionStorage.setItem("adminToken", data.token);
        setToken(data.token);
        setAuthed(true);
      } else {
        setAuthError(data.error ?? "Código incorrecto");
      }
    } catch {
      setAuthError("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  const resetToCreds = () => {
    setStage("creds");
    setCode("");
    setAuthError("");
  };

  const logout = () => {
    sessionStorage.removeItem("adminToken");
    setAuthed(false);
    setToken("");
    setEmail("");
    setPassword("");
    setCode("");
    setStage("creds");
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

  if (authed) {
    return <AdminPanel token={token} onLogout={logout} />;
  }

  return (
    <div className="page">
      <div className="admin-login">
        <div className="admin-login-card">
          <div className="admin-login-badge">
            <LockIcon />
          </div>
          <h2 className="admin-login-title">Panel de administración</h2>

          {stage === "creds" && (
            <>
              <p className="admin-login-sub">Ingresá con tu cuenta de administrador.</p>
              <form onSubmit={submitCreds} className="admin-login-form">
                <input
                  className="admin-field"
                  type="email"
                  placeholder="Email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
                <input
                  className="admin-field"
                  type="password"
                  placeholder="Contraseña"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {authError && <p className="form-error">{authError}</p>}
                <button className="btn btn-primary" type="submit" disabled={!email || !password || submitting}>
                  {submitting ? "Verificando..." : "Continuar"}
                </button>
              </form>
            </>
          )}

          {stage === "enroll" && (
            <>
              <p className="admin-login-sub">
                Activá tu 2FA: escaneá el QR con Google Authenticator o Authy, o cargá la clave a
                mano. Después ingresá el código de 6 dígitos.
              </p>
              {qr && <img className="admin-qr" src={qr} alt="QR para 2FA" width={200} height={200} />}
              <div className="admin-secret">
                <span className="admin-secret-label">Clave manual</span>
                <code className="admin-secret-code">{secret}</code>
              </div>
              <form onSubmit={submitCode} className="admin-login-form">
                <input
                  className="admin-field admin-2fa-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="Código de 6 dígitos"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
                {authError && <p className="form-error">{authError}</p>}
                <button className="btn btn-primary" type="submit" disabled={code.length !== 6 || submitting}>
                  {submitting ? "Verificando..." : "Activar y entrar"}
                </button>
              </form>
              <button className="admin-login-back" onClick={resetToCreds}>&larr; Atrás</button>
            </>
          )}

          {stage === "totp" && (
            <>
              <p className="admin-login-sub">
                Ingresá el código de 6 dígitos de tu app de autenticación.
              </p>
              <form onSubmit={submitCode} className="admin-login-form">
                <input
                  className="admin-field admin-2fa-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="Código 2FA"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
                {authError && <p className="form-error">{authError}</p>}
                <button className="btn btn-primary" type="submit" disabled={code.length !== 6 || submitting}>
                  {submitting ? "Verificando..." : "Ingresar"}
                </button>
              </form>
              <button className="admin-login-back" onClick={resetToCreds}>&larr; Atrás</button>
            </>
          )}

          {stage === "creds" && <a className="admin-login-back" href="/">&larr; Volver a la app</a>}
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
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
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify(curation),
      });
      if (res.status === 401) throw new Error("Sesión vencida. Salí y volvé a ingresar.");
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
