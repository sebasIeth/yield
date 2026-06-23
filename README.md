# 🟡 Yield.xyz Dashboard

A **DeFi yields** dashboard with a private-banking feel: users take a risk-profile
quiz and get a **curated bag of investments**, see their **portfolio valued in
USD** with a **wealth calculator**, and invest **non-custodially** with their own
wallet. An **admin panel with 2FA** decides which yields each profile sees.

> Built on top of the [Yield.xyz](https://yield.xyz) API (`api.stakek.it`).

---

## ✨ What it does

| View | For whom | Description |
|------|----------|-------------|
| **Suggested** | User | A 4-question quiz infers your risk profile (Conservative / Balanced / Aggressive) and shows a curated bag of yields |
| **Portfolio** | User | Positions valued in USD, wallet balance, daily/monthly income, and a compound-interest calculator with multi-year projection |
| **Admin** `/admin` | Administrator | Curates each profile's bag and can disable yields. Login with **email + password + 2FA (TOTP)** |

Users **only** discover yields through the curated bags. The admin controls the
content. Investments are **non-custodial**: transactions are signed with the
user's own wallet.

---

## 🚀 Highlights

- **Smart onboarding** — a quiz infers the risk profile (no blind picking).
- **Curated bags + automatic fallback** — the admin builds each bag; otherwise yields are classified by risk/APY and the bag is never empty.
- **Real-time USD valuation** — prices and balances from Yield.xyz.
- **Wealth calculator** — compound interest with monthly contributions, a "projection" mode and a "goal" mode, with a chart.
- **Non-custodial investing** — enter/exit a yield by signing with your wallet (wagmi + RainbowKit).
- **Real 2FA admin panel** — email + password (scrypt) + TOTP code, with QR enrollment and a signed session token that also protects the API.
- **Kill switch** — disabling a yield hides it across the whole app instantly.

---

## 🛠️ Tech stack

| Layer | Technology |
|-------|------------|
| Framework | **Next.js 15** (App Router) · **React 19** · **TypeScript** |
| Web3 / Wallet | **wagmi** · **viem** · **RainbowKit** |
| Data source | **Yield.xyz** API (`api.stakek.it`) |
| Database | **MongoDB Atlas** (curation + admin users) |
| 2FA | **otpauth** (TOTP, RFC 6238) · **qrcode** |
| Security | `node:crypto` — **scrypt** (passwords) · **HMAC-SHA256** (session) |
| Styling | CSS with theme variables (dark + amber accent) |
| Tooling / Deploy | **pnpm** · **Vercel** |

---

## 🔐 Login security

The `/admin` panel uses **real two-factor authentication**:

1. **Email + password** — passwords hashed with **scrypt** (per-user salt),
   constant-time comparison, and a generic error to prevent user enumeration.
2. **TOTP code** — a per-admin secret (Google Authenticator / Authy), with a
   **QR enrollment** flow the first time.

After both factors, the server issues a **signed session token (HMAC-SHA256,
12 h)**. That token — not the password — authorizes API writes
(`POST /api/curation`), so **2FA protects the API, not just the screen**. Secrets
live only in environment variables.

📄 Full details in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## ⚡ Getting started

**Requirements:** Node 18+, pnpm, a MongoDB Atlas account, and a Yield.xyz API key.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables
cp .env.example .env.local      # then fill in the values

# 3. Create an admin user (generates a password + 2FA secret and prints them)
node scripts/seed-admins.mjs you@email.com

# 4. Start the dev server
pnpm dev                         # http://localhost:3003
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `YIELD_API_KEY` | Yield.xyz API key |
| `ADMIN_KEY` | Server secret used to sign session tokens (not the login password) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGODB_DB` | Database name (`yield_xyz`) |

---

## 📁 Project structure

```
src/
├── app/
│   ├── page.tsx          # User app (Suggested + Portfolio + modals)
│   ├── admin/page.tsx    # Admin panel (2FA login + curation)
│   └── api/              # Server routes (yields, portfolio, prices, curation, login…)
├── lib/
│   ├── yield-api.ts      # Yield.xyz client + cache
│   ├── risk.ts           # Profiles, risk classification, bags
│   ├── compound.ts       # Compound interest / projection
│   ├── mongo.ts          # MongoDB client
│   ├── admins.ts         # Admin users
│   └── admin-auth.ts     # scrypt + TOTP + session token (HMAC)
└── scripts/seed-admins.mjs
```

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the data flow, the logic of each
feature, the MongoDB schemas, and the endpoint reference.

---

## ☁️ Deploy (Vercel)

1. Connect the repo to Vercel (it auto-detects Next.js + pnpm).
2. Add the 4 environment variables under **Settings → Environment Variables**.
3. In MongoDB Atlas → **Network Access**, allow Vercel's IPs (or `0.0.0.0/0`).
4. **Redeploy**. Curation and admins persist in Atlas (shared between local and prod).

---

## 📜 Notes

- **Non-custodial**: the app never takes control of funds; users sign their own
  transactions.
- **Read-only for users**: curation is edited exclusively from the 2FA-protected
  admin panel.
