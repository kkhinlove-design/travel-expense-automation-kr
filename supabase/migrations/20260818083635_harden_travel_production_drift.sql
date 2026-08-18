-- 운영 DB의 레거시 기본 권한과 Storage 버킷 설정을
-- 현재 출장 앱의 최소 권한 기준에 맞춘다.
-- 기존 출장·운임·사용자 설정 데이터는 변경하지 않는다.

begin;

-- 운영 요청을 오래 막지 않고, 잠금 경합이 있으면 전체 transaction을 실패시킨다.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Data API 역할에는 화면/API에서 실제 사용하는 CRUD 권한만 부여한다.
revoke all privileges on table public.travel_trips
  from public, anon, authenticated, service_role;
revoke all privileges on table public.travel_fare_presets
  from public, anon, authenticated, service_role;
revoke all privileges on table public.travel_user_preferences
  from public, anon, authenticated, service_role;
revoke all privileges on table public.travel_fare_catalog
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.travel_trips
  to authenticated, service_role;
grant select, insert, update, delete
  on table public.travel_fare_presets
  to authenticated, service_role;
grant select, insert, update, delete
  on table public.travel_user_preferences
  to authenticated, service_role;

-- 공용 운임표는 로그인 사용자에게 읽기만 허용하고,
-- 쓰기는 관리자 Edge Function의 service_role 경로로 제한한다.
grant select
  on table public.travel_fare_catalog
  to authenticated;
grant select, insert, update, delete
  on table public.travel_fare_catalog
  to service_role;

-- 관리자 기록 사용자 FK의 조회·삭제 검사를 위한 누락 인덱스.
create index if not exists travel_fare_catalog_updated_by_idx
  on public.travel_fare_catalog (updated_by);

-- 승인 원본은 비공개로 유지하고 파일 크기·허용 형식을 운영에도 강제한다.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'travel-sources',
  'travel-sources',
  false,
  4194304,
  array[
    'application/pdf',
    'application/vnd.hancom.hwpx',
    'application/zip',
    'application/x-zip-compressed'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
