import { NextResponse } from "next/server";
import {
  calculateTripExpense,
  tripDateValidationError,
  tripRequiredInformationValidationError,
  tripRouteValidationError,
} from "@/lib/travel-rules";
import { getSupabaseUser } from "@/lib/supabase/server";
import { isTravelRecordCompleted, safeTravelTimestamp, TRAVEL_RECORD_STATUS } from "@/lib/travel-ledger";

const SOURCE_BUCKET = "travel-sources";
const VALID_TRANSPORT_TYPES = new Set(["public", "personal", "corporate"]);
const SOURCE_ROLES = {
  approvedPdf: { fallbackName: "approved.pdf", contentType: "application/pdf" },
  sourceHwpx: { fallbackName: "source.hwpx", contentType: "application/vnd.hancom.hwpx" },
};

function summary(trip, expense, updatedAt, sourceObjectKey = null, status = TRAVEL_RECORD_STATUS.completed) {
  return {
    id: trip.id,
    status,
    document_number: trip.documentNumber || null,
    department: trip.department || null,
    employee_name: trip.employeeName || null,
    purpose: trip.purpose || null,
    destination: trip.destination || null,
    start_at: trip.startAt || null,
    end_at: trip.endAt || null,
    transport_type: trip.transportType || null,
    project_type: trip.projectType || null,
    total_amount: expense.total || 0,
    updated_at: updatedAt,
    participant_count: Array.isArray(trip.participants) ? trip.participants.length : 1,
    source_object_key: sourceObjectKey,
    payload: clientPayload(trip),
  };
}

function clientPayload(trip) {
  if (!trip || typeof trip !== "object" || Array.isArray(trip)) return null;
  const payload = { ...trip };
  delete payload.parsedText;
  delete payload.sourceDocuments;
  return payload;
}

function validFare(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 10_000_000 ? number : null;
}

// travel_trips.id는 uuid 컬럼이고 화면도 crypto.randomUUID()로만 id를 만든다.
// 형식을 여기서 맞춰 두어야 잘못된 값이 400으로 걸리고 DB까지 내려가 500이 되지 않는다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 출장자별 숙박비·감액은 계산에 그대로 들어가지만 지금까지 검사 없이 통과했다.
// 숫자로 읽히지 않으면 계산기가 0원으로 바꿔 버리므로, 저장 단계에서 막는다.
function participantAmountValidationError(trip) {
  const participants = Array.isArray(trip?.participants) && trip.participants.length
    ? trip.participants
    : [{ employeeName: trip?.employeeName, lodgingActual: trip?.lodgingActual, deduction: trip?.deduction }];

  for (let index = 0; index < participants.length; index += 1) {
    const participant = participants[index] || {};
    const who = String(participant.employeeName || "").trim() || `${index + 1}번째 출장자`;
    const fields = [
      ["숙박 실제 소요액", participant.lodgingActual ?? (index === 0 ? trip?.lodgingActual : 0)],
      ["기타 감액", participant.deduction ?? (index === 0 ? trip?.deduction : 0)],
    ];
    for (const [label, value] of fields) {
      if (value === undefined || value === null || value === "") continue;
      if (validFare(value) === null) {
        return `${who}의 ${label}은 0원 이상 1,000만 원 이하의 숫자로 입력해 주세요.`;
      }
    }
  }
  return "";
}

function validTripId(value) {
  const id = String(value || "").trim();
  return UUID_PATTERN.test(id) ? id : "";
}

function safeFilename(value, fallback) {
  const filename = String(value || fallback)
    .normalize("NFKC")
    .replace(/[^0-9A-Za-z가-힣._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
  return filename || fallback;
}

function sourcePrefix(userId, tripId) {
  return `travel/${userId}/${tripId}/`;
}

function isOwnedSourceKey(value, prefix) {
  return typeof value === "string" && value.startsWith(prefix) && value.length > prefix.length;
}

function sourceDescriptor(value, prefix) {
  if (!value || typeof value !== "object" || !isOwnedSourceKey(value.objectKey, prefix)) return null;
  return {
    objectKey: value.objectKey,
    filename: safeFilename(value.filename || value.objectKey.split("/").at(-1), "source"),
    contentType: String(value.contentType || "application/octet-stream").slice(0, 120),
  };
}

function storedSourceDocuments(payload, representativeKey, prefix) {
  const stored = payload && typeof payload === "object" && payload.sourceDocuments && typeof payload.sourceDocuments === "object"
    ? payload.sourceDocuments
    : {};
  const documents = {
    approvedPdf: sourceDescriptor(stored.approvedPdf, prefix),
    sourceHwpx: sourceDescriptor(stored.sourceHwpx, prefix),
    cleanupPending: Array.isArray(stored.cleanupPending)
      ? [...new Set(stored.cleanupPending.filter((key) => isOwnedSourceKey(key, prefix)))]
      : [],
  };

  if (representativeKey) {
    if (!isOwnedSourceKey(representativeKey, prefix)) {
      throw new Error("기존 원본 파일의 저장 경로를 확인하지 못했습니다.");
    }
    const alreadyKnown = documents.approvedPdf?.objectKey === representativeKey
      || documents.sourceHwpx?.objectKey === representativeKey;
    if (!alreadyKnown && representativeKey.toLowerCase().endsWith(".hwpx")) {
      documents.sourceHwpx = {
        objectKey: representativeKey,
        filename: safeFilename(representativeKey.split("/").at(-1), SOURCE_ROLES.sourceHwpx.fallbackName),
        contentType: SOURCE_ROLES.sourceHwpx.contentType,
      };
    } else if (!alreadyKnown) {
      documents.approvedPdf = {
        objectKey: representativeKey,
        filename: safeFilename(representativeKey.split("/").at(-1), SOURCE_ROLES.approvedPdf.fallbackName),
        contentType: SOURCE_ROLES.approvedPdf.contentType,
      };
    }
  }
  return documents;
}

function documentKeys(documents) {
  return [...new Set([
    documents.approvedPdf?.objectKey,
    documents.sourceHwpx?.objectKey,
    ...(documents.cleanupPending || []),
  ].filter(Boolean))];
}

async function removeSources(client, keys) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!uniqueKeys.length) return null;
  const { error } = await client.storage.from(SOURCE_BUCKET).remove(uniqueKeys);
  return error || null;
}

async function listSourceKeys(client, prefix) {
  const path = prefix.replace(/\/$/, "");
  const keys = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const { data, error } = await client.storage.from(SOURCE_BUCKET).list(path, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) return { keys, error };
    const objects = (data || []).filter((item) => item?.name && item.id);
    keys.push(...objects.map((item) => `${path}/${item.name}`));
    if ((data || []).length < 100) break;
  }
  return { keys, error: null };
}

export async function GET() {
  const { client, user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await client
    .from("travel_trips")
    .select("id,status,document_number,department,employee_name,purpose,destination,start_at,end_at,transport_type,project_type,total_amount,updated_at,payload_json")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "출장 목록을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    trips: (data || []).map((row) => {
      const participantCount = Math.max(1, row.payload_json?.participants?.length || 1);
      const { payload_json, ...rest } = row;
      return { ...rest, participant_count: participantCount, payload: clientPayload(payload_json) };
    }),
  });
}

export async function POST(request) {
  const { client, user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const form = await request.formData();
  let trip;
  try {
    trip = JSON.parse(String(form.get("trip") || "{}"));
  } catch {
    return NextResponse.json({ error: "출장 데이터 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!trip || typeof trip !== "object" || Array.isArray(trip)) {
    return NextResponse.json({ error: "출장 데이터 형식이 올바르지 않습니다." }, { status: 400 });
  }

  let tripId = validTripId(trip.id);
  if (!tripId) return NextResponse.json({ error: "출장 문서 ID가 올바르지 않습니다." }, { status: 400 });
  trip.id = tripId;
  delete trip.parsedText;
  const registerApproved = String(form.get("intent") || "") === "register-approved";

  let expense = { total: 0 };
  if (!registerApproved) {
    if (!VALID_TRANSPORT_TYPES.has(trip.transportType)) {
      return NextResponse.json({ error: "교통수단을 대중교통, 개인차 또는 법인차 중에서 선택해 주세요." }, { status: 400 });
    }
    const requiredInformationError = tripRequiredInformationValidationError(trip);
    if (requiredInformationError) {
      return NextResponse.json({ error: requiredInformationError }, { status: 400 });
    }
    const dateError = tripDateValidationError(trip.startAt, trip.endAt);
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const outbound = validFare(trip.outboundTransportActual);
    const returning = validFare(trip.returnTransportActual);
    if (outbound === null || returning === null) {
      return NextResponse.json({ error: "방향별 운임은 0원 이상 1,000만 원 이하의 숫자로 입력해 주세요." }, { status: 400 });
    }
    trip.outboundTransportActual = outbound;
    trip.returnTransportActual = returning;
    trip.transportActual = outbound + returning;
    const participantAmountError = participantAmountValidationError(trip);
    if (participantAmountError) return NextResponse.json({ error: participantAmountError }, { status: 400 });
    const routeError = tripRouteValidationError(trip);
    if (routeError) return NextResponse.json({ error: routeError }, { status: 400 });
    expense = calculateTripExpense(trip);
    trip.expense = expense;
  }

  let { data: existing, error: existingError } = await client
    .from("travel_trips")
    .select("id,status,total_amount,source_object_key,payload_json")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "기존 출장 서류를 확인하지 못했습니다." }, { status: 500 });

  if (registerApproved && !existing && String(trip.documentNumber || "").trim()) {
    const duplicateLookup = await client
      .from("travel_trips")
      .select("id,status,total_amount,source_object_key,payload_json")
      .eq("user_id", user.id)
      .eq("document_number", String(trip.documentNumber).trim())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (duplicateLookup.error) return NextResponse.json({ error: "같은 승인 출장 기록을 확인하지 못했습니다." }, { status: 500 });
    if (duplicateLookup.data) {
      existing = duplicateLookup.data;
      tripId = existing.id;
      trip.id = tripId;
    }
  }

  const alreadyCompleted = isTravelRecordCompleted(existing);
  if (registerApproved && alreadyCompleted && existing?.payload_json) {
    trip = { ...trip, ...existing.payload_json, id: tripId };
    expense = trip.expense && typeof trip.expense === "object"
      ? trip.expense
      : { total: Number(existing.total_amount) || 0 };
  }

  const prefix = sourcePrefix(user.id, tripId);
  let previousDocuments;
  try {
    previousDocuments = storedSourceDocuments(existing?.payload_json, existing?.source_object_key, prefix);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "기존 원본 저장 경로를 확인하지 못했습니다." }, { status: 500 });
  }

  const nextDocuments = {
    approvedPdf: previousDocuments.approvedPdf,
    sourceHwpx: previousDocuments.sourceHwpx,
    cleanupPending: [...previousDocuments.cleanupPending],
  };

  const activeKeys = new Set([
    nextDocuments.approvedPdf?.objectKey,
    nextDocuments.sourceHwpx?.objectKey,
  ].filter(Boolean));
  nextDocuments.cleanupPending = [...new Set([
    ...nextDocuments.cleanupPending,
    ...documentKeys(previousDocuments).filter((key) => !activeKeys.has(key)),
  ])].filter((key) => isOwnedSourceKey(key, prefix));
  trip.sourceDocuments = nextDocuments;

  const sourceObjectKey = nextDocuments.approvedPdf?.objectKey
    || nextDocuments.sourceHwpx?.objectKey
    || null;
  const now = new Date().toISOString();
  const status = registerApproved && !alreadyCompleted
    ? TRAVEL_RECORD_STATUS.approved
    : TRAVEL_RECORD_STATUS.completed;
  const row = {
    id: tripId,
    user_id: user.id,
    status,
    document_number: trip.documentNumber || null,
    department: trip.department || null,
    employee_name: trip.employeeName || null,
    purpose: trip.purpose || null,
    destination: trip.destination || null,
    start_at: safeTravelTimestamp(trip.startAt),
    end_at: safeTravelTimestamp(trip.endAt),
    transport_type: trip.transportType || null,
    project_type: trip.projectType || null,
    total_amount: expense.total || 0,
    source_object_key: sourceObjectKey,
    payload_json: trip,
    updated_at: now,
  };
  const { error } = await client.from("travel_trips").upsert(row, { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: "출장 서류를 저장하지 못했습니다." }, { status: 500 });
  }

  let sourceCleanupWarning = "";
  if (nextDocuments.cleanupPending.length) {
    const cleanupError = await removeSources(client, nextDocuments.cleanupPending);
    if (cleanupError) {
      sourceCleanupWarning = "교체한 기존 원본 파일 정리가 예약되었습니다.";
    } else {
      nextDocuments.cleanupPending = [];
      trip.sourceDocuments = nextDocuments;
      await client
        .from("travel_trips")
        .update({ payload_json: trip })
        .eq("id", tripId)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    trip: summary(trip, expense, now, sourceObjectKey, status),
    duplicateWarnings: [],
    registeredApproved: registerApproved,
    alreadyCompleted,
    ...(sourceCleanupWarning ? { sourceCleanupWarning } : {}),
  });
}

export async function DELETE(request) {
  const { client, user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const id = validTripId(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "출장 문서 ID가 올바르지 않습니다." }, { status: 400 });

  const { data: row, error: lookupError } = await client
    .from("travel_trips")
    .select("source_object_key,payload_json")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError || !row) return NextResponse.json({ error: "출장 서류를 찾을 수 없습니다." }, { status: 404 });

  const prefix = sourcePrefix(user.id, id);
  let documents;
  try {
    documents = storedSourceDocuments(row.payload_json, row.source_object_key, prefix);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "원본 저장 경로를 확인하지 못했습니다." }, { status: 500 });
  }

  const listedSources = await listSourceKeys(client, prefix);
  if (listedSources.error) console.warn("travel-source-list", listedSources.error.message || "failed");
  const cleanupError = await removeSources(client, [
    ...documentKeys(documents),
    ...listedSources.keys.filter((key) => isOwnedSourceKey(key, prefix)),
  ]);
  if (cleanupError) {
    return NextResponse.json({ error: "원본 파일을 정리하지 못해 삭제를 중단했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  const { error } = await client.from("travel_trips").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "출장 서류를 삭제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deleted: true, deletedId: id, id });
}
