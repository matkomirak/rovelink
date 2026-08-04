import type { Response } from "express";
import { redactForLog } from "./secrets";

const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/Token\s+[A-Za-z0-9._~+/=-]+/gi, "Token [REDACTED]"],
  [/PVEAPIToken=[^\s"']+/gi, "PVEAPIToken=[REDACTED]"],
  [/https:\/\/[^/\s:@]+:[^@\s]+@/gi, "https://[REDACTED]@"],
  [/(password|token|secret|api[_-]?key)=([^&\s]+)/gi, "$1=[REDACTED]"],
  [/enc:v1:[a-f0-9:]+/gi, "enc:v1:[REDACTED]"],
];

export function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  const base =
    error instanceof Error
      ? {
          name: error.name,
          message: sanitizeText(error.message),
          stack: sanitizeText(error.stack ?? ""),
        }
      : { message: sanitizeText(String(error)) };

  return redactForLog(base) as Record<string, unknown>;
}

export function sendClientError(
  res: Response,
  status: number,
  message: string,
  extra?: Record<string, unknown>
) {
  return res.status(status).json({ message, ...extra });
}

export function sendInternalError(
  res: Response,
  error: unknown,
  context: string,
  publicMessage = "Internal server error"
) {
  console.error(`[${context}]`, JSON.stringify(sanitizeErrorForLog(error)));
  return res.status(500).json({ message: publicMessage });
}

function sanitizeText(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.slice(0, 4000);
}
