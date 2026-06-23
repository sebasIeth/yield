# 🟡 Yield.xyz Dashboard

Dashboard de **DeFi yields** con experiencia de banca privada: el usuario hace
un test de perfil de riesgo y recibe una **bolsa de inversiones curada**, ve su
**portfolio valuado en USD** con una **calculadora de patrimonio**, e invierte
de forma **no custodial** con su propia wallet. Un **panel de administración con
2FA** decide qué yields ve cada perfil.

> Construido sobre la API de [Yield.xyz](https://yield.xyz) (`api.stakek.it`).

---

## ✨ Qué hace

| Vista | Para quién | Descripción |
|-------|------------|-------------|
| **Sugeridos** | Usuario | Quiz de 4 preguntas → infiere tu perfil (Conservador / Balanceado / Agresivo) y te muestra una bolsa de yields curada |
| **Portfolio** | Usuario | Posiciones valuadas en USD, saldo de billetera, ingreso diario/mensual y una calculadora de interés compuesto con proyección a años |
| **Admin** `/admin` | Administrador | Cura las bolsas de cada perfil y apaga yields. Login con **email + contraseña + 2FA (TOTP)** |

El usuario **solo** descubre yields a través de las bolsas curadas. El admin
controla el contenido. Las inversiones son **no custodiales**: las transacciones
se firman con la wallet del propio usuario.

---

## 🚀 Features destacadas

- **Onboarding inteligente** — un quiz infiere el perfil de riesgo (no hay que elegirlo a ciegas).
- **Bolsas curadas + fallback automático** — el admin arma cada bolsa; si no, se clasifican los yields por riesgo/APY y la bolsa nunca queda vacía.
- **Valuación en USD en tiempo real** — precios y balances desde Yield.xyz.
- **Calculadora de patrimonio** — interés compuesto con aportes mensuales, modo "proyección" y modo "objetivo", con gráfico.
- **Inversión no custodial** — entrar/salir de un yield firmando con tu wallet (wagmi + RainbowKit).
- **Panel admin con 2FA real** — email + contraseña (scrypt) + código TOTP, con alta por QR y token de sesión firmado que protege también la API.
- **Kill switch** — apagar un yield lo oculta de toda la app al instante.

---

## 🛠️ Tecnología

| Capa | Tecnología |
|------|------------|
| Framework | **Next.js 15** (App Router) · **React 19** · **TypeScript** |
| Web3 / Wallet | **wagmi** · **viem** · **RainbowKit** |
| Fuente de datos | API de **Yield.xyz** (`api.stakek.it`) |
| Base de datos | **MongoDB Atlas** (curación + usuarios admin) |
| 2FA | **otpauth** (TOTP, RFC 6238) · **qrcode** |
| Seguridad | `node:crypto` — **scrypt** (contraseñas) · **HMAC-SHA256** (sesión) |
| Estilos | CSS con variables de tema (dark + acento ámbar) |
| Tooling / Deploy | **pnpm** · **Vercel** |

---

## 🔐 Seguridad del login

El panel `/admin` usa **doble factor real**:

1. **Email + contraseña** — contraseñas hasheadas con **scrypt** (salt por
   usuario), comparación de tiempo constante y error genérico anti-enumeración.
2. **Código TOTP** — secreto propio por admin (Google Authenticator / Authy),
   con flujo de **alta por QR** la primera vez.

Tras los dos factores el servidor emite un **token de sesión firmado
(HMAC-SHA256, 12 h)**. Ese token —no la contraseña— autoriza las escrituras de
la API (`POST /api/curation`), así que **el 2FA protege la API, no solo la
pantalla**. Los secretos viven únicamente en variables de entorno.

📄 Detalle completo en **[ARQUITECTURA.md](./ARQUITECTURA.md)**.

---

## ⚡ Cómo correrlo

**Requisitos:** Node 18+, pnpm, una cuenta de MongoDB Atlas y una API key de Yield.xyz.

```bash
# 1. Instalar dependencias
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env.local      # y completá los valores

# 3. Crear un usuario admin (genera contraseña + secreto 2FA y los imprime)
node scripts/seed-admins.mjs tu@email.com

# 4. Levantar el dev server
pnpm dev                         # http://localhost:3003
```

### Variables de entorno

| Variable | Para qué |
|----------|----------|
| `YIELD_API_KEY` | API key de Yield.xyz |
| `ADMIN_KEY` | Secreto del server para firmar los tokens de sesión (no es la contraseña) |
| `MONGODB_URI` | Connection string de MongoDB Atlas |
| `MONGODB_DB` | Nombre de la base (`yield_xyz`) |

---

## 📁 Estructura

```
src/
├── app/
│   ├── page.tsx          # App de usuario (Sugeridos + Portfolio + modales)
│   ├── admin/page.tsx    # Panel admin (login 2FA + curación)
│   └── api/              # Rutas server (yields, portfolio, prices, curation, login…)
├── lib/
│   ├── yield-api.ts      # Cliente de Yield.xyz + caché
│   ├── risk.ts           # Perfiles, clasificación de riesgo, bolsas
│   ├── compound.ts       # Interés compuesto / proyección
│   ├── mongo.ts          # Cliente MongoDB
│   ├── admins.ts         # Usuarios admin
│   └── admin-auth.ts     # scrypt + TOTP + token de sesión (HMAC)
└── scripts/seed-admins.mjs
```

Ver **[ARQUITECTURA.md](./ARQUITECTURA.md)** para el flujo de datos, la lógica
de cada feature, los esquemas de MongoDB y la tabla de endpoints.

---

## ☁️ Deploy (Vercel)

1. Conectar el repo a Vercel (detecta Next.js + pnpm automáticamente).
2. Cargar las 4 variables de entorno en **Settings → Environment Variables**.
3. En MongoDB Atlas → **Network Access**, permitir las IPs de Vercel (o `0.0.0.0/0`).
4. **Redeploy**. La curación y los admins persisten en Atlas (compartido entre local y prod).

---

## 📜 Notas

- **No custodial**: la app nunca toma control de los fondos; el usuario firma sus
  propias transacciones.
- **Solo lectura para usuarios**: la curación se edita exclusivamente desde el
  panel admin protegido por 2FA.
