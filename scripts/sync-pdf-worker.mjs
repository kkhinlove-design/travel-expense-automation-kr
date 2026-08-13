// pdfjs-dist를 올린 뒤 public/pdf.worker.min.mjs를 같은 버전으로 맞춘다.
// lib/travel-parser.js가 워커를 `/pdf.worker.min.mjs`에서 읽기 때문에
// 이 복사를 빠뜨리면 브라우저에서 PDF 추출이 통째로 실패한다.
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
);
const target = fileURLToPath(new URL("../public/pdf.worker.min.mjs", import.meta.url));

await copyFile(source, target);
process.stdout.write("public/pdf.worker.min.mjs를 설치된 pdfjs-dist 버전으로 맞췄습니다.\n");
