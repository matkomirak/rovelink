import { createApp } from "./app";
import { log } from "./vite";
import express from "express";
import path from "path";
import fs from "fs";

(async () => {
  const { app, httpServer } = await createApp();

  // Setup Vite in development or serve static files in production
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite-dev");
    await setupVite(app, httpServer);
  } else {
    const distPath = path.resolve(process.cwd(), "dist", "public");

    if (!fs.existsSync(distPath)) {
      throw new Error(
        `Could not find the build directory: ${distPath}, make sure to build the client first with 'npm run build'`,
      );
    }

    app.use(express.static(distPath));

    app.use("*", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
