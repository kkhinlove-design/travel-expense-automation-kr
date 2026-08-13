import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeadersFor } from "../_shared/cors.ts";

const MAX_BULK_USERS = 100;
const MAX_EMAIL_LENGTH = 240;
const MAX_NAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 128;
const MAX_ROW_NUMBER = 1_000_000;
const DUPLICATE_USER_CODES = new Set(["email_exists", "user_already_exists"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function safeRowNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_ROW_NUMBER
    ? number
    : fallback;
}

function duplicateUserError(error: { code?: string; message?: string }) {
  const code = String(error.code ?? "").trim().toLowerCase();
  if (DUPLICATE_USER_CODES.has(code)) return true;
  return /already|exists|registered/i.test(String(error.message ?? ""));
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
    const { adminClient } = authorization;

    const body = await request.json() as Record<string, unknown>;

    if (Array.isArray(body.users)) {
      if (!body.users.length) return respond({ error: "bulk_empty" }, 400);
      if (body.users.length > MAX_BULK_USERS) {
        return respond({ error: "bulk_limit" }, 400);
      }
      const created: Array<Record<string, unknown>> = [];
      const duplicates: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      for (const [index, raw] of body.users.entries()) {
        const item = (raw && typeof raw === "object")
          ? raw as Record<string, unknown>
          : {};
        const row = safeRowNumber(item.rowNumber, index + 2);
        const email = clean(item.email).toLowerCase();
        const password = typeof item.password === "string" ? item.password : "";
        const fullName = clean(item.fullName);
        if (email.length > MAX_EMAIL_LENGTH) {
          failed.push({ row, email, reason: "email_too_long" });
          continue;
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          failed.push({ row, email, reason: "valid_email_required" });
          continue;
        }
        if (fullName.length > MAX_NAME_LENGTH) {
          failed.push({ row, email, reason: "name_too_long" });
          continue;
        }
        if (!fullName) {
          failed.push({ row, email, reason: "name_required" });
          continue;
        }
        if (password.length < 8) {
          failed.push({ row, email, reason: "password_min_8" });
          continue;
        }
        if (password.length > MAX_PASSWORD_LENGTH) {
          failed.push({ row, email, reason: "password_too_long" });
          continue;
        }
        if (seen.has(email)) {
          duplicates.push({ row, email });
          continue;
        }
        seen.add(email);
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
        if (error) {
          if (duplicateUserError(error)) {
            duplicates.push({ row, email });
          } else failed.push({ row, email, reason: "create_failed" });
        } else {
          created.push({ row, email: data.user?.email || email, fullName });
        }
      }
      return respond({ created, duplicates, failed });
    }

    const email = clean(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = clean(body.fullName);
    if (email.length > MAX_EMAIL_LENGTH) {
      return respond({ error: "email_too_long" }, 400);
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return respond({ error: "valid_email_required" }, 400);
    }
    if (fullName.length > MAX_NAME_LENGTH) {
      return respond({ error: "name_too_long" }, 400);
    }
    if (password.length < 8) return respond({ error: "password_min_8" }, 400);
    if (password.length > MAX_PASSWORD_LENGTH) {
      return respond({ error: "password_too_long" }, 400);
    }
    if (!fullName) return respond({ error: "name_required" }, 400);
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) {
      const duplicate = duplicateUserError(error);
      return respond(
        { error: duplicate ? "user_exists" : "create_failed" },
        duplicate ? 409 : 400,
      );
    }
    return respond({
      user: { id: data.user?.id, email: data.user?.email, fullName },
    }, 201);
  } catch {
    return respond({ error: "invalid_request" }, 400);
  }
});
