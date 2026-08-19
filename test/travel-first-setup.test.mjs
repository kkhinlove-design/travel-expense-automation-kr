import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homePage, travelPage, accountPage, accountForm] = await Promise.all([
  readFile(new URL("../app/page.js", import.meta.url), "utf8"),
  readFile(new URL("../app/travel/page.js", import.meta.url), "utf8"),
  readFile(new URL("../app/account/page.js", import.meta.url), "utf8"),
  readFile(new URL("../app/account/account-password-form.js", import.meta.url), "utf8"),
]);

test("환경설정이 완료되지 않은 로그인 사용자는 출장 화면보다 설정 화면을 먼저 본다", () => {
  assert.match(homePage, /!preference\.error && !preference\.configured/);
  assert.match(travelPage, /!preference\.error && !preference\.configured/);
  assert.match(homePage, /\/account\?setup=1&return_to=%2Ftravel/);
  assert.match(travelPage, /\/account\?setup=1&return_to=%2Ftravel/);
});

test("첫 설정 화면은 기준지와 결재라인 저장 후 안전한 출장 경로로 이동한다", () => {
  assert.match(accountPage, /safeRelativeReturnPath/);
  assert.match(accountPage, /setupRequired=/);
  assert.match(accountForm, /첫 사용 환경 설정/);
  assert.match(accountForm, /저장하고 출장 시작/);
  assert.match(accountForm, /window\.location\.assign\(returnTo \|\| ["']\/travel["']\)/);
});

test("기준지 선택지는 지역명만 표시하고 사무소 접미사를 붙이지 않는다", () => {
  assert.match(accountForm, />\{origin\}<\/option>/);
  assert.doesNotMatch(accountForm, />\{origin\} 사무소<\/option>/);
});
