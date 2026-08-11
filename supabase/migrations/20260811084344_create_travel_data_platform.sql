begin;

-- 출장 문서와 계산 결과. 클라이언트가 UUID를 먼저 만들 수 있도록 기본값도 둔다.
create table if not exists public.travel_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'draft',
  document_number text,
  department text,
  employee_name text,
  purpose text,
  destination text,
  start_at timestamptz,
  end_at timestamptz,
  transport_type text,
  project_type text,
  total_amount integer not null default 0,
  source_object_key text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travel_trips_user_updated_idx
  on public.travel_trips (user_id, updated_at desc);

-- 사용자가 직접 저장하는 개인 운임 기준.
create table if not exists public.travel_fare_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origin text not null,
  destination text not null,
  outbound_fare integer not null default 0,
  return_fare integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_fare_presets_origin_not_blank
    check (length(btrim(origin)) > 0),
  constraint travel_fare_presets_destination_not_blank
    check (length(btrim(destination)) > 0),
  constraint travel_fare_presets_route_must_differ
    check (lower(btrim(origin)) <> lower(btrim(destination))),
  constraint travel_fare_presets_outbound_fare_range
    check (outbound_fare between 0 and 10000000),
  constraint travel_fare_presets_return_fare_range
    check (return_fare between 0 and 10000000),
  constraint travel_fare_presets_fare_required
    check (outbound_fare > 0 or return_fare > 0)
);

create unique index if not exists travel_fare_presets_user_route_key
  on public.travel_fare_presets (user_id, lower(origin), lower(destination));

-- 관리자가 배포하는 조직 공용 운임 기준.
create table if not exists public.travel_fare_catalog (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  destination text not null,
  outbound_fare integer not null default 0,
  return_fare integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint travel_fare_catalog_origin_valid
    check (length(btrim(origin)) between 1 and 120),
  constraint travel_fare_catalog_destination_valid
    check (length(btrim(destination)) between 1 and 120),
  constraint travel_fare_catalog_route_must_differ
    check (lower(btrim(origin)) <> lower(btrim(destination))),
  constraint travel_fare_catalog_outbound_fare_range
    check (outbound_fare between 0 and 10000000),
  constraint travel_fare_catalog_return_fare_range
    check (return_fare between 0 and 10000000),
  constraint travel_fare_catalog_fare_required
    check (outbound_fare > 0 or return_fare > 0),
  constraint travel_fare_catalog_route_key unique (origin, destination)
);

create index if not exists travel_fare_catalog_updated_by_idx
  on public.travel_fare_catalog (updated_by)
  where updated_by is not null;

alter table public.travel_trips enable row level security;
alter table public.travel_fare_presets enable row level security;
alter table public.travel_fare_catalog enable row level security;

-- 반복 적용해도 정책 정의가 정확히 같은 상태가 되도록 재생성한다.
drop policy if exists travel_trips_select_own on public.travel_trips;
create policy travel_trips_select_own
  on public.travel_trips
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists travel_trips_insert_own on public.travel_trips;
create policy travel_trips_insert_own
  on public.travel_trips
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists travel_trips_update_own on public.travel_trips;
create policy travel_trips_update_own
  on public.travel_trips
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists travel_trips_delete_own on public.travel_trips;
create policy travel_trips_delete_own
  on public.travel_trips
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists travel_fare_presets_select_own on public.travel_fare_presets;
create policy travel_fare_presets_select_own
  on public.travel_fare_presets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists travel_fare_presets_insert_own on public.travel_fare_presets;
create policy travel_fare_presets_insert_own
  on public.travel_fare_presets
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists travel_fare_presets_update_own on public.travel_fare_presets;
create policy travel_fare_presets_update_own
  on public.travel_fare_presets
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists travel_fare_presets_delete_own on public.travel_fare_presets;
create policy travel_fare_presets_delete_own
  on public.travel_fare_presets
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists travel_fare_catalog_read_authenticated on public.travel_fare_catalog;
create policy travel_fare_catalog_read_authenticated
  on public.travel_fare_catalog
  for select
  to authenticated
  using (true);

-- 2026년 신규 프로젝트는 Data API 권한을 자동 부여하지 않으므로 명시한다.
revoke all privileges on table public.travel_trips from public, anon, authenticated, service_role;
revoke all privileges on table public.travel_fare_presets from public, anon, authenticated, service_role;
revoke all privileges on table public.travel_fare_catalog from public, anon, authenticated, service_role;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on table public.travel_trips to authenticated;
grant select, insert, update, delete on table public.travel_fare_presets to authenticated;
grant select on table public.travel_fare_catalog to authenticated;

-- Edge Function의 비밀키 클라이언트가 필요한 최소 DML 권한.
grant select, insert, update, delete on table public.travel_trips to service_role;
grant select, insert, update, delete on table public.travel_fare_presets to service_role;
grant select, insert, update, delete on table public.travel_fare_catalog to service_role;

-- 승인 PDF/HWPX는 공개 URL이 없는 전용 버킷에 저장한다.
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

-- 경로 규약: travel/{auth.uid()}/{trip-id}/{filename}
drop policy if exists travel_sources_insert_own on storage.objects;
create policy travel_sources_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'travel-sources'
    and (storage.foldername(name))[1] = 'travel'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists travel_sources_select_own on storage.objects;
create policy travel_sources_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'travel-sources'
    and (storage.foldername(name))[1] = 'travel'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists travel_sources_delete_own on storage.objects;
create policy travel_sources_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'travel-sources'
    and (storage.foldername(name))[1] = 'travel'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

commit;
