// 로그인·로그아웃·인증 콜백이 모두 같은 판정을 쓰도록 모아 둔 리다이렉트 검증기.
// 서버 전용 모듈을 가져오지 않으므로 클라이언트 컴포넌트에서도 그대로 쓸 수 있다.

export const SIGN_IN_PATH = "/signin";
export const SIGN_OUT_PATH = "/auth/signout";
export const CALLBACK_PATH = "/auth/callback";

const BASE_ORIGIN = "https://app.local";

function isReservedAuthPath(pathname) {
  return pathname === SIGN_IN_PATH || pathname === SIGN_OUT_PATH || pathname === CALLBACK_PATH;
}

/**
 * 같은 사이트 안의 경로만 통과시킨다.
 * `//evil.example`이나 `/\evil.example`처럼 슬래시로 시작하지만 실제로는
 * 외부 호스트로 해석되는 값을 기준 origin과 대조해서 걸러낸다.
 *
 * @param {unknown} value 검사할 return_to 값
 * @param {object} [options]
 * @param {string} [options.fallback] 검증에 실패했을 때 돌려줄 경로
 * @param {boolean} [options.allowAuthPaths]
 *   비밀번호 재설정 콜백처럼 `/signin`으로 되돌려 보내야 하는 경우에만 true.
 *   기본값(false)은 로그인 직후 다시 로그인 화면으로 가는 순환을 막는다.
 */
export function safeRelativeReturnPath(value, options = {}) {
  const { fallback = "/", allowAuthPaths = false } = options;
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  let url;
  try {
    url = new URL(value, BASE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE_ORIGIN) return fallback;
  if (!allowAuthPaths && isReservedAuthPath(url.pathname)) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
