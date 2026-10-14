import bcrypt from "bcryptjs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db";
import { users, organizations } from "../shared/schema";
import { eq, isNull } from "drizzle-orm";

const DEFAULT_BOOTSTRAP_PASSWORDS = new Set([
  "changeme",
  "change_me",
  "password",
  "admin",
  "admin123",
  "rovelink",
]);

export function isLocalDevBootstrapAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ROVELINK_LOCAL_DEV === "true" || env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

export function isWeakBootstrapAdminPassword(password: string | undefined): boolean {
  if (!password) return false;
  const normalized = password.trim().toLowerCase();
  return normalized.length < 12 || DEFAULT_BOOTSTRAP_PASSWORDS.has(normalized);
}

export function validateBootstrapAdminPassword(
  password: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (password && isWeakBootstrapAdminPassword(password) && !isLocalDevBootstrapAllowed(env)) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD is weak or default. Set a strong password, leave it blank to generate one, or set ROVELINK_LOCAL_DEV=true for local-only Docker development.",
    );
  }
}

export function shouldCreateBootstrapAdmin(existingAdmin: unknown): boolean {
  return !existingAdmin;
}

export function displayBootstrapCredentials(
  adminUsername: string,
  adminPassword: string,
  providedPassword: string | undefined,
  print: (message: string) => void = console.log,
): void {
  if (providedPassword) {
    print("Bootstrap admin password set from BOOTSTRAP_ADMIN_PASSWORD environment variable.");
    return;
  }
  print("Credentials are displayed once during setup. Store them securely.");
  print(`Username: ${adminUsername}\nPassword: ${adminPassword}`);
  print("Change the password after first login. Do not save or share setup output.");
}

async function seed() {
  console.log("Seeding database...");

  const adminUsername = process.env.BOOTSTRAP_ADMIN_USER || "admin";

  try {
    let defaultOrg = await db.query.organizations
      .findFirst({ where: eq(organizations.slug, "default") })
      .catch(() => undefined);

    if (!defaultOrg) {
      const [created] = await db
        .insert(organizations)
        .values({ name: "Default Organization", slug: "default", plan: "free" })
        .returning();
      defaultOrg = created;
      console.log(`Default organization created (id: ${defaultOrg.id})`);
    } else {
      console.log(`Default organization already exists (id: ${defaultOrg.id})`);
    }

    await db
      .update(users)
      .set({ orgId: defaultOrg.id })
      .where(isNull(users.orgId));

    const providedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    validateBootstrapAdminPassword(providedPassword);

    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.username, adminUsername));

    if (!shouldCreateBootstrapAdmin(existingAdmin)) {
      console.log(`Admin user '${adminUsername}' already exists (id: ${existingAdmin!.id}); password was not changed.`);
      process.exit(0);
    }

    const adminPassword = providedPassword || crypto.randomBytes(16).toString("hex");
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const [admin] = await db
      .insert(users)
      .values({
        orgId: defaultOrg.id,
        username: adminUsername,
        password: hashedPassword,
        role: "admin",
      })
      .returning();

    console.log(`Bootstrap admin user '${admin.username}' created (id: ${admin.id}).`);

    displayBootstrapCredentials(adminUsername, adminPassword, providedPassword);

    process.exit(0);
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed();
}
