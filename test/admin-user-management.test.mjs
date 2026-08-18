import test from "node:test";
import assert from "node:assert/strict";
import {
  isProtectedAdmin,
  managedUserView,
  validateManagedUserInput,
} from "../supabase/functions/_shared/admin-user-management.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function authUser(overrides = {}) {
  return {
    id: USER_ID,
    email: "employee@example.com",
    created_at: "2026-08-18T00:00:00.000Z",
    last_sign_in_at: null,
    email_confirmed_at: "2026-08-18T00:00:00.000Z",
    app_metadata: {},
    user_metadata: { full_name: "홍길동", department: "기획팀" },
    ...overrides,
  };
}

test("직원 수정값은 공백과 이메일 대소문자를 정규화한다", () => {
  assert.deepEqual(
    validateManagedUserInput({
      id: USER_ID,
      email: " Employee@Example.COM ",
      fullName: " 홍  길동 ",
      password: "",
    }),
    {
      ok: true,
      value: {
        id: USER_ID,
        email: "employee@example.com",
        fullName: "홍 길동",
        password: "",
      },
    },
  );
});

test("새 비밀번호는 비워 둘 수 있지만 입력하면 8자 이상이어야 한다", () => {
  assert.equal(validateManagedUserInput({
    id: USER_ID,
    email: "employee@example.com",
    fullName: "홍길동",
    password: "",
  }).ok, true);
  assert.deepEqual(validateManagedUserInput({
    id: USER_ID,
    email: "employee@example.com",
    fullName: "홍길동",
    password: "short",
  }), { ok: false, error: "password_min_8" });
});

test("관리자 역할과 관리자 이메일 allowlist 계정은 보호한다", () => {
  assert.equal(isProtectedAdmin(authUser({ app_metadata: { role: "admin" } }), new Set()), true);
  assert.equal(isProtectedAdmin(authUser({ app_metadata: { roles: ["super_admin"] } }), new Set()), true);
  assert.equal(isProtectedAdmin(authUser({ email: "boss@example.com" }), new Set(["boss@example.com"])), true);
  assert.equal(isProtectedAdmin(authUser(), new Set()), false);
});

test("브라우저에는 계정 편집에 필요한 안전한 필드만 전달한다", () => {
  const view = managedUserView(authUser(), USER_ID, new Set());
  assert.deepEqual(Object.keys(view).sort(), [
    "createdAt",
    "email",
    "emailConfirmed",
    "fullName",
    "id",
    "isCurrentUser",
    "isProtectedAdmin",
    "lastSignInAt",
  ].sort());
  assert.equal(view.isCurrentUser, true);
  assert.equal("app_metadata" in view, false);
  assert.equal("user_metadata" in view, false);
});
