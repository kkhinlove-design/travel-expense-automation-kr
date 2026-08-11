const DEFAULT_ADMIN_ROLES = ["admin", "super_admin"];

function normalizedRoles(value) {
  const configured = String(value ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ADMIN_ROLES;
}

export const ADMIN_UI_CONFIG = Object.freeze({
  roles: Object.freeze(normalizedRoles(process.env.NEXT_PUBLIC_ADMIN_ROLES)),
  // This address is only a backwards-compatible UI hint/gate. Privileged
  // server and Edge Function operations must authorize the request again.
  fallbackEmail: String(process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").trim().toLowerCase(),
});

export function hasAdminUiAccess(user) {
  const appMetadata = user?.app_metadata ?? {};
  const roles = [
    appMetadata.role,
    ...(Array.isArray(appMetadata.roles) ? appMetadata.roles : []),
  ].map((role) => String(role ?? "").trim().toLowerCase()).filter(Boolean);

  if (roles.some((role) => ADMIN_UI_CONFIG.roles.includes(role))) return true;
  return Boolean(
    ADMIN_UI_CONFIG.fallbackEmail
      && String(user?.email ?? "").trim().toLowerCase() === ADMIN_UI_CONFIG.fallbackEmail,
  );
}
