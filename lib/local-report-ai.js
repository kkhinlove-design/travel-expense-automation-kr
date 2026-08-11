import { tripRoutePoints } from "./travel-rules.js";
import { LOCAL_AI_CONFIG } from "../config/local-ai.js";

export const LOCAL_REPORT_MODEL_ID = LOCAL_AI_CONFIG.webLlmModelId;
export const OLLAMA_BASE_URL = LOCAL_AI_CONFIG.ollamaBaseUrl;

let localEngine = null;
let localEnginePromise = null;
let activeProgressCallback = null;

function cleanValue(value, fallback = "확인 필요") {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function tripDateRange(trip) {
  const start = String(trip.startAt ?? "").replace("T", " ").trim();
  const end = String(trip.endAt ?? "").replace("T", " ").trim();
  if (start && end) return `${start} ~ ${end}`;
  return start || end || "확인 필요";
}

function memoLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•○]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function participantSummary(trip) {
  const participants = Array.isArray(trip.participants) && trip.participants.length
    ? trip.participants
    : [{ employeeName: trip.employeeName, department: trip.department, position: trip.position }];
  return participants
    .map((participant) => `${cleanValue(participant.employeeName)} (${cleanValue(participant.department)} / ${cleanValue(participant.position)})`)
    .join(", ");
}

function routeSummary(trip) {
  return tripRoutePoints(trip).map((value) => cleanValue(value)).join(" → ") || "교통 경로 확인 필요";
}

export function buildRuleBasedTravelReport(trip) {
  const notes = memoLines(trip.reportNotes);
  const detailLines = notes.length
    ? notes.map((line) => `- ${line}`)
    : ["- 실제 수행 내용 입력 필요 (확인 필요)"];

  return [
    "○ 출장 개요",
    `- 교통 경로: ${routeSummary(trip)}`,
    `- 방문기관/출장지: ${cleanValue(trip.destination, "출장지 확인 필요")}`,
    `- ${cleanValue(trip.purpose, "출장 목적 확인 필요")}을(를) 수행함.`,
    `- 출장 일시: ${tripDateRange(trip)}`,
    "○ 주요 수행 내용",
    ...detailLines,
    "○ 협의·확인 결과",
    "- 주요 협의 또는 확인 결과 입력 필요 (확인 필요)",
    "○ 후속 조치",
    "- 후속 조치 및 내부 공유 사항 입력 필요 (확인 필요)",
  ].join("\n");
}

export function buildTravelReportMessages(trip) {
  const notes = memoLines(trip.reportNotes);
  const facts = [
    `출장자: ${participantSummary(trip)}`,
    `출장 일시: ${tripDateRange(trip)}`,
    `교통 경로: ${routeSummary(trip)}`,
    `출장지(방문기관): ${cleanValue(trip.destination)}`,
    `출장 목적: ${cleanValue(trip.purpose)}`,
    `실제 수행 결과 메모:\n${notes.length ? notes.map((line) => `- ${line}`).join("\n") : "- 메모 없음"}`,
  ].join("\n");

  return [
    {
      role: "system",
      content: [
        "당신은 대한민국 공공기관의 출장복명서 초안을 작성하는 행정 문서 보조자입니다.",
        "반드시 사용자가 제공한 사실만 사용하고 기관명, 인명, 수치, 성과, 합의 내용을 추측하거나 새로 만들지 마세요.",
        "정보가 부족한 항목은 '(확인 필요)'라고 명시하세요.",
        "한국어 행정문서체로 간결하게 쓰고, 인사말·서명·작성일·마크다운 코드블록은 넣지 마세요.",
        "형식은 '○ 출장 개요', '○ 주요 수행 내용', '○ 협의·확인 결과', '○ 후속 조치' 순서로 작성하세요.",
        "각 항목은 '-'로 시작하는 문장으로 쓰며 전체 8~14줄 이내로 작성하세요.",
      ].join(" "),
    },
    {
      role: "user",
      content: `다음 사실을 근거로 출장복명서의 '출장내용'에 들어갈 본문만 작성하세요.\n\n${facts}`,
    },
  ];
}

export function supportsLocalReportAI() {
  return typeof window !== "undefined"
    && window.isSecureContext
    && typeof navigator !== "undefined"
    && Boolean(navigator.gpu);
}

async function fetchOllama(path, init = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}${path}`, {
      ...init,
      mode: "cors",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama 응답 오류 (${response.status})`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Ollama 응답 시간이 초과되었습니다.");
    }
    if (error instanceof TypeError) {
      throw new Error("내 PC의 Ollama에 연결할 수 없습니다. Ollama 실행 상태와 사이트 허용 설정을 확인해 주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function choosePreferredOllamaModel(models = []) {
  const names = models.map((model) => typeof model === "string" ? model : model?.name).filter(Boolean);
  return names.find((name) => /qwen/i.test(name)) || names[0] || "";
}

export async function listOllamaModels() {
  const payload = await fetchOllama("/api/tags");
  const models = Array.isArray(payload?.models)
    ? payload.models.map((model) => ({
        name: model.name || model.model,
        size: Number(model.size) || 0,
        parameterSize: model.details?.parameter_size || "",
      })).filter((model) => model.name)
    : [];
  if (!models.length) {
    throw new Error("Ollama에 설치된 모델이 없습니다.");
  }
  return models;
}

function sanitizeDraft(content) {
  const cleaned = String(content ?? "")
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:출장복명서|출장내용)\s*[:：]?\s*/i, "")
    .trim()
    .slice(0, 2_000);

  if (!cleaned) throw new Error("로컬 AI가 빈 초안을 반환했습니다.");
  return cleaned;
}

async function getLocalEngine(onProgress) {
  activeProgressCallback = onProgress;
  if (localEngine) {
    onProgress?.({ progress: 1, text: "로컬 모델 준비 완료" });
    return localEngine;
  }

  if (!localEnginePromise) {
    localEnginePromise = import("@mlc-ai/web-llm")
      .then(({ CreateMLCEngine }) => CreateMLCEngine(LOCAL_REPORT_MODEL_ID, {
        initProgressCallback(progress) {
          activeProgressCallback?.(progress);
        },
      }))
      .then((engine) => {
        localEngine = engine;
        return engine;
      })
      .catch((error) => {
        localEnginePromise = null;
        throw error;
      });
  }

  return localEnginePromise;
}

export async function draftTravelReportWithOllama(trip, { model, onProgress } = {}) {
  if (!model) throw new Error("사용할 Ollama 모델을 선택해 주세요.");
  onProgress?.({ progress: 0.35, text: `${model}로 복명서 작성 중` });
  const reply = await fetchOllama("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: buildTravelReportMessages(trip),
      stream: false,
      options: {
        temperature: 0.2,
        top_p: 0.85,
        repeat_penalty: 1.05,
        num_predict: 520,
      },
    }),
  }, 120_000);
  onProgress?.({ progress: 1, text: `${model} 초안 작성 완료` });
  return {
    content: sanitizeDraft(reply?.message?.content),
    model,
    provider: "ollama",
  };
}

export async function draftTravelReportLocally(trip, { onProgress } = {}) {
  if (!supportsLocalReportAI()) {
    throw new Error("이 브라우저에서는 WebGPU 로컬 AI를 사용할 수 없습니다.");
  }

  const engine = await getLocalEngine(onProgress);
  onProgress?.({ progress: 1, text: "출장복명서 초안 작성 중" });
  const reply = await engine.chat.completions.create({
    messages: buildTravelReportMessages(trip),
    temperature: 0.2,
    top_p: 0.85,
    repetition_penalty: 1.05,
    max_tokens: 520,
  });

  return {
    content: sanitizeDraft(reply.choices?.[0]?.message?.content),
    model: LOCAL_REPORT_MODEL_ID,
  };
}
