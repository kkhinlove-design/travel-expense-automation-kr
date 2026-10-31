-- 기존 28개 운임의 금액은 변경하지 않고 날짜별 이력을 추가할 수 있게 한다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.travel_fare_catalog
  add column effective_from date not null default date '0001-01-01',
  add column effective_until date,
  add constraint travel_fare_catalog_date_range check (effective_until is null or effective_until > effective_from);
alter table public.travel_fare_catalog
  drop constraint travel_fare_catalog_route_key;
alter table public.travel_fare_catalog
  add constraint travel_fare_catalog_route_date_key
  unique (origin, destination, effective_from);
comment on column public.travel_fare_catalog.effective_from
  is '이 날짜부터 적용. 0001-01-01은 기존 운임 이관 기준값. 출발일과 복귀일을 각각 비교한다.';
commit;
