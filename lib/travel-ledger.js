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

export function safeTravelTimestamp(value) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}
