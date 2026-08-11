import CFB from "cfb";
import { markdownToHwpx, validateHwpx } from "kordoc";
import { getAuthenticatedUser } from "@/app/auth";

const MAX_ROWS = 1000;
const MAX_TEXT = 12000;
const CFB_RUNTIME_READY = typeof CFB?.parse === "function";
const TABLE_WIDTH = 72000;
const SUMMARY_WIDTHS = [24000, 24000, 24000];
const DETAIL_WIDTHS = [9500, 17500, 8500, 17500, 8500, 10500];
const VARIANCE_CHAR_STYLES = {
  increase: { height_hwpunit: "1500", textColor: "#C53A42", bold: true, fontName_hangul: "맑은 고딕" },
  decrease: { height_hwpunit: "1500", textColor: "#1D5FC7", bold: true, fontName_hangul: "맑은 고딕" },
};

function cleanText(value, fallback = "") {
  return String(value ?? fallback).slice(0, MAX_TEXT).replace(/\r\n?/g, "\n").trim();
}

function markdownCell(value) {
  return cleanText(value, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, "<br>") || "-";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function amount(value, unit) {
  return `${new Intl.NumberFormat("ko-KR").format(numberValue(value))}${unit}`;
}

function signedAmount(value, unit) {
  const number = numberValue(value);
  if (number > 0) return `증액 +${amount(number, unit)}`;
  if (number < 0) return `감액 ${amount(number, unit)}`;
  return `변경없음 0${unit}`;
}

function groupedRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const category = cleanText(row.category, "미분류") || "미분류";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(row);
  });
  return groups;
}

function varianceStyle(value) {
  const number = numberValue(value);
  if (number > 0) return "increase";
  if (number < 0) return "decrease";
  return null;
}

function profileTable(tableIndex, rows, cols, widths, coloredCells = []) {
  return {
    table_index: tableIndex,
    rows,
    cols,
    width_hwpunit: String(TABLE_WIDTH),
    col_widths_hwpunit: widths.map(String),
    cells: coloredCells,
    used_border_fills: {},
    used_char_prs: VARIANCE_CHAR_STYLES,
  };
}

function buildProfile(payload) {
  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, MAX_ROWS) : [];
  const groups = groupedRows(rows);
  const original = rows.reduce((sum, row) => sum + numberValue(row.originalAmount), 0);
  const changed = rows.reduce((sum, row) => sum + numberValue(row.changedAmount), 0);
  const tables = [];
  let tableIndex = 0;

  const addSummaryProfile = (diff) => {
    const style = varianceStyle(diff);
    tables.push(profileTable(
      tableIndex,
      2,
      3,
      SUMMARY_WIDTHS,
      style ? [{ row: 1, col: 2, charPrIDRef: style }] : [],
    ));
    tableIndex += 1;
  };

  addSummaryProfile(changed - original);
  groups.forEach((items) => {
    const originalTotal = items.reduce((sum, row) => sum + numberValue(row.originalAmount), 0);
    const changedTotal = items.reduce((sum, row) => sum + numberValue(row.changedAmount), 0);
    addSummaryProfile(changedTotal - originalTotal);
    const coloredCells = items.flatMap((row, index) => {
      const style = varianceStyle(numberValue(row.changedAmount) - numberValue(row.originalAmount));
      return style ? [{ row: index + 1, col: 5, charPrIDRef: style }] : [];
    });
    tables.push(profileTable(tableIndex, items.length + 1, 6, DETAIL_WIDTHS, coloredCells));
    tableIndex += 1;
  });

  return { schema_version: "0.3.0", tables };
}

function buildMarkdown(payload) {
  const unit = payload.currencyUnit === "천원" ? "천원" : "원";
  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, MAX_ROWS) : [];
  if (!rows.length) throw new Error("내보낼 예산 항목이 없습니다.");

  const original = rows.reduce((sum, row) => sum + numberValue(row.originalAmount), 0);
  const changed = rows.reduce((sum, row) => sum + numberValue(row.changedAmount), 0);
  const groups = groupedRows(rows);

  const lines = [
    "# 예산 변경안",
    "",
    `- 기준 파일: ${cleanText(payload.fileName, "예산안")}`,
    `- 기준 표: ${cleanText(payload.sheetName, "예산표")}`,
    `- 작성일: ${new Date().toISOString().slice(0, 10)}`,
    `- 금액 단위: ${unit}`,
    "",
    "## 예산 요약",
    "",
    "| 기존예산 | 변경예산 | 총 증감액 |",
    "| ---: | ---: | ---: |",
    `| ${amount(original, unit)} | ${amount(changed, unit)} | ${signedAmount(changed - original, unit)} |`,
  ];

  groups.forEach((items, category) => {
    const originalTotal = items.reduce((sum, row) => sum + numberValue(row.originalAmount), 0);
    const changedTotal = items.reduce((sum, row) => sum + numberValue(row.changedAmount), 0);
    lines.push(
      "",
      `## ${category}`,
      "",
      "| 기존 합계 | 변경 합계 | 증감액 |",
      "| ---: | ---: | ---: |",
      `| ${amount(originalTotal, unit)} | ${amount(changedTotal, unit)} | ${signedAmount(changedTotal - originalTotal, unit)} |`,
      "",
      "| 세부항목 | 기존 산출내역 | 기존예산 | 변경 산출내역 | 변경예산 | 증감 |",
      "| --- | --- | ---: | --- | ---: | ---: |",
    );
    items.forEach((row) => {
      const diff = numberValue(row.changedAmount) - numberValue(row.originalAmount);
      lines.push(`| ${markdownCell(row.item)} | ${markdownCell(row.originalDetail)} | ${amount(row.originalAmount, unit)} | ${markdownCell(row.changedDetail)} | ${amount(row.changedAmount, unit)} | ${signedAmount(diff, unit)} |`);
    });
  });

  lines.push("", "---", "증액과 감액은 각 항목의 증감 열에서 구분합니다.");
  return lines.join("\n");
}

export async function POST(request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return Response.json(
      { error: "로그인이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    if (!CFB_RUNTIME_READY) throw new Error("HWPX 런타임 의존성을 불러오지 못했습니다.");
    const payload = await request.json();
    console.log("[api/export-hwpx] generation started", {
      rowCount: Array.isArray(payload.rows) ? payload.rows.length : 0,
      currencyUnit: payload.currencyUnit,
    });
    const markdown = buildMarkdown(payload);
    const hwpx = await markdownToHwpx(markdown, {
      gongmun: { preset: "보고서" },
      page: {
        size: "A4",
        orientation: "landscape",
        header: "예산 변경안",
        footer: "예산변경 워크룸",
      },
      theme: {
        headingColors: { 1: "#17233A", 2: "#2657A7" },
        tableHeaderColor: "#17233A",
        tableHeaderBold: true,
      },
      profile: buildProfile(payload),
    });
    const validation = await validateHwpx(hwpx);
    if (validation.errors?.length) throw new Error("생성된 HWPX 문서 검증에 실패했습니다.");
    console.log("[api/export-hwpx] generation completed", { byteLength: hwpx.byteLength });

    return new Response(hwpx, {
      headers: {
        "Content-Type": "application/vnd.hancom.hwpx",
        "Content-Disposition": `attachment; filename="budget-change-${new Date().toISOString().slice(0, 10)}.hwpx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/export-hwpx] generation failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json(
      { error: error instanceof Error ? error.message : "HWPX 문서를 만드는 중 문제가 발생했습니다." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
