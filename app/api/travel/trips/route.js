import { NextResponse } from "next/server";
import { calculateTripExpense, tripRouteValidationError } from "@/lib/travel-rules";
import { getSupabaseUser } from "@/lib/supabase/server";

const SOURCE_BUCKET = "travel-sources";
const MAX_SOURCE_FILE_SIZE = 4 * 1024 * 1024;
const VALID_TRANSPORT_TYPES = new Set(["public", "personal", "corporate"]);
const SOURCE_ROLES = {
  approvedPdf: { fallbackName: "approved.pdf", contentType: "application/pdf" },
  sourceHwpx: { fallbackName: "source.hwpx", contentType: "application/vnd.hancom.hwpx" },
};

function summary(trip, expense, updatedAt, sourceObjectKey = null) {
  return {
    id: trip.id,
    status: "saved",
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
  };
}

function validFare(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 10_000_000 ? number : null;
}

// travel_trips.id는 uuid 컬럼이고 화면도 crypto.randomUUID()로만 id를 만든다.
// 형식을 여기서 맞춰 두어야 잘못된 값이 400으로 걸리고 DB까지 내려가 500이 되지 않는다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validTripId(value) {
  const id = String(value || "").trim();
  return UUID_PATTERN.test(id) ? id : "";
}

function fileValue(value) {
  return value instanceof File && value.size > 0 ? value : null;
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

function validateSourceFile(file, role) {
  if (!file) return "";
  if (file.size > MAX_SOURCE_FILE_SIZE) return `${file.name || "원본 파일"}이 4MB를 넘습니다.`;
  const filename = String(file.name || "").toLowerCase();
  if (role === "approvedPdf" && file.type !== "application/pdf" && !filename.endsWith(".pdf")) {
    return "승인 증빙 파일은 PDF 형식으로 올려주세요.";
  }
  if (role === "sourceHwpx" && !filename.endsWith(".hwpx")) {
    return "원본 문서는 HWPX 형식으로 올려주세요.";
  }
  return "";
}

async function uploadSource(client, file, role, prefix) {
  const definition = SOURCE_ROLES[role];
  const filename = safeFilename(file.name, definition.fallbackName);
  // Browsers report several vendor-specific MIME values for HWPX. Store the
  // canonical type so the private bucket allowlist behaves consistently.
  const contentType = definition.contentType;
  const objectKey = `${prefix}${role}-${crypto.randomUUID()}-${filename}`;
  const { error } = await client.storage.from(SOURCE_BUCKET).upload(objectKey, file, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(role === "approvedPdf"
    ? "승인 PDF를 저장하지 못했습니다."
    : "HWPX 원본을 저장하지 못했습니다.");
  return { objectKey, filename, contentType };
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
    .limit(20);
  if (error) return NextResponse.json({ error: "출장 목록을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    trips: (data || []).map((row) => {
      const participantCount = Math.max(1, row.payload_json?.participants?.length || 1);
      const { payload_json, ...rest } = row;
      return { ...rest, participant_count: participantCount };
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

  const tripId = validTripId(trip.id);
  if (!tripId) return NextResponse.json({ error: "출장 문서 ID가 올바르지 않습니다." }, { status: 400 });
  trip.id = tripId;
  delete trip.parsedText;
  if (!VALID_TRANSPORT_TYPES.has(trip.transportType)) {
    return NextResponse.json({ error: "교통수단을 대중교통, 개인차 또는 법인차 중에서 선택해 주세요." }, { status: 400 });
  }

  const outbound = validFare(trip.outboundTransportActual);
  const returning = validFare(trip.returnTransportActual);
  if (outbound === null || returning === null) {
    return NextResponse.json({ error: "방향별 운임은 0원 이상 1,000만 원 이하의 숫자로 입력해 주세요." }, { status: 400 });
  }
  trip.outboundTransportActual = outbound;
  trip.returnTransportActual = returning;
  trip.transportActual = outbound + returning;
  const routeError = tripRouteValidationError(trip);
  if (routeError) return NextResponse.json({ error: routeError }, { status: 400 });
  const expense = calculateTripExpense(trip);
  trip.expense = expense;

  const approvedPdf = fileValue(form.get("approvedPdf")) || fileValue(form.get("file"));
  const sourceHwpx = fileValue(form.get("sourceHwpx"));
  const pdfError = validateSourceFile(approvedPdf, "approvedPdf");
  const hwpxError = validateSourceFile(sourceHwpx, "sourceHwpx");
  if (pdfError || hwpxError) return NextResponse.json({ error: pdfError || hwpxError }, { status: 400 });
  if ((approvedPdf?.size || 0) + (sourceHwpx?.size || 0) > MAX_SOURCE_FILE_SIZE) {
    return NextResponse.json({ error: "PDF와 HWPX 파일 크기 합계는 4MB 이하여야 합니다." }, { status: 400 });
  }

  const prefix = sourcePrefix(user.id, tripId);
  const { data: existing, error: existingError } = await client
    .from("travel_trips")
    .select("source_object_key,payload_json")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "기존 출장 서류를 확인하지 못했습니다." }, { status: 500 });

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
  const uploadedKeys = [];
  try {
    if (approvedPdf) {
      nextDocuments.approvedPdf = await uploadSource(client, approvedPdf, "approvedPdf", prefix);
      uploadedKeys.push(nextDocuments.approvedPdf.objectKey);
    }
    if (sourceHwpx) {
      nextDocuments.sourceHwpx = await uploadSource(client, sourceHwpx, "sourceHwpx", prefix);
      uploadedKeys.push(nextDocuments.sourceHwpx.objectKey);
    }
  } catch (error) {
    await removeSources(client, uploadedKeys);
    return NextResponse.json({ error: error instanceof Error ? error.message : "원본 파일을 저장하지 못했습니다." }, { status: 500 });
  }

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
  const row = {
    id: tripId,
    user_id: user.id,
    status: "saved",
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
    source_object_key: sourceObjectKey,
    payload_json: trip,
    updated_at: now,
  };
  const { error } = await client.from("travel_trips").upsert(row, { onConflict: "id" });
  if (error) {
    await removeSources(client, uploadedKeys);
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
    trip: summary(trip, expense, now, sourceObjectKey),
    duplicateWarnings: [],
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
