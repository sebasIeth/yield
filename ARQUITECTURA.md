# Yield.xyz Dashboard — Arquitectura del proyecto

Documento de referencia técnica: con qué tecnología se armó, cómo está
organizado y la lógica detrás de cada pieza. Pensado para que cualquiera
(👋 Leo) entienda el proyecto rápido.

---

## 1. Qué es

Dashboard web para **explorar, invertir y administrar yields de DeFi** usando la
API de [Yield.xyz](https://yield.xyz) (`api.stakek.it`). Tiene tres caras:

| Vista | Para quién | Qué hace |
|-------|------------|----------|
| **Sugeridos** | Usuario final | Hace un quiz de perfil de riesgo y le muestra una "bolsa" de yields curada para él |
| **Portfolio** | Usuario final | Muestra sus posiciones valuadas en USD + una calculadora de patrimonio (interés compuesto) |
| **Admin** (`/admin`) | Administrador | Cura qué yields ve cada perfil y puede "apagar" yields. Login con email + contraseña + 2FA |

El usuario **solo** descubre yields a través de las bolsas curadas (no hay
exploración libre). El admin decide el contenido de cada bolsa.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Framework | **Next.js 15** (App Router) + **React 19** + **TypeScript** |
| Estilos | CSS puro con variables de tema (dark + acento ámbar) |
| Wallet / Web3 | **wagmi** + **viem** + **RainbowKit** |
| Datos de yields | API de **Yield.xyz** (`api.stakek.it`) |
| Base de datos | **MongoDB Atlas** (curación + usuarios admin) |
| 2FA | **otpauth** (TOTP, RFC 6238) + **qrcode** (alta) |
| Cripto/seguridad | `node:crypto` — **scrypt** (contraseñas) + **HMAC-SHA256** (sesión) |
| Gestor de paquetes | **pnpm** |
| Deploy | **Vercel** |

---

## 3. Estructura del repo

```
src/
├── app/
│   ├── page.tsx              # App de usuario: Sugeridos + Portfolio + modales
│   ├── admin/page.tsx        # Panel admin: login 2FA + curación
│   ├── layout.tsx            # Layout raíz
│   ├── providers.tsx         # Providers de wagmi / RainbowKit / react-query
│   ├── globals.css           # Estilos (tema dark, ámbar)
│   └── api/
│       ├── yields/route.ts           # GET — lista de yields (proxy a Yield.xyz)
│       ├── yields/[id]/route.ts      # GET — detalle de un yield
│       ├── yields/enter/route.ts     # POST — construir tx de inversión
│       ├── yields/exit/route.ts      # POST — construir tx de retiro
│       ├── portfolio/route.ts        # POST — balances/posiciones del wallet
│       ├── prices/route.ts           # POST — precios USD de tokens
│       ├── transactions/confirm/...  # POST — confirmar tx enviada
│       ├── curation/route.ts         # GET (público) / POST (admin) — bolsas
│       └── admin/login/route.ts      # POST — login admin (2 pasos + 2FA)
├── lib/
│   ├── yield-api.ts          # Cliente de Yield.xyz + caché en memoria
│   ├── risk.ts               # Perfiles, clasificación de riesgo, autoBag
│   ├── compound.ts           # Lógica de interés compuesto / proyección
│   ├── mongo.ts              # Cliente Mongo cacheado
│   ├── admins.ts             # Acceso a la colección `admins`
│   └── admin-auth.ts         # Contraseñas (scrypt), TOTP, token de sesión (HMAC)
└── scripts/
    └── seed-admins.mjs       # Crea cuentas admin y muestra credenciales
```

---

## 4. Flujo de datos general

```
Usuario ─▶ Next.js (React) ─▶ /api/* (server)
                                  │
                ┌─────────────────┼───────────────────┐
                ▼                 ▼                   ▼
        Yield.xyz API        MongoDB Atlas        Wallet (wagmi)
        (yields, precios,    (curación de         firma de
         balances, txs)       bolsas, admins)      transacciones
```

- Las **API keys y secretos viven solo en el server** (variables de entorno).
  El front nunca los ve.
- Los yields se cachean en memoria 5 min (`lib/yield-api.ts`) para no golpear la
  API en cada request.

---

## 5. Lógica de las features

### 5.1 Perfiles de riesgo y bolsas sugeridas (`lib/risk.ts`)

Tres perfiles: **Conservador (low)**, **Balanceado (medium)**, **Agresivo (high)**.

**Onboarding por quiz**: 4 preguntas (objetivo, reacción a una caída, horizonte,
experiencia). Cada respuesta puntúa 0/1/2 y el promedio define el perfil
(`inferProfile`). Se guarda en `localStorage`.

**Cómo se arma la bolsa de cada perfil:**
1. Si el **admin curó** ese perfil → se muestran exactamente sus picks.
2. Si no → **bolsa automática** (`autoBag`): clasifica cada yield con
   `classifyRisk` (dirigido por APY: alto ≥ 8% o LP/vault; bajo ≤ 4.5% o stable
   moderada; medio el resto) y toma el top 12 con APY > 0.
3. Si la clasificación quedara vacía, reparte por **terciles de APY** → la bolsa
   **nunca** queda vacía.

### 5.2 Portfolio y calculadora (`page.tsx` + `lib/compound.ts`)

- **Valuación en USD**: las posiciones vienen en unidades de token; se cotizan
  con `/api/prices` (precios de Yield.xyz). Clave del mapa: `${network}-${address}`.
- **Saldo de billetera**: balance nativo on-chain (ETH/MATIC…) vía wagmi,
  valuado en USD. Patrimonio total = billetera + invertido.
- **Calculadora de patrimonio** (`projectGrowth`): interés compuesto mensual con
  aportes. Dos modos:
  - *Proyección*: cuánto tendrías en X años (gráfico de área: aportado vs total).
  - *Objetivo* (`yearsToReach`): cuántos años para llegar a un monto meta.

### 5.3 Curación admin (`/admin` + `/api/curation` + MongoDB)

- El admin asigna cada yield a uno o más perfiles, y puede **"apagar"** un yield
  (lista `hidden`) para que no aparezca en ninguna bolsa ni en la app.
- Todo se guarda en MongoDB (colección `curation`, documento único).
- La vista de usuario es **solo lectura**: no puede editar ni agregar nada.

---

## 6. 🔐 Seguridad del login (lo más importante)

El panel `/admin` usa **autenticación de dos factores real**, y el 2FA protege
tanto la pantalla como la API.

### Factores

1. **Algo que sabés** — email + contraseña.
   - Las contraseñas se guardan **hasheadas con scrypt** (salt único por usuario
     + hash de 64 bytes). Nunca en texto plano.
   - La verificación usa **comparación de tiempo constante** (`timingSafeEqual`)
     para evitar timing attacks.
   - Email/contraseña inválidos devuelven un **mensaje genérico** ("Email o
     contraseña incorrectos") para no revelar si el email existe (anti-enumeración).

2. **Algo que tenés** — código TOTP (Google Authenticator / Authy).
   - Cada admin tiene su **propio secreto TOTP** guardado en MongoDB.
   - Verificación con `otpauth` y ventana ±1 (tolera desfase de reloj).

### Flujo de login (2 pasos)

```
Paso 1: email + contraseña
   │
   ├─ ¿2FA ya activado?  ──NO──▶  Pantalla de ALTA: muestra QR + clave manual
   │                              (el secreto se revela SOLO tras validar la
   │                               contraseña). El usuario lo escanea en su app.
   │                                       │
   └──────────────SÍ──────────────────────┤
                                           ▼
Paso 2: código de 6 dígitos  ──válido──▶  el server emite un TOKEN DE SESIÓN
                                           firmado y marca la cuenta como activada
```

### Token de sesión (lo que ata todo)

- Tras pasar los 2 factores, el server genera un **token firmado con
  HMAC-SHA256** con vencimiento de 12 h.
- La clave de firma (`ADMIN_KEY`) **vive solo en el server** y nunca se envía al
  cliente. Cambiarla invalida todas las sesiones.
- El front guarda el token en `sessionStorage` y lo manda como header
  `x-admin-token` en cada escritura.

### Protección de la API

- **`POST /api/curation`** (guardar curación) **exige un token de sesión válido**
  (verifica firma + expiración de forma server-side). Sin token o con token
  manipulado → **401**.
- Esto significa que el 2FA **no es solo cosmético**: aunque alguien abra la URL
  del panel, no puede escribir nada sin haber pasado email + contraseña + código.
- Los endpoints de **lectura** (ver yields, ver bolsas) son públicos a propósito
  —el usuario necesita verlos—; **solo las escrituras** están protegidas.

### Resumen de por qué es sólido

| Amenaza | Mitigación |
|---------|------------|
| Robo de la base de datos | Contraseñas con scrypt + salt (no reversibles) |
| Phishing / contraseña filtrada | Segundo factor TOTP obligatorio |
| Enumeración de usuarios | Error genérico de login |
| Timing attacks | Comparaciones de tiempo constante |
| Bypass del front | La API valida el token firmado en el server |
| Sesión robada | Token con expiración (12 h) y firma server-side |
| Secretos en el código | Todo en variables de entorno (no se commitean) |

---

## 7. Persistencia (MongoDB)

**Colección `curation`** (documento único `_id: "default"`):
```json
{ "low": ["..."], "medium": ["..."], "high": ["..."], "hidden": ["..."] }
```

**Colección `admins`** (un documento por administrador):
```json
{
  "email": "admin@yield.xyz",
  "salt": "…", "hash": "…",        // contraseña (scrypt)
  "totpSecret": "BASE32…",          // secreto 2FA del usuario
  "totpEnrolled": false             // si ya escaneó el QR
}
```

Las cuentas se crean con: `node scripts/seed-admins.mjs email@dominio.com`
(genera contraseña + secreto 2FA al azar y los imprime una sola vez).

---

## 8. Variables de entorno

| Variable | Para qué |
|----------|----------|
| `YIELD_API_KEY` | API key de Yield.xyz |
| `ADMIN_KEY` | Secreto del server para **firmar los tokens de sesión** (no es la contraseña de login) |
| `MONGODB_URI` | Connection string de MongoDB Atlas |
| `MONGODB_DB` | Nombre de la base (`yield_xyz`) |

> Los admins (email + contraseña + 2FA) viven en MongoDB, no en variables de
> entorno.

---

## 9. Endpoints API

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| GET | `/api/yields` | público | Lista de yields (ethereum/polygon/base) |
| GET | `/api/yields/[id]` | público | Detalle de un yield |
| POST | `/api/yields/enter` | público | Construye la tx de inversión |
| POST | `/api/yields/exit` | público | Construye la tx de retiro |
| POST | `/api/portfolio` | público | Posiciones/balances de un wallet |
| POST | `/api/prices` | público | Precios USD de tokens |
| POST | `/api/transactions/confirm` | público | Confirma una tx enviada |
| GET | `/api/curation` | público | Bolsas curadas (para mostrar al usuario) |
| POST | `/api/curation` | **admin (token)** | Guarda la curación |
| POST | `/api/admin/login` | público | Login admin (2 pasos + 2FA) |

---

## 10. Cómo correr y desplegar

**Local:**
```bash
pnpm install
pnpm dev                 # http://localhost:3003
node scripts/seed-admins.mjs tu@email.com   # crear un admin
```

**Vercel:** cargar las 4 variables de entorno + Redeploy. La curación y los
admins persisten en MongoDB Atlas (compartido entre local y producción).
