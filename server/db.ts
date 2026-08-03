// Database connection using Neon serverless PostgreSQL by default.
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import pg from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_CLIENT = process.env.DATABASE_CLIENT;

// In test environments, allow import without DATABASE_URL.
// Queries will throw at runtime if they actually reach the DB — but auth/security
// tests never call storage, so the missing connection is never triggered.
if (!DATABASE_URL && process.env.NODE_ENV !== "test") {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function createDatabaseClient(connectionString: string) {
  if (DATABASE_CLIENT === "pg") {
    const pool = new pg.Pool({ connectionString });
    return {
      pool,
      db: drizzlePg(pool, { schema }),
    };
  }

  const pool = new NeonPool({ connectionString });
  return {
    pool,
    db: drizzleNeon({ client: pool, schema }),
  };
}

const databaseClient = DATABASE_URL
  ? createDatabaseClient(DATABASE_URL)
  : undefined;

export const pool = databaseClient
  ? databaseClient.pool
  : (null as unknown as ReturnType<typeof createDatabaseClient>["pool"]);

export const db = databaseClient
  ? databaseClient.db
  : (null as unknown as ReturnType<typeof createDatabaseClient>["db"]);
