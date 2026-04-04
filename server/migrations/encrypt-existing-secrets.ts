/**
 * One-time migration: encrypt all existing plaintext secrets in the database.
 *
 * Run with:
 *   ENCRYPTION_KEY=<64-char-hex> tsx server/migrations/encrypt-existing-secrets.ts
 *
 * Safe to re-run — already-encrypted values (prefixed with `enc:v1:`) are
 * detected and skipped. Produces a summary report at the end.
 */

import { db } from "../db";
import { providerAccounts, cmdbAccounts, netboxInventorySources, settings } from "../../shared/schema";
import { eq } from "drizzle-orm";
import {
  encryptProviderConfig,
  encryptCmdbConfig,
  encryptNetboxToken,
  isEncrypted,
  PROVIDER_SECRET_FIELDS,
  CMDB_SECRET_FIELDS,
} from "../services/secrets";

async function run() {
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ERROR: ENCRYPTION_KEY must be set to run this migration.");
    process.exit(1);
  }

  const report = {
    providers: { checked: 0, updated: 0 },
    cmbds: { checked: 0, updated: 0 },
    netboxSources: { checked: 0, updated: 0 },
    settings: { checked: 0, updated: 0 },
  };

  // ── Provider accounts ──────────────────────────────────────────────────────
  console.log("Migrating provider accounts...");
  const providers = await db.select().from(providerAccounts);
  for (const provider of providers) {
    report.providers.checked++;
    const config = (provider.config as Record<string, any>) || {};

    const hasPlaintext = PROVIDER_SECRET_FIELDS.some(
      (f) => typeof config[f] === "string" && config[f] && !isEncrypted(config[f])
    );

    if (hasPlaintext) {
      const encrypted = encryptProviderConfig(config);
      await db
        .update(providerAccounts)
        .set({ config: encrypted })
        .where(eq(providerAccounts.id, provider.id));
      report.providers.updated++;
      console.log(`  [provider] encrypted secrets for "${provider.name}" (${provider.kind})`);
    }
  }

  // ── CMDB accounts ──────────────────────────────────────────────────────────
  console.log("Migrating CMDB accounts...");
  const cmbds = await db.select().from(cmdbAccounts);
  for (const cmdb of cmbds) {
    report.cmbds.checked++;
    const config = (cmdb.config as Record<string, any>) || {};

    const hasPlaintext = CMDB_SECRET_FIELDS.some(
      (f) => typeof config[f] === "string" && config[f] && !isEncrypted(config[f])
    );

    if (hasPlaintext) {
      const encrypted = encryptCmdbConfig(config);
      await db
        .update(cmdbAccounts)
        .set({ config: encrypted })
        .where(eq(cmdbAccounts.id, cmdb.id));
      report.cmbds.updated++;
      console.log(`  [cmdb] encrypted secrets for "${cmdb.name}" (${cmdb.kind})`);
    }
  }

  // ── NetBox inventory source tokens ─────────────────────────────────────────
  console.log("Migrating NetBox inventory sources...");
  const sources = await db.select().from(netboxInventorySources);
  for (const source of sources) {
    report.netboxSources.checked++;
    const token = (source as any).token as string | undefined;

    if (token && !isEncrypted(token)) {
      const encryptedToken = encryptNetboxToken(token);
      await db
        .update(netboxInventorySources)
        .set({ token: encryptedToken } as any)
        .where(eq(netboxInventorySources.id, source.id));
      report.netboxSources.updated++;
      console.log(`  [netbox-source] encrypted token for "${source.name}"`);
    }
  }

  // ── settings.netbox_token ──────────────────────────────────────────────────
  console.log("Migrating settings...");
  const tokenSettings = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "netbox_token"));

  if (tokenSettings.length > 0) {
    report.settings.checked++;
    const stored = tokenSettings[0].value;
    if (stored && !isEncrypted(stored)) {
      const encrypted = encryptNetboxToken(stored);
      await db
        .update(settings)
        .set({ value: encrypted })
        .where(eq(settings.key, "netbox_token"));
      report.settings.updated++;
      console.log(`  [settings] encrypted netbox_token`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n=== Migration Summary ===");
  console.log(`Provider accounts : ${report.providers.updated} / ${report.providers.checked} encrypted`);
  console.log(`CMDB accounts     : ${report.cmbds.updated} / ${report.cmbds.checked} encrypted`);
  console.log(`NetBox sources    : ${report.netboxSources.updated} / ${report.netboxSources.checked} encrypted`);
  console.log(`Settings          : ${report.settings.updated} / ${report.settings.checked} encrypted`);
  console.log("\nMigration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
