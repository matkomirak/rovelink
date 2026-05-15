import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const adminUsername = process.env.BOOTSTRAP_ADMIN_USER || "admin";
  const isProduction = process.env.NODE_ENV === "production";

  try {
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
        username: adminUsername,
        password: hashedPassword,
        role: "admin",
      })
      .returning();

    console.log(`Admin user '${admin.username}' created (id: ${admin.id}).`);

    if (!providedPassword) {
      if (isProduction) {
        // In production write the one-time password to a file instead of stdout
        // so it doesn't appear in log aggregators.
        const credFile = path.resolve(process.cwd(), "bootstrap-credentials.txt");
        const content = [
          "Rovelink bootstrap credentials — delete this file after first login",
          `Username: ${adminUsername}`,
          `Password: ${adminPassword}`,
          `Generated: ${new Date().toISOString()}`,
        ].join("\n") + "\n";
        fs.writeFileSync(credFile, content, { mode: 0o600 });
        console.log(`One-time credentials written to: ${credFile}`);
        console.log("Delete this file and change the password immediately after first login.");
      } else {
        // In development, print to stdout as before (no log aggregators)
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
