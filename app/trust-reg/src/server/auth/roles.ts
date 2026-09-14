import type { UserRole } from "@/server/domain/types";
export type { UserRole };

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName?: string;
  wmTeam?: string;
  isActive: boolean;
}

// Throws with an "Unauthorized"/"Forbidden" prefix so toErrorResponse can map the status code.
export function requireRole(user: AuthUser | null, allowed: UserRole[]): AuthUser {
  if (!user) {
    throw new Error("Unauthorized: no user session");
  }
  if (!user.isActive) {
    throw new Error("Unauthorized: user is inactive");
  }
  if (!allowed.includes(user.role)) {
    throw new Error(`Forbidden: role ${user.role} is not allowed for this action`);
  }
  return user;
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new Error("Unauthorized: no user session");
  if (!user.isActive) throw new Error("Unauthorized: user is inactive");
  return user;
}

export function hasRole(user: AuthUser | null, role: UserRole): boolean {
  return user?.role === role && user.isActive;
}

export function hasAnyRole(user: AuthUser | null, roles: UserRole[]): boolean {
  return user ? roles.includes(user.role) && user.isActive : false;
}

export const ROLES_CAN_CREATE_CASE: UserRole[] = ["wm_requester", "administrator"];
export const ROLES_CAN_PROCESS: UserRole[] = ["aep_processor", "aep_reviewer", "administrator"];
export const ROLES_CAN_VERIFY: UserRole[] = ["aep_reviewer", "compliance_reviewer", "administrator"];
export const ROLES_CAN_READ_ALL: UserRole[] = [
  "aep_processor",
  "aep_reviewer",
  "compliance_reviewer",
  "administrator",
  "auditor",
];
