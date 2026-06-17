import { MongoClient, type Db } from "mongodb";

// Cache the client across hot-reloads (dev) and across requests (prod) so we
// don't open a new connection pool on every API call. Next.js re-evaluates
// modules on HMR, so we stash the promise on globalThis.

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "yield_xyz";

let clientPromise: Promise<MongoClient> | undefined;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!uri) {
    throw new Error("MONGODB_URI not configured in .env.local");
  }
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = new MongoClient(uri).connect();
    }
    return global._mongoClientPromise;
  }
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

export function isMongoConfigured(): boolean {
  return !!uri;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}
