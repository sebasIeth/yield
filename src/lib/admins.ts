import { getDb } from "./mongo";

// Admins persistidos en MongoDB (colección `admins`):
//   { email, salt, hash, totpSecret, createdAt }
// La contraseña se guarda hasheada (scrypt); totpSecret es Base32.

export interface AdminDoc {
  email: string;
  salt: string;
  hash: string;
  totpSecret: string;
}

const COLLECTION = "admins";

export async function getAdminByEmail(email: string): Promise<AdminDoc | null> {
  const db = await getDb();
  const doc = await db
    .collection(COLLECTION)
    .findOne({ email: email.toLowerCase().trim() });
  return doc as AdminDoc | null;
}
