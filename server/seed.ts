import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "./db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const adminUsername = process.env.BOOTSTRAP_ADMIN_USER || "admin";

  try {
    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.username, adminUsername));

    if (existingAdmin) {
      console.log(`Admin user '${adminUsername}' already exists (id: ${existingAdmin.id})`);
      process.exit(0);
    }

    // Use env-provided password or generate a one-time random password
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
      // Only print the password when it's newly generated (first bootstrap)
      console.log(`One-time password: ${adminPassword}`);
      console.log("Change this password immediately after first login.");
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
