import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.112.2";

type AdminAuthSuccess = {
  ok: true;
  caller: User;
  adminClient: SupabaseClient;
};

type AdminAuthFailure = {
  ok: false;
  status: 401 | 403 | 500;
  error: "unauthorized" | "forbidden" | "admin_key_not_configured";
};

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure;

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function cleanSecret(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function configuredKey(
  jsonEnvironmentName: string,
  legacyEnvironmentName: string,
) {
  const raw = cleanSecret(Deno.env.get(jsonEnvironmentName));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string") return cleanSecret(parsed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const preferred = cleanSecret(record.default);
        if (preferred) return preferred;
        const first = Object.values(record).map(cleanSecret).find(Boolean);
        if (first) return first;
      }
    } catch {
      // Self-hosted deployments may expose the key as a plain environment value.
      if (!raw.startsWith("{") && !raw.startsWith("[")) return raw;
    }
  }
  return cleanSecret(Deno.env.get(legacyEnvironmentName));
}

function configuredAdminEmails() {
  return new Set(
    (Deno.env.get("ADMIN_EMAILS") ?? "")
      .split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hasAdminRole(user: User) {
  const metadata = user.app_metadata ?? {};
  const role = String(metadata.role ?? "").trim().toLowerCase();
  if (ADMIN_ROLES.has(role)) return true;
  const roles = Array.isArray(metadata.roles)
    ? metadata.roles
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
    : [];
  if (roles.some((item) => ADMIN_ROLES.has(item))) return true;
  const email = user.email?.trim().toLowerCase() ?? "";
  return Boolean(email && configuredAdminEmails().has(email));
}

export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  const accessToken = match?.[1] ?? "";
  if (!accessToken || accessToken.length > 8192) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const secretKey = configuredKey(
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  if (!supabaseUrl || !secretKey) {
    return { ok: false, status: 500, error: "admin_key_not_configured" };
  }

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data: { user }, error } = await adminClient.auth.getUser(accessToken);
  if (error || !user) return { ok: false, status: 401, error: "unauthorized" };
  if (!hasAdminRole(user)) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  return { ok: true, caller: user, adminClient };
}
