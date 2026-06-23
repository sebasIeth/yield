# Yield.xyz Dashboard — Architecture

Technical reference: what it's built with, how it's organized, and the logic
behind each piece. Meant to get anyone (👋 Leo) up to speed fast.

---

## 1. What it is

A web dashboard to **explore, invest in, and manage DeFi yields** using the
[Yield.xyz](https://yield.xyz) API (`api.stakek.it`). It has three faces:

| View | For whom | What it does |
|------|----------|--------------|
| **Suggested** | End user | Takes a risk-profile quiz and shows a curated "bag" of yields for them |
| **Portfolio** | End user | Shows their positions valued in USD + a wealth calculator (compound interest) |
| **Admin** (`/admin`) | Administrator | Curates which yields each profile sees and can disable yields. Login with email + password + 2FA |

Users **only** discover yields through the curated bags (no free exploration).
The admin decides each bag's content.

---

## 2. Tech stack

| Layer | Technology |
|-------|------------|
| Framework | **Next.js 15** (App Router) + **React 19** + **TypeScript** |
| Styling | Plain CSS with theme variables (dark + amber accent) |
| Wallet / Web3 | **wagmi** + **viem** + **RainbowKit** |
| Yield data | **Yield.xyz** API (`api.stakek.it`) |
| Database | **MongoDB Atlas** (curation + admin users) |
| 2FA | **otpauth** (TOTP, RFC 6238) + **qrcode** (enrollment) |
| Crypto/security | `node:crypto` — **scrypt** (passwords) + **HMAC-SHA256** (session) |
| Package manager | **pnpm** |
| Deploy | **Vercel** |

---

## 3. Repo structure

```
src/
├── app/
│   ├── page.tsx              # User app: Suggested + Portfolio + modals
│   ├── admin/page.tsx        # Admin panel: 2FA login + curation
│   ├── layout.tsx            # Root layout
│   ├── providers.tsx         # wagmi / RainbowKit / react-query providers
│   ├── globals.css           # Styles (dark theme, amber)
│   └── api/
│       ├── yields/route.ts           # GET — yield list (proxy to Yield.xyz)
│       ├── yields/[id]/route.ts      # GET — single yield detail
│       ├── yields/enter/route.ts     # POST — build invest tx
│       ├── yields/exit/route.ts      # POST — build withdraw tx
│       ├── portfolio/route.ts        # POST — wallet balances/positions
│       ├── prices/route.ts           # POST — token USD prices
│       ├── transactions/confirm/...  # POST — confirm a sent tx
│       ├── curation/route.ts         # GET (public) / POST (admin) — bags
│       └── admin/login/route.ts      # POST — admin login (2-step + 2FA)
├── lib/
│   ├── yield-api.ts          # Yield.xyz client + in-memory cache
│   ├── risk.ts               # Profiles, risk classification, autoBag
│   ├── compound.ts           # Compound-interest / projection logic
│   ├── mongo.ts              # Cached Mongo client
│   ├── admins.ts             # Access to the `admins` collection
│   └── admin-auth.ts         # Passwords (scrypt), TOTP, session token (HMAC)
└── scripts/
    └── seed-admins.mjs       # Creates admin accounts and prints credentials
```

---

## 4. Overall data flow

```
User ─▶ Next.js (React) ─▶ /api/* (server)
                              │
            ┌─────────────────┼───────────────────┐
            ▼                 ▼                   ▼
      Yield.xyz API      MongoDB Atlas        Wallet (wagmi)
      (yields, prices,   (bag curation,       transaction
       balances, txs)     admins)              signing
```

- **API keys and secrets live only on the server** (environment variables). The
  front end never sees them.
- Yields are cached in memory for 5 min (`lib/yield-api.ts`) to avoid hitting the
  API on every request.

---

## 5. Feature logic

### 5.1 Risk profiles and suggested bags (`lib/risk.ts`)

Three profiles: **Conservative (low)**, **Balanced (medium)**, **Aggressive (high)**.

**Quiz onboarding**: 4 questions (goal, reaction to a drawdown, time horizon,
experience). Each answer scores 0/1/2 and the average defines the profile
(`inferProfile`). Stored in `localStorage`.

**How each profile's bag is built:**
1. If the **admin curated** that profile → show exactly their picks.
2. Otherwise → **automatic bag** (`autoBag`): classify each yield with
   `classifyRisk` (APY-driven: high ≥ 8% or LP/vault; low ≤ 4.5% or moderate
   stable; medium otherwise) and take the top 12 with APY > 0.
3. If classification yields nothing, split by **APY terciles** → the bag is
   **never** empty.

### 5.2 Portfolio and calculator (`page.tsx` + `lib/compound.ts`)

- **USD valuation**: positions come in token units; they're priced via
  `/api/prices` (Yield.xyz prices). Map key: `${network}-${address}`.
- **Wallet balance**: on-chain native balance (ETH/MATIC…) via wagmi, valued in
  USD. Total wealth = wallet + invested.
- **Wealth calculator** (`projectGrowth`): monthly compound interest with
  contributions. Two modes:
  - *Projection*: how much you'd have in X years (area chart: contributed vs total).
  - *Goal* (`yearsToReach`): how many years to reach a target amount.

### 5.3 Admin curation (`/admin` + `/api/curation` + MongoDB)

- The admin assigns each yield to one or more profiles, and can **disable**
  ("turn off") a yield (the `hidden` list) so it doesn't appear in any bag or
  anywhere in the app.
- Everything is stored in MongoDB (`curation` collection, single document).
- The user view is **read-only**: it can't edit or add anything.

---

## 6. 🔐 Login security (the important part)

The `/admin` panel uses **real two-factor authentication**, and the 2FA protects
both the screen and the API.

### Factors

1. **Something you know** — email + password.
   - Passwords are stored **hashed with scrypt** (unique per-user salt + 64-byte
     hash). Never in plaintext.
   - Verification uses **constant-time comparison** (`timingSafeEqual`) to avoid
     timing attacks.
   - Invalid email/password returns a **generic message** ("Email or password
     incorrect") so it never reveals whether the email exists (anti-enumeration).

2. **Something you have** — TOTP code (Google Authenticator / Authy).
   - Each admin has their **own TOTP secret** stored in MongoDB.
   - Verified with `otpauth` and a ±1 window (tolerates clock skew).

### Login flow (2 steps)

```
Step 1: email + password
   │
   ├─ 2FA enrolled?  ──NO──▶  ENROLLMENT screen: shows QR + manual key
   │                          (the secret is revealed ONLY after the password
   │                           is verified). User scans it into their app.
   │                                   │
   └──────────────YES──────────────────┤
                                        ▼
Step 2: 6-digit code  ──valid──▶  server issues a signed SESSION TOKEN
                                   and marks the account as enrolled
```

### Session token (what ties it together)

- After passing both factors, the server generates a token **signed with
  HMAC-SHA256** with a 12 h expiry.
- The signing key (`ADMIN_KEY`) **lives only on the server** and is never sent to
  the client. Changing it invalidates all sessions.
- The front end stores the token in `sessionStorage` and sends it as the
  `x-admin-token` header on every write.

### API protection

- **`POST /api/curation`** (saving curation) **requires a valid session token**
  (it verifies signature + expiry server-side). No token or a tampered token →
  **401**.
- This means 2FA is **not just cosmetic**: even if someone opens the panel URL,
  they can't write anything without having passed email + password + code.
- **Read** endpoints (view yields, view bags) are public on purpose — users need
  to see them; **only writes** are protected.

### Why it's solid

| Threat | Mitigation |
|--------|------------|
| Database theft | Passwords with scrypt + salt (not reversible) |
| Phishing / leaked password | Mandatory second factor (TOTP) |
| User enumeration | Generic login error |
| Timing attacks | Constant-time comparisons |
| Front-end bypass | The API validates the signed token server-side |
| Stolen session | Token with expiry (12 h) and server-side signature |
| Secrets in code | Everything in environment variables (never committed) |

---

## 7. Persistence (MongoDB)

**`curation` collection** (single document `_id: "default"`):
```json
{ "low": ["..."], "medium": ["..."], "high": ["..."], "hidden": ["..."] }
```

**`admins` collection** (one document per administrator):
```json
{
  "email": "admin@yield.xyz",
  "salt": "…", "hash": "…",        // password (scrypt)
  "totpSecret": "BASE32…",          // user's 2FA secret
  "totpEnrolled": false             // whether they already scanned the QR
}
```

Accounts are created with: `node scripts/seed-admins.mjs email@domain.com`
(generates a random password + 2FA secret and prints them once).

---

## 8. Environment variables

| Variable | Purpose |
|----------|---------|
| `YIELD_API_KEY` | Yield.xyz API key |
| `ADMIN_KEY` | Server secret used to **sign session tokens** (not the login password) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGODB_DB` | Database name (`yield_xyz`) |

> Admins (email + password + 2FA) live in MongoDB, not in environment variables.

---

## 9. API endpoints

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| GET | `/api/yields` | public | Yield list (ethereum/polygon/base) |
| GET | `/api/yields/[id]` | public | Single yield detail |
| POST | `/api/yields/enter` | public | Builds the invest tx |
| POST | `/api/yields/exit` | public | Builds the withdraw tx |
| POST | `/api/portfolio` | public | Wallet positions/balances |
| POST | `/api/prices` | public | Token USD prices |
| POST | `/api/transactions/confirm` | public | Confirms a sent tx |
| GET | `/api/curation` | public | Curated bags (to show the user) |
| POST | `/api/curation` | **admin (token)** | Saves the curation |
| POST | `/api/admin/login` | public | Admin login (2-step + 2FA) |

---

## 10. Run and deploy

**Local:**
```bash
pnpm install
pnpm dev                 # http://localhost:3003
node scripts/seed-admins.mjs you@email.com   # create an admin
```

**Vercel:** add the 4 environment variables + Redeploy. Curation and admins
persist in MongoDB Atlas (shared between local and production).
