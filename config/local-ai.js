function withoutTrailingSlash(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, "");
}

export const LOCAL_AI_CONFIG = Object.freeze({
  ollamaBaseUrl: withoutTrailingSlash(process.env.NEXT_PUBLIC_OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
  webLlmModelId: String(process.env.NEXT_PUBLIC_WEB_LLM_MODEL_ID || "Qwen2.5-1.5B-Instruct-q4f16_1-MLC").trim(),
  ollamaPullModel: String(process.env.NEXT_PUBLIC_OLLAMA_PULL_MODEL || "qwen2.5:7b").trim(),
});
