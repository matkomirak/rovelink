import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { log } from "./vite";
import { redactForLog } from "./services/secrets";
import type { Server } from "http";

export async function createApp(): Promise<{ app: ReturnType<typeof express>; httpServer: Server }> {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));

  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (reqPath.startsWith("/api")) {
        let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          const safeBody = redactForLog(capturedJsonResponse);
          const bodyStr = JSON.stringify(safeBody);
          logLine += ` :: ${bodyStr}`;
        }
        if (logLine.length > 120) {
          logLine = logLine.slice(0, 119) + "…";
        }
        log(logLine);
      }
    });

    next();
  });

  const httpServer = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    log(`Error ${status}: ${message}`);
  });

  return { app, httpServer };
}
