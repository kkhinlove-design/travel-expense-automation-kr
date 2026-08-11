import assert from "node:assert/strict";
import test from "node:test";
import { parseStaffAccountRows } from "../lib/staff-account-import.js";

test("finds the staff headers below title and instruction rows", () => {
  const rows = [
    ["직원 계정 일괄 등록 양식", "", ""],
    ["5행부터 입력하세요.", "", ""],
    ["", "", ""],
    ["이메일", "이름", "초기 비밀번호"],
    ["staff@example.com", "홍길동", "initial1"],
  ];

  assert.deepEqual(parseStaffAccountRows(rows), [{
    email: "staff@example.com",
    fullName: "홍길동",
    password: "initial1",
    rowNumber: 5,
  }]);
});

test("accepts aliases and changed column order", () => {
  const rows = [
    ["성명", "Password", "Email Address"],
    ["김직원", "initial2", "worker@example.com"],
  ];

  assert.equal(parseStaffAccountRows(rows)[0].email, "worker@example.com");
});

test("counts only populated staff rows against the bulk limit", () => {
  const rows = [["이메일", "이름", "초기 비밀번호"]];
  for (let index = 0; index < 100; index += 1) {
    rows.push([`staff${index}@example.com`, `직원${index}`, "initial3"]);
  }
  rows.push(["", "", ""], ["", "", ""]);

  assert.equal(parseStaffAccountRows(rows, { maxUsers: 100 }).length, 100);
  rows.push(["overflow@example.com", "초과", "initial4"]);
  assert.throws(
    () => parseStaffAccountRows(rows, { maxUsers: 100 }),
    /최대 100명/,
  );
});
