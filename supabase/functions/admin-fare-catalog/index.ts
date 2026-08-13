import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeadersFor } from "../_shared/cors.ts";

const MAX_ROWS = 500;
const MAX_FARE = 10_000_000;

function clean(value: unknown, max = 120) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function integerFare(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_FARE
    ? number
    : null;
}

function routeKey(origin: string, destination: string) {
  return `${origin.toLocaleLowerCase("ko-KR")}\u0000${
    destination.toLocaleLowerCase("ko-KR")
  }`;
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
    const { caller, adminClient } = authorization;

    const body = await request.json() as Record<string, unknown>;
    const rawRows = body.presets;
    if (!Array.isArray(rawRows) || !rawRows.length) {
      return respond({ error: "presets_required" }, 400);
    }
    if (rawRows.length > MAX_ROWS) {
      return respond({ error: "preset_limit" }, 400);
    }

    const seen = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const [index, raw] of rawRows.entries()) {
      const item = raw && typeof raw === "object"
        ? raw as Record<string, unknown>
        : {};
      const row = Number(item.rowNumber) || index + 2;
      const origin = clean(item.origin);
      const destination = clean(item.destination);
      const outboundFare = integerFare(item.outboundFare ?? item.outbound_fare);
      const returnFare = integerFare(item.returnFare ?? item.return_fare);
      const key = routeKey(origin, destination);
      if (!origin || !destination) {
        errors.push({ row, reason: "route_required" });
      } else if (
        origin.toLocaleLowerCase("ko-KR") ===
          destination.toLocaleLowerCase("ko-KR")
      ) errors.push({ row, reason: "route_must_differ" });
      else if (outboundFare === null || returnFare === null) {
        errors.push({ row, reason: "fare_invalid" });
      } else if (!outboundFare && !returnFare) {
        errors.push({ row, reason: "fare_required" });
      } else if (seen.has(key)) errors.push({ row, reason: "duplicate_route" });
      else {
        seen.add(key);
        rows.push({
          origin,
          destination,
          outbound_fare: outboundFare,
          return_fare: returnFare,
          updated_at: new Date().toISOString(),
          updated_by: caller.id,
        });
      }
    }
    if (errors.length) {
      return respond({
        error: "validation_failed",
        details: errors.slice(0, 30),
      }, 400);
    }

    const { data: existing, error: existingError } = await adminClient.from(
      "travel_fare_catalog",
    ).select("id,origin,destination");
    if (existingError) return respond({ error: "catalog_read_failed" }, 500);
    const existingByRoute = new Map(
      (existing || []).map((
        item,
      ) => [routeKey(item.origin, item.destination), item]),
    );
    const upsertRows = rows.map((item) => {
      const existingRow = existingByRoute.get(
        routeKey(String(item.origin), String(item.destination)),
      );
      return existingRow
        ? {
          ...item,
          id: existingRow.id,
          origin: existingRow.origin,
          destination: existingRow.destination,
        }
        : item;
    });
    const { error: upsertError } = await adminClient.from("travel_fare_catalog")
      .upsert(upsertRows, { onConflict: "origin,destination" });
    if (upsertError) return respond({ error: "catalog_write_failed" }, 500);

    const created = rows.filter((item) =>
      !existingByRoute.has(
        routeKey(String(item.origin), String(item.destination)),
      )
    ).length;
    return respond({
      ok: true,
      total: rows.length,
      created,
      updated: rows.length - created,
      removed: 0,
    });
  } catch {
    return respond({ error: "invalid_request" }, 400);
  }
});
