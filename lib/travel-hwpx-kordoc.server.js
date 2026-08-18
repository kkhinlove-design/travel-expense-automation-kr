import { parseHwpx } from "kordoc";
import JSZip from "jszip";
import { parseApprovedTravelHwpxTables } from "./travel-parser.js";

export const MAX_KORDOC_HWPX_FILE_SIZE = 4 * 1024 * 1024;
export const MAX_KORDOC_HWPX_EXPANDED_SIZE = 32 * 1024 * 1024;
const MAX_KORDOC_HWPX_SECTION_SIZE = 12 * 1024 * 1024;
const MAX_KORDOC_HWPX_ENTRIES = 128;
const MAX_KORDOC_HWPX_SECTIONS = 32;

export class TravelHwpxKordocError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "TravelHwpxKordocError";
    this.code = code;
  }
}

function cellText(cell) {
  return String(cell?.text ?? "").replace(/\r\n?/g, "\n").trim();
}

function visitKordocBlocks(blocks, tables) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type === "table" && block.table) {
      const cells = Array.isArray(block.table.cells) ? block.table.cells : [];
      const matrix = cells.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
      if (matrix.length) tables.push(matrix);
      cells.forEach((row) => {
        (Array.isArray(row) ? row : []).forEach((cell) => visitKordocBlocks(cell?.blocks, tables));
      });
    }
    visitKordocBlocks(block?.children, tables);
  }
}

export function kordocTravelTables(blocks) {
  const tables = [];
  visitKordocBlocks(blocks, tables);
  return tables;
}

function inputBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new TravelHwpxKordocError("HWPX 입력 형식이 올바르지 않습니다.", "INVALID_HWPX_INPUT");
}

async function validateHwpxArchive(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new TravelHwpxKordocError("손상되었거나 지원하지 않는 HWPX 파일입니다.", "INVALID_HWPX_ARCHIVE", error);
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const sections = entries.filter((entry) => /^Contents\/section\d+\.xml$/i.test(entry.name));
  if (!sections.length) {
    throw new TravelHwpxKordocError("HWPX 본문을 찾지 못했습니다.", "INVALID_HWPX_ARCHIVE");
  }
  if (entries.length > MAX_KORDOC_HWPX_ENTRIES || sections.length > MAX_KORDOC_HWPX_SECTIONS) {
    throw new TravelHwpxKordocError("HWPX 내부 구성이 너무 큽니다.", "HWPX_ARCHIVE_TOO_COMPLEX");
  }

  const entrySize = (entry) => Number(entry?._data?.uncompressedSize) || 0;
  const expandedSize = entries.reduce((total, entry) => total + entrySize(entry), 0);
  const sectionSize = sections.reduce((total, entry) => total + entrySize(entry), 0);
  if (expandedSize > MAX_KORDOC_HWPX_EXPANDED_SIZE || sectionSize > MAX_KORDOC_HWPX_SECTION_SIZE) {
    throw new TravelHwpxKordocError("HWPX 압축 해제 크기가 너무 큽니다.", "HWPX_EXPANDED_SIZE_TOO_LARGE");
  }
}

export async function parseApprovedTravelHwpxWithKordoc(input) {
  const buffer = inputBuffer(input);
  if (!buffer.length) throw new TravelHwpxKordocError("HWPX 파일이 비어 있습니다.", "EMPTY_HWPX_FILE");
  if (buffer.length > MAX_KORDOC_HWPX_FILE_SIZE) {
    throw new TravelHwpxKordocError("HWPX 파일은 4MB 이하만 읽을 수 있습니다.", "HWPX_FILE_TOO_LARGE");
  }
  await validateHwpxArchive(buffer);

  let result;
  try {
    result = await parseHwpx(buffer, { keepTrailingEmptyCols: true });
  } catch (error) {
    throw new TravelHwpxKordocError("HWPX 표 구조를 분석하지 못했습니다.", "KORDOC_PARSE_FAILED", error);
  }
  if (!result?.success || result.fileType !== "hwpx") {
    throw new TravelHwpxKordocError("손상되었거나 지원하지 않는 HWPX 파일입니다.", result?.code || "KORDOC_PARSE_FAILED");
  }

  const tables = kordocTravelTables(result.blocks);
  const parsed = parseApprovedTravelHwpxTables(tables, result.markdown);
  if (!parsed) {
    throw new TravelHwpxKordocError("HWPX에서 출장신청 표를 찾지 못했습니다.", "TRAVEL_TABLE_NOT_FOUND");
  }
  return parsed;
}
