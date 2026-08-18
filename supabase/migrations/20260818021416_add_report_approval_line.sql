begin;

alter table public.travel_user_preferences
  add column if not exists report_approver_first text not null default '실장',
  add column if not exists report_approver_second text not null default '원장';

alter table public.travel_user_preferences
  drop constraint if exists travel_user_preferences_report_approver_first_valid,
  drop constraint if exists travel_user_preferences_report_approver_second_valid,
  drop constraint if exists travel_user_preferences_report_approvers_distinct;

alter table public.travel_user_preferences
  add constraint travel_user_preferences_report_approver_first_valid
    check (length(btrim(report_approver_first)) between 1 and 40),
  add constraint travel_user_preferences_report_approver_second_valid
    check (length(btrim(report_approver_second)) between 1 and 40),
  add constraint travel_user_preferences_report_approvers_distinct
    check (btrim(report_approver_first) <> btrim(report_approver_second));

comment on column public.travel_user_preferences.report_approver_first
  is '새 출장복명서에 적용할 1차 결재자 직위';
comment on column public.travel_user_preferences.report_approver_second
  is '새 출장복명서에 적용할 최종 결재자 직위';

commit;
