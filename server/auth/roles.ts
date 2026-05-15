/**
 * Central role hierarchy for Rovelink.
 *
 * Role ranks define a strict ordering:
 *   platform_admin (4) > admin (3) > operator (2) > viewer (1)
 *
 * A user at rank N can access any route that requires rank ≤ N.
 * This means a platform_admin can access admin, operator, and viewer routes
 * without being listed explicitly.
 *
 * IMPORTANT: Use ONLY this module for role checks.
 * Do NOT define local requireRole functions in route files.
 */

import type { Request, Response, NextFunction } from "express";

export const ROLE_RANK = {
  viewer: 1,
  operator: 2,
  admin: 3,
  platform_admin: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;

/**
 * Returns true if the user's role is at or above the required role rank.
 *
 * Examples:
 *   hasRoleAtLeast("admin", "viewer")        → true
 *   hasRoleAtLeast("admin", "admin")         → true
 *   hasRoleAtLeast("admin", "platform_admin") → false
 *   hasRoleAtLeast("platform_admin", "admin") → true
 */
export function hasRoleAtLeast(
  userRole: string | undefined,
  requiredRole: Role
): boolean {
  if (!userRole) return false;
  const userRank = ROLE_RANK[userRole as Role] ?? 0;
  const requiredRank = ROLE_RANK[requiredRole] ?? 999;
  return userRank >= requiredRank;
}

/**
 * Returns true if the user's role is at or above the lowest rank in the
 * provided list. Equivalent to "user satisfies at least one of these roles
 * (or anything above them)".
 *
 * Example: hasAnyRoleAtLeast("operator", ["admin", "operator"]) → true
 *          hasAnyRoleAtLeast("viewer",   ["admin", "operator"]) → false
 */
export function hasAnyRoleAtLeast(
  userRole: string | undefined,
  requiredRoles: Role[]
): boolean {
  if (!requiredRoles.length) return false;
  const minimumRequiredRank = Math.min(
    ...requiredRoles.map((r) => ROLE_RANK[r])
  );
  const userRank = ROLE_RANK[userRole as Role] ?? 0;
  return userRank >= minimumRequiredRank;
}

interface AuthRequest extends Request {
  user?: { role?: string };
}

/**
 * Express middleware factory.
 *
 * requireRole("admin")           → admin or platform_admin passes
 * requireRole("operator")        → operator, admin, platform_admin pass
 * requireRole("platform_admin")  → only platform_admin passes
 * requireRole("admin","operator") → equivalent to requireRole("operator")
 *                                    (takes the minimum required rank)
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (hasAnyRoleAtLeast(req.user.role, roles)) {
      return next();
    }
    return res.status(403).json({ message: "Forbidden" });
  };
}
