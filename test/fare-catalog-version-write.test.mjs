import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const source = fs.readFileSync(new URL("../supabase/functions/admin-fare-catalog/index.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
const code = stripTypeScriptTypes(source);

async function invoke(body, allowed = true) {
  const reads = [], writes = [];
  let handler;
  const context = {
    Request, Response,
    Deno: { serve(callback) { handler = callback; } },
    corsHeadersFor: () => ({"Content-Type":"application/json"}),
    requireAdmin: async () => allowed ? { ok: true, caller:{id:"synthetic-admin"}, adminClient: {
      from(table) { return {
        select() { return { eq(column,date) { reads.push({table,column,date}); return Promise.resolve({data:[],error:null}); } }; },
        upsert(rows, options) { writes.push(JSON.parse(JSON.stringify({table,rows,options}))); return Promise.resolve({error:null}); },
      }; },
    }} : {ok:false,status:403,error:"forbidden"},
  };
  vm.runInNewContext(code,context);
  const response = await handler(new Request("https://fixture.invalid",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json(),reads,writes};
}

const rows = [{origin:"전주",destination:"군산",outboundFare:7200,returnFare:7200}];
test("운임 등록은 적용 시작일을 포함한 고유키에만 쓰고 과거 이력은 덮어쓰지 않는다", async () => {
  const result = await invoke({presets:rows,effectiveFrom:"2026-10-01"});
  assert.equal(result.status,200);
  assert.equal(result.reads[0].column,"effective_from");
  assert.equal(result.reads[0].date,"2026-10-01");
  assert.equal(result.writes[0].options.onConflict,"origin,destination,effective_from");
  assert.equal(result.writes[0].rows[0].effective_from,"2026-10-01");
});
test("누락·잘못된 적용일과 관리자 아닌 요청은 DB 쓰기 전에 거부한다", async () => {
  for(const date of [undefined,"2026-02-30","2026-10-01junk","0001-01-01"]){
    const result = await invoke({presets:rows,effectiveFrom:date});
    assert.equal(result.status,400);
    assert.equal(result.writes.length,0);
  }
  const result = await invoke({presets:rows,effectiveFrom:"2026-10-01"},false);
  assert.equal(result.status,403);
  assert.equal(result.writes.length,0);
});
