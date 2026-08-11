const HEADER_ALIASES = {
  email: ["이메일", "이메일 주소", "직원 이메일", "email", "email address"],
  fullName: ["이름", "성명", "직원 이름", "직원명", "full name", "name"],
  password: ["초기 비밀번호", "초기 password", "임시 비밀번호", "최초 비밀번호", "비밀번호", "initial password", "password"],
};

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/^\uFEFF/, "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function columnIndex(row, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return row.findIndex((cell) => wanted.has(normalizeHeader(cell)));
}

export function parseStaffAccountRows(rows, { maxUsers = 100, headerSearchLimit = 20 } = {}) {
  if (!Array.isArray(rows)) throw new Error("엑셀 데이터를 읽지 못했습니다.");

  let headerIndex = -1;
  let columns = null;
  for (let index = 0; index < Math.min(rows.length, headerSearchLimit); index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const nextColumns = {
      email: columnIndex(row, HEADER_ALIASES.email),
      fullName: columnIndex(row, HEADER_ALIASES.fullName),
      password: columnIndex(row, HEADER_ALIASES.password),
    };
    if (Object.values(nextColumns).every((column) => column >= 0)) {
      headerIndex = index;
      columns = nextColumns;
      break;
    }
  }

  if (headerIndex < 0 || !columns) {
    throw new Error("엑셀에서 이메일, 이름, 초기 비밀번호 헤더 행을 찾지 못했습니다.");
  }

  const seen = new Set();
  const users = [];
  const errors = [];
  let populatedRows = 0;

  rows.slice(headerIndex + 1).forEach((rawRow, offset) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const rowNumber = headerIndex + offset + 2;
    const email = String(row[columns.email] ?? "").trim().toLowerCase();
    const fullName = String(row[columns.fullName] ?? "").replace(/\s+/g, " ").trim();
    const password = String(row[columns.password] ?? "");
    if (!email && !fullName && !password) return;

    populatedRows += 1;
    if (populatedRows > maxUsers) return;
    if (!/^\S+@\S+\.\S+$/.test(email)) errors.push(`${rowNumber}행 이메일 확인`);
    if (!fullName) errors.push(`${rowNumber}행 이름 누락`);
    if (password.length < 8) errors.push(`${rowNumber}행 비밀번호 8자 이상`);
    if (seen.has(email)) errors.push(`${rowNumber}행 이메일 중복`);
    if (email) seen.add(email);
    users.push({ email, fullName, password, rowNumber });
  });

  if (populatedRows > maxUsers) errors.push(`최대 ${maxUsers}명까지 등록할 수 있습니다.`);
  if (!users.length) errors.push("등록할 직원 데이터가 없습니다.");
  if (errors.length) throw new Error(errors.slice(0, 12).join(" · "));
  return users;
}
