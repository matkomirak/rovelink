import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  const adminUsername = "admin";
  const adminPassword = "admin";

  try {
    // Check if admin user already exists
    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.username, adminUsername));

    if (existingAdmin) {
      console.log(`✅ Admin user '${adminUsername}' already exists`);
      console.log(`   ID: ${existingAdmin.id}`);
      console.log(`   Role: ${existingAdmin.role}`);
      process.exit(0);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create admin user
    const [admin] = await db
      .insert(users)
      .values({
        username: adminUsername,
        password: hashedPassword,
        role: "admin",
      })
      .returning();

    console.log(`✅ Admin user created successfully!`);
    console.log(`   Username: ${admin.username}`);
    console.log(`   Password: ${adminPassword}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   ID: ${admin.id}`);
    console.log("");
    console.log(`🔐 You can now login with:`);
    console.log(`   Username: admin`);
    console.log(`   Password: admin`);
    console.log("");
    console.log(`⚠️  Remember to change the password after first login!`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    process.exit(1);
  }
}

seed();
