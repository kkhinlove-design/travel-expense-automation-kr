begin;

-- 직원별 기본 출발 사무소. 새 출장 문서를 만들 때만 기본값으로 사용하며,
-- 각 출장에서는 실제 출발지에 맞게 다시 선택할 수 있다.
create table if not exists public.travel_user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  default_origin text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_user_preferences_default_origin_valid
    check (length(btrim(default_origin)) between 1 and 80)
);

alter table public.travel_user_preferences enable row level security;

drop policy if exists travel_user_preferences_select_own on public.travel_user_preferences;
create policy travel_user_preferences_select_own
  on public.travel_user_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists travel_user_preferences_insert_own on public.travel_user_preferences;
create policy travel_user_preferences_insert_own
  on public.travel_user_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists travel_user_preferences_update_own on public.travel_user_preferences;
create policy travel_user_preferences_update_own
  on public.travel_user_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists travel_user_preferences_delete_own on public.travel_user_preferences;
create policy travel_user_preferences_delete_own
  on public.travel_user_preferences
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 신규 Supabase 프로젝트의 Data API 기본 권한 변경과 관계없이
-- 로그인한 사용자만 자신의 환경 설정을 사용할 수 있게 명시한다.
revoke all privileges on table public.travel_user_preferences from public, anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on table public.travel_user_preferences to authenticated;
grant select, insert, update, delete on table public.travel_user_preferences to service_role;

commit;
