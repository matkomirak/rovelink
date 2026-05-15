// Database connection using Neon serverless PostgreSQL (from javascript_database blueprint)
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;

// In test environments, allow import without DATABASE_URL.
// Queries will throw at runtime if they actually reach the DB — but auth/security
// tests never call storage, so the missing connection is never triggered.
if (!DATABASE_URL && process.env.NODE_ENV !== "test") {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : (null as unknown as Pool);

export const db = DATABASE_URL
  ? drizzle({ client: pool, schema })
  : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
