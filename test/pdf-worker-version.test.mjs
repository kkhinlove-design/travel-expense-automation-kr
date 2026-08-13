import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// lib/travel-parser.js는 pdf.js API를 node_modules에서, 워커를 public/에 손으로
// 복사해 둔 파일에서 가져온다. 두 파일의 버전이 어긋나면 브라우저가
// "API version does not match Worker version"을 던지며 PDF 추출이 전부 멈춘다.
// 의존성 자동 업데이트가 워커만 남겨 두는 상황을 여기서 잡는다.
const repositoryWorker = fileURLToPath(new URL("../public/pdf.worker.min.mjs", import.meta.url));
const packagedWorker = fileURLToPath(
  new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
);

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

test("public/pdf.worker.min.mjs matches the installed pdfjs-dist legacy worker", async () => {
  const [repository, packaged] = await Promise.all([
    sha256(repositoryWorker),
    sha256(packagedWorker),
  ]);
  assert.equal(
    repository,
    packaged,
    "pdfjs-dist 버전을 올렸다면 `npm run sync:pdf-worker`로 public/pdf.worker.min.mjs도 함께 갱신하세요.",
  );
});
