// Seed de admins en MongoDB.
//
// Uso:
//   node scripts/seed-admins.mjs email1@x.com email2@x.com ...
//
// Para cada email genera contraseña + secreto TOTP al azar, hashea la
// contraseña (scrypt) y hace upsert en la colección `admins`. Imprime las
// credenciales y el otpauth:// para cargar en Google Authenticator / Authy.
// No guarda contraseñas en texto plano: solo se muestran una vez por consola.

import crypto from "crypto";
import fs from "fs";
import { MongoClient } from "mongodb";
import { Secret, TOTP } from "otpauth";

// Leer MONGODB_URI / MONGODB_DB de .env.local
const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const uri = env.MONGODB_URI;
const dbName = env.MONGODB_DB || "yield_xyz";

const emails = process.argv.slice(2);
if (emails.length === 0) {
  console.error("Pasá al menos un email: node scripts/seed-admins.mjs admin@x.com");
  process.exit(1);
}

function randomPassword() {
  // 16 chars alfanuméricos, fuerte y copiable.
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

const client = new MongoClient(uri);
await client.connect();
const col = client.db(dbName).collection("admins");
await col.createIndex({ email: 1 }, { unique: true });

console.log("\n===== CREDENCIALES DE ADMIN (guardalas, no se vuelven a mostrar) =====\n");

for (const raw of emails) {
  const email = raw.toLowerCase().trim();
  const password = randomPassword();
  const { salt, hash } = hashPassword(password);
  const totpSecret = new Secret({ size: 20 }).base32;
  const otpauth = new TOTP({
    issuer: "Yield Admin",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(totpSecret),
  }).toString();

  await col.updateOne(
    { email },
    { $set: { email, salt, hash, totpSecret, totpEnrolled: false, createdAt: new Date() } },
    { upsert: true }
  );

  console.log(`Email:        ${email}`);
  console.log(`Password:     ${password}`);
  console.log(`2FA secret:   ${totpSecret}   (ingresá esto en Authenticator)`);
  console.log(`otpauth URI:  ${otpauth}`);
  console.log("");
}

console.log("=====================================================================\n");
await client.close();
