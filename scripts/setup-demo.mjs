import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

// Generate private local credentials once; never print them or overwrite an existing file.
const secret = () => randomBytes(32).toString("hex");
const lines = [
  "# Private local demo configuration. Never commit this file or use it in production.",
  "DEMO_ROVELINK_PORT=5100", "DEMO_NETBOX_PORT=8100",
  `DEMO_DB_PASSWORD=${secret()}`, `DEMO_SESSION_SECRET=${secret()}`,
  `DEMO_JWT_SECRET=${secret()}`, `DEMO_ENCRYPTION_KEY=${secret()}`,
  `DEMO_ADMIN_PASSWORD=${secret()}`, `DEMO_NETBOX_DB_PASSWORD=${secret()}`,
  `DEMO_NETBOX_SECRET_KEY=${secret()}`, `DEMO_NETBOX_ADMIN_PASSWORD=${secret()}`,
  `DEMO_NETBOX_TOKEN_PEPPER=${secret()}`,
];
try {
  writeFileSync(".env.demo", lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log("Created private .env.demo. Login names are admin (Rovelink) and demo-admin (NetBox); read their generated passwords in that file.");
} catch (error) {
  if (error.code === "EEXIST") console.log(".env.demo already exists; existing credentials preserved.");
  else throw error;
}
