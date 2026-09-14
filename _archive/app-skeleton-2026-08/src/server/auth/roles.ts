// User roles — matches the UserRole enum in Prisma schema.
export type UserRole =
  | "wm_requester"
  | "aep_processor"
  | "aep_reviewer"
  | "compliance_reviewer"
  | "administrator"
  | "auditor";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName?: string;
  wmTeam?: string;
  isActive: boolean;
}

// Server-side guard: checks if the user has any of the allowed roles.
// Throws an error if not.
export function requireRole(user: AuthUser | null, allowed: UserRole[]): AuthUser {
  if (!user) {
    throw new Error("Unauthorized: no user session");
  }

  if (!user.isActive) {
    throw new Error("Unauthorized: user is inactive");
  }

  if (!allowed.includes(user.role)) {
    throw new Error(`Forbidden: role '${user.role}' is not allowed for this action`);
  }

  return user;
}

// Helper: does the user have a specific role?
export function hasRole(user: AuthUser | null, role: UserRole): boolean {
  return user?.role === role && user.isActive;
}

// Helper: does the user have any of these roles?
export function hasAnyRole(user: AuthUser | null, roles: UserRole[]): boolean {
  return user ? roles.includes(user.role) && user.isActive : false;
}
