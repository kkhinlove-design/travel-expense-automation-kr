begin;

alter table public.travel_user_preferences
  alter column report_approver_first set default '팀장',
  alter column report_approver_second set default '실장',
  add column if not exists report_approval_configured_at timestamptz;

comment on column public.travel_user_preferences.report_approval_configured_at
  is '사용자가 환경설정에서 결재라인을 직접 저장한 시각. null이면 기관 기본값 사용';

commit;
