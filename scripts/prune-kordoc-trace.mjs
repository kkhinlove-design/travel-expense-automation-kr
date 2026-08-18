import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const tracePath = path.join(
  process.cwd(),
  ".next",
  "server",
  "app",
  "api",
  "travel",
  "parse-hwpx",
  "route.js.nft.json",
);
const traceDirectory = path.dirname(tracePath);

// Kordoc의 공개 진입점은 이미지 OCR·PDF 파서를 선택 기능으로 제공한다.
// 이 API는 HWPX 표만 읽으므로 아래 optional 패키지는 실행 경로에 들어오지 않는다.
// Next 15의 outputFileTracingExcludes가 Windows에서 역슬래시를 매칭하지 못하는
// 경우가 있어 postbuild에서도 같은 항목을 제거해 Vercel 함수 크기를 보장한다.
const unusedOptionalPackageSegments = [
  "/node_modules/@huggingface/",
  "/node_modules/@hyzyla/pdfium/",
  "/node_modules/@img/",
  "/node_modules/onnxruntime-common/",
  "/node_modules/onnxruntime-node/",
  "/node_modules/pdfjs-dist/",
  "/node_modules/sharp/",
];

function normalized(value) {
  return `/${String(value).replaceAll("\\", "/").replace(/^\/+/, "")}`;
}

function isUnusedOptionalDependency(file) {
  const filePath = normalized(file);
  return unusedOptionalPackageSegments.some((segment) => filePath.includes(segment));
}

async function tracedBytes(files) {
  let total = 0;
  for (const file of files) {
    try {
      total += (await stat(path.resolve(traceDirectory, file))).size;
    } catch {
      // Next가 공유 trace에서 제공하는 파일은 현재 route 폴더 기준으로 없을 수 있다.
    }
  }
  return total;
}

const trace = JSON.parse(await readFile(tracePath, "utf8"));
if (!Array.isArray(trace.files)) throw new Error("Kordoc API의 Next trace 형식이 올바르지 않습니다.");

const before = trace.files;
const after = before.filter((file) => !isUnusedOptionalDependency(file));
const hasKordocRuntime = after.some((file) => normalized(file).includes("/node_modules/kordoc/"));
if (!hasKordocRuntime) throw new Error("Kordoc 런타임이 Next trace에서 누락되었습니다.");

const bytes = await tracedBytes(after);
const maxBytes = 200 * 1024 * 1024;
if (bytes > maxBytes) {
  throw new Error(`Kordoc API trace가 ${(bytes / 1024 / 1024).toFixed(1)}MB로 너무 큽니다.`);
}

await writeFile(tracePath, JSON.stringify({ ...trace, files: after }));
console.log(`Kordoc API trace: ${before.length - after.length}개 optional 파일 제외, ${(bytes / 1024 / 1024).toFixed(1)}MB`);
