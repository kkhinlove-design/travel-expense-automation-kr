// 관리자 Function은 앱 화면에서만 호출한다.
// Function secret `ALLOWED_ORIGINS`에 배포 주소를 넣으면 그 목록만 허용하고,
// 비워 두면 기존 동작(모든 오리진 허용)을 유지해 기존 배포가 깨지지 않는다.
const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function allowedOrigins() {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(/[;,\s]+/)
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const allowlist = allowedOrigins();
  if (!allowlist.length) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": "*" };
  }

  const requestOrigin = (request.headers.get("origin") ?? "").replace(/\/$/, "");
  const allowed = allowlist.includes(requestOrigin) ? requestOrigin : allowlist[0];
  return {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": allowed,
    // 오리진마다 응답이 달라지므로 캐시가 섞이지 않도록 알린다.
    Vary: "Origin",
  };
}
