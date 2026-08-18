import type { User } from "npm:@supabase/supabase-js@2.112.2";

export const MAX_MANAGED_USERS = 1_000;
export const MAX_EMAIL_LENGTH = 240;
export const MAX_NAME_LENGTH = 120;
export const MAX_PASSWORD_LENGTH = 128;

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

export type ManagedUser = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  isCurrentUser: boolean;
  isProtectedAdmin: boolean;
};

export type ManagedUserInput = {
  id: string;
  email: string;
  fullName: string;
  password: string;
};

type ValidationResult =
  | { ok: true; value: ManagedUserInput }
  | {
    ok: false;
    error:
      | "user_id_required"
      | "valid_email_required"
      | "email_too_long"
      | "name_required"
      | "name_too_long"
      | "password_min_8"
      | "password_too_long";
  };

export function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function isProtectedAdmin(user: User, configuredAdminEmails: Set<string>) {
  const metadata = user.app_metadata ?? {};
  const role = cleanText(metadata.role).toLowerCase();
  if (ADMIN_ROLES.has(role)) return true;
  const roles = Array.isArray(metadata.roles)
    ? metadata.roles
      .filter((item): item is string => typeof item === "string")
      .map((item) => cleanText(item).toLowerCase())
    : [];
  if (roles.some((item) => ADMIN_ROLES.has(item))) return true;
  const email = cleanText(user.email).toLowerCase();
  return Boolean(email && configuredAdminEmails.has(email));
}

export function managedUserView(
  user: User,
  callerId: string,
  configuredAdminEmails: Set<string>,
): ManagedUser {
  return {
    id: user.id,
    email: cleanText(user.email).toLowerCase(),
    fullName: cleanText(user.user_metadata?.full_name),
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
    isCurrentUser: user.id === callerId,
    isProtectedAdmin: isProtectedAdmin(user, configuredAdminEmails),
  };
}

export function validateManagedUserInput(raw: unknown): ValidationResult {
  const input = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const id = cleanText(input.id);
  const email = cleanText(input.email).toLowerCase();
  const fullName = cleanText(input.fullName);
  const password = typeof input.password === "string" ? input.password : "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: "user_id_required" };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, error: "email_too_long" };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: "valid_email_required" };
  }
  if (!fullName) return { ok: false, error: "name_required" };
  if (fullName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "name_too_long" };
  }
  if (password && password.length < 8) {
    return { ok: false, error: "password_min_8" };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "password_too_long" };
  }
  return { ok: true, value: { id, email, fullName, password } };
}
