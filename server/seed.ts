import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { users, organizations } from "../shared/schema";
import { eq, isNull } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const adminUsername = process.env.BOOTSTRAP_ADMIN_USER || "admin";
  const isProduction = process.env.NODE_ENV === "production";

  try {
    // ── 1. Ensure default organization exists ──────────────────────────────
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

    // ── 2. Associate any existing orgId-less records with the default org ──
    // Users
    await db
      .update(users)
      .set({ orgId: defaultOrg.id })
      .where(isNull(users.orgId));

    // ── 3. Ensure admin user exists ────────────────────────────────────────
    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.username, adminUsername));

    if (existingAdmin) {
      console.log(`Admin user '${adminUsername}' already exists (id: ${existingAdmin.id})`);
      process.exit(0);
    }

    const providedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
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

    console.log(`Admin user '${admin.username}' created (id: ${admin.id}).`);

    if (!providedPassword) {
      if (isProduction) {
        const credFile = path.resolve(process.cwd(), "bootstrap-credentials.txt");
        const content =
          [
            "Rovelink bootstrap credentials — delete this file after first login",
            `Username: ${adminUsername}`,
            `Password: ${adminPassword}`,
            `Generated: ${new Date().toISOString()}`,
          ].join("\n") + "\n";
        fs.writeFileSync(credFile, content, { mode: 0o600 });
        console.log(`One-time credentials written to: ${credFile}`);
        console.log("Delete this file and change the password immediately after first login.");
      } else {
        console.log(`One-time password: ${adminPassword}`);
        console.log("Change this password immediately after first login.");
      }
    } else {
      console.log("Password set from BOOTSTRAP_ADMIN_PASSWORD environment variable.");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  }
}

seed();
