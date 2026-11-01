-- 근거: config/bus-fare-revision-2026-10-01.json. 웹 코드 배포 완료 후 적용한다.
-- 기존 금액은 보존하며 확인된 20개 노선만 새 이력으로 추가한다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
  if (select count(*) from public.travel_fare_catalog where effective_from = date '0001-01-01') <> 28 then
    raise exception '기존 운임표가 변경되었습니다. 적용 전 다시 대조하세요.';
  end if;
  if (select count(*) from (values
    ('군산', '고창', 7600, 8300),
    ('군산', '김제', 4600, 5000),
    ('군산', '부안', 7400, 8100),
    ('군산', '익산', 3400, 3700),
    ('군산', '인천공항', 29700, 32400),
    ('군산', '전주', 6600, 7200),
    ('군산', '정읍', 9800, 10700),
    ('익산', '고창', 7900, 8600),
    ('익산', '군산', 3400, 3700),
    ('익산', '김제', 3000, 3300),
    ('익산', '부안', 5800, 6400),
    ('익산', '정읍', 6400, 7000),
    ('전주', '고창', 8800, 9600),
    ('전주', '군산', 6600, 7200),
    ('전주', '김제', 4300, 4600),
    ('전주', '남원', 6900, 7500),
    ('전주', '부안', 4300, 7500),
    ('전주', '익산', 3700, 4000),
    ('전주', '정읍', 5500, 6300),
    ('전주', '진안', 4600, 5000)
  ) as revised(origin,destination,previous_fare,new_fare)
  join public.travel_fare_catalog c using(origin,destination)
  where c.effective_from = date '0001-01-01' and c.outbound_fare = revised.previous_fare and c.return_fare = revised.previous_fare) <> 20 then
    raise exception '기존 운임 금액이 대조본과 다릅니다.';
  end if;
end $$;
update public.travel_fare_catalog
set effective_until = date '2026-10-01'
where effective_from = date '0001-01-01';
insert into public.travel_fare_catalog(origin,destination,outbound_fare,return_fare,effective_from,updated_at)
select origin,destination,new_fare,new_fare,date '2026-10-01',now()
from (values
    ('군산', '고창', 7600, 8300),
    ('군산', '김제', 4600, 5000),
    ('군산', '부안', 7400, 8100),
    ('군산', '익산', 3400, 3700),
    ('군산', '인천공항', 29700, 32400),
    ('군산', '전주', 6600, 7200),
    ('군산', '정읍', 9800, 10700),
    ('익산', '고창', 7900, 8600),
    ('익산', '군산', 3400, 3700),
    ('익산', '김제', 3000, 3300),
    ('익산', '부안', 5800, 6400),
    ('익산', '정읍', 6400, 7000),
    ('전주', '고창', 8800, 9600),
    ('전주', '군산', 6600, 7200),
    ('전주', '김제', 4300, 4600),
    ('전주', '남원', 6900, 7500),
    ('전주', '부안', 4300, 7500),
    ('전주', '익산', 3700, 4000),
    ('전주', '정읍', 5500, 6300),
    ('전주', '진안', 4600, 5000)
) as revised(origin,destination,previous_fare,new_fare)
on conflict (origin,destination,effective_from) do update
set outbound_fare = excluded.outbound_fare, return_fare = excluded.return_fare, updated_at = excluded.updated_at;
commit;
