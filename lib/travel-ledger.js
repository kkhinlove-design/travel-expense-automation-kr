export const TRAVEL_RECORD_STATUS = Object.freeze({
  approved: "approved",
  completed: "completed",
});

export function isTravelRecordCompleted(record) {
  return ["saved", TRAVEL_RECORD_STATUS.completed].includes(String(record?.status || ""));
}

export function travelRecordCounts(records = []) {
  return records.reduce((counts, record) => {
    counts.total += 1;
    if (isTravelRecordCompleted(record)) counts.completed += 1;
    else counts.pending += 1;
    return counts;
  }, { total: 0, pending: 0, completed: 0 });
}

export function filterTravelRecords(records = [], filter = "all") {
  if (filter === "pending") return records.filter((record) => !isTravelRecordCompleted(record));
  if (filter === "completed") return records.filter(isTravelRecordCompleted);
  return records;
}

export const TRAVEL_LEDGER_PAGE_SIZE = 10;

// 삭제로 마지막 페이지가 사라져도 빈 화면이 나오지 않도록 페이지 번호를 범위 안으로 맞춘다.
export function paginateTravelRecords(records = [], page = 1, pageSize = TRAVEL_LEDGER_PAGE_SIZE) {
  const total = records.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pageCount);
  const startIndex = (current - 1) * pageSize;
  const items = records.slice(startIndex, startIndex + pageSize);
  return {
    items,
    page: current,
    pageCount,
    total,
    from: items.length ? startIndex + 1 : 0,
    to: startIndex + items.length,
  };
}

export function safeTravelTimestamp(value) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}
