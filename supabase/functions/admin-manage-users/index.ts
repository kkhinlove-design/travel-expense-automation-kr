import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import {
  isProtectedAdmin,
  managedUserView,
  MAX_MANAGED_USERS,
  validateManagedUserInput,
} from "../_shared/admin-user-management.ts";

function configuredAdminEmails() {
  return new Set(
    (Deno.env.get("ADMIN_EMAILS") ?? "")
      .split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

Deno.serve(async (request) => {
  const corsHeaders = corsHeadersFor(request);
  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "method_not_allowed" }, 405);
  }

  try {
    const authorization = await requireAdmin(request);
    if (!authorization.ok) {
      return respond({ error: authorization.error }, authorization.status);
    }
    const { adminClient, caller } = authorization;
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const adminEmails = configuredAdminEmails();

    if (action === "list") {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: MAX_MANAGED_USERS,
      });
      if (error) {
        console.error("admin-manage-users list failed", error.code);
        return respond({ error: "user_list_failed" }, 500);
      }
      const users = data.users
        .map((user) => managedUserView(user, caller.id, adminEmails))
        .sort((left, right) =>
          left.fullName.localeCompare(right.fullName, "ko-KR") ||
          left.email.localeCompare(right.email)
        );
      return respond({ users, truncated: users.length >= MAX_MANAGED_USERS });
    }

    if (action !== "update") {
      return respond({ error: "invalid_action" }, 400);
    }

    const validated = validateManagedUserInput(body.user);
    if (!validated.ok) return respond({ error: validated.error }, 400);
    const input = validated.value;

    const { data: targetData, error: targetError } = await adminClient.auth.admin
      .getUserById(input.id);
    const target = targetData?.user;
    if (targetError || !target) {
      return respond({ error: "user_not_found" }, 404);
    }

    const currentEmail = target.email?.trim().toLowerCase() ?? "";
    const credentialsChanged = input.email !== currentEmail || Boolean(input.password);
    if (isProtectedAdmin(target, adminEmails) && credentialsChanged) {
      return respond({ error: "protected_admin_credentials" }, 403);
    }
    if (input.email !== currentEmail && adminEmails.has(input.email)) {
      return respond({ error: "reserved_admin_email" }, 403);
    }

    const attributes: Record<string, unknown> = {
      user_metadata: {
        ...(target.user_metadata ?? {}),
        full_name: input.fullName,
      },
    };
    if (input.email !== currentEmail) {
      attributes.email = input.email;
      attributes.email_confirm = true;
    }
    if (input.password) attributes.password = input.password;

    const { data, error } = await adminClient.auth.admin.updateUserById(
      target.id,
      attributes,
    );
    if (error || !data.user) {
      const duplicate = new Set(["email_exists", "user_already_exists"]).has(
        String(error?.code ?? "").toLowerCase(),
      );
      console.error("admin-manage-users update failed", error?.code);
      return respond(
        { error: duplicate ? "user_exists" : "user_update_failed" },
        duplicate ? 409 : 400,
      );
    }

    return respond({
      user: managedUserView(data.user, caller.id, adminEmails),
      passwordChanged: Boolean(input.password),
    });
  } catch {
    return respond({ error: "invalid_request" }, 400);
  }
});
