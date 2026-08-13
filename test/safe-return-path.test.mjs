import assert from "node:assert/strict";
import test from "node:test";
import { safeRelativeReturnPath } from "../lib/safe-return-path.js";

test("keeps a same-site path with its query and hash", () => {
  assert.equal(safeRelativeReturnPath("/travel?tab=list#top"), "/travel?tab=list#top");
});

test("rejects paths that browsers resolve to another host", () => {
  // 두 값 모두 "/"로 시작하지만 실제로는 외부 호스트로 해석된다.
  assert.equal(safeRelativeReturnPath("//evil.example"), "/");
  assert.equal(safeRelativeReturnPath("/\\evil.example"), "/");
  assert.equal(safeRelativeReturnPath("https://evil.example/travel"), "/");
  assert.equal(safeRelativeReturnPath("javascript:alert(1)"), "/");
});

test("falls back for values that are not usable paths", () => {
  assert.equal(safeRelativeReturnPath(undefined, { fallback: "/travel" }), "/travel");
  assert.equal(safeRelativeReturnPath("travel", { fallback: "/travel" }), "/travel");
});

test("blocks auth screens by default so sign-in does not loop", () => {
  assert.equal(safeRelativeReturnPath("/signin", { fallback: "/travel" }), "/travel");
  assert.equal(safeRelativeReturnPath("/auth/signout", { fallback: "/travel" }), "/travel");
});

test("allows the reset callback to return to the sign-in screen", () => {
  assert.equal(
    safeRelativeReturnPath("/signin?mode=reset", { fallback: "/travel", allowAuthPaths: true }),
    "/signin?mode=reset",
  );
});

test("still rejects external hosts when auth paths are allowed", () => {
  assert.equal(
    safeRelativeReturnPath("//evil.example/signin", { fallback: "/travel", allowAuthPaths: true }),
    "/travel",
  );
});
