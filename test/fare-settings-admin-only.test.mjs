import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workspaceSource, adminSource, routeSource, googleSourceRoute] = await Promise.all([
  readFile(new URL("../app/travel/travel-workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/page.js", import.meta.url), "utf8"),
  readFile(new URL("../app/api/travel/fare-presets/route.js", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/fare-source/route.js", import.meta.url), "utf8"),
]);

test("직원 출장 화면에서는 운임 설정 메뉴와 편집 화면을 노출하지 않는다", () => {
  assert.doesNotMatch(workspaceSource, /activeSection === ["']settings["']/);
  assert.doesNotMatch(workspaceSource, /setActiveSection\(["']settings["']\)/);
  assert.doesNotMatch(workspaceSource, />운임 설정</);
});

test("관리자 화면에서만 공용 운임 기준표를 관리한다", () => {
  assert.match(adminSource, /id=["']fare-settings["']/);
  assert.match(adminSource, />운임 설정</);
  assert.match(adminSource, />공용 대중교통 운임 기준표</);
  assert.match(adminSource, /Google 시트에서 불러오기/);
  assert.match(googleSourceRoute, /getSupabaseUser/);
  assert.match(googleSourceRoute, /hasAdminUiAccess/);
  assert.match(googleSourceRoute, /관리자 권한이 필요합니다/);
});

test("직원용 운임 API는 관리자 공용 기준표만 읽고 변경 요청을 거부한다", () => {
  assert.match(routeSource, /from\(["']travel_fare_catalog["']\)/);
  assert.doesNotMatch(routeSource, /from\(["']travel_fare_presets["']\)/);
  assert.match(routeSource, /export const POST = mutationDisabled/);
  assert.match(routeSource, /export const DELETE = mutationDisabled/);
  assert.match(routeSource, /운임 기준표는 관리자 화면에서만 변경할 수 있습니다/);
  assert.match(workspaceSource, /findAutomaticFareMatch/);
  assert.match(workspaceSource, /fetch\(["']\/api\/travel\/fare-presets["']\)/);
});
