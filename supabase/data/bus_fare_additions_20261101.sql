-- 근거: config/bus-fare-additions-2026-11-01.json. bus_fare_revision_20261001.sql 적용 후 실행한다.
-- 2026. 11. 01. 운영 DB에 적용 완료. 재실행하면 고유키 충돌로 실패하므로 다른 환경을 맞출 때만 쓴다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. 전주-부안 변경 전 요금 정정 (4,300원 → 6,900원)
update public.travel_fare_catalog
set outbound_fare = 6900, return_fare = 6900, updated_at = now()
where origin = '전주' and destination = '부안'
  and effective_from = date '0001-01-01' and outbound_fare = 4300 and return_fare = 4300;

-- 2. 확인 대기 노선의 2026. 10. 01. 이후 요금 (기존 요금은 유지)
-- 3. 신규 28개 노선: 2026. 09. 30.까지 변경 전, 2026. 10. 01.부터 변경 후 요금
with additions(origin, destination, previous_fare, new_fare) as (values
  ('전주','장수',8300,9100),
  ('전주','무주',10600,11500),
  ('전주','임실',4300,4700),
  ('전주','순창',8300,9000),
  ('전주','수원',20400,22200),
  ('전주','안양',23200,25300),
  ('전주','부천',25000,27500),
  ('전주','안산',22700,24700),
  ('전주','용인',21900,23900),
  ('전주','의정부',27100,30000),
  ('전주','마산',22500,24500),
  ('전주','창원',17400,18900),
  ('전주','김해',25200,27500),
  ('전주','양산',28200,30700),
  ('전주','목포',20700,22600),
  ('전주','순천',24100,26200),
  ('전주','여수',30500,33300),
  ('전주','청주',15900,17400),
  ('전주','춘천',32400,35300),
  ('전주','대구',19400,21200),
  ('전주','경주',26900,29300),
  ('전주','포항',34200,35300),
  ('전주','구미',20300,22100),
  ('전주','인천공항',30700,32000),
  ('익산','인천공항',34700,36000),
  ('정읍','인천공항',36300,39600),
  ('김제','인천공항',30500,33200),
  ('고창','인천공항',42500,46400)
)
insert into public.travel_fare_catalog(origin, destination, outbound_fare, return_fare, effective_from, effective_until, updated_at)
select origin, destination, previous_fare, previous_fare, date '0001-01-01', date '2026-10-01', now() from additions
union all
select origin, destination, new_fare, new_fare, date '2026-10-01', null, now() from additions
union all
select * from (values
  ('전주','광주',12500,12500,date '2026-10-01',null::date,now()),
  ('전주','서울',23900,23900,date '2026-10-01',null::date,now())
) as resolved;
commit;
