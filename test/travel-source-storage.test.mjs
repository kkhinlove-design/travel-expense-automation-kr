import assert from "node:assert/strict";
import test from "node:test";

import { uploadTravelSourceObject } from "../lib/travel-source-storage.js";

test("브라우저 파일 MIME이 비어 있어도 원본은 표준 MIME의 바이트 배열로 업로드한다", async () => {
  const calls = [];
  const bucket = {
    async upload(objectKey, body, options) {
      calls.push({ objectKey, body, options });
      return { data: { path: objectKey }, error: null };
    },
  };
  const file = {
    type: "",
    async arrayBuffer() {
      return Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer;
    },
  };

  const result = await uploadTravelSourceObject(
    bucket,
    "travel/user/trip/approved.pdf",
    file,
    "application/pdf",
  );

  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].objectKey, "travel/user/trip/approved.pdf");
  assert.ok(calls[0].body instanceof Uint8Array);
  assert.deepEqual([...calls[0].body], [0x25, 0x50, 0x44, 0x46]);
  assert.deepEqual(calls[0].options, {
    contentType: "application/pdf",
    upsert: false,
  });
});

test("원본 읽기가 불가능하면 Storage 요청 전에 명확히 중단한다", async () => {
  await assert.rejects(
    uploadTravelSourceObject({ upload() {} }, "key", {}, "application/pdf"),
    /읽을 수 없습니다/,
  );
});
