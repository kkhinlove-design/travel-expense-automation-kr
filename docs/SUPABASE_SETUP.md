# Supabase 신규 조직 설치

이 문서는 빈 Supabase 프로젝트에 출장 자동화용 데이터베이스, 비공개 원본 문서 버킷, 관리자 Edge Function을 같은 상태로 설치하는 절차입니다. 명령은 저장소 루트에서 실행합니다.

## 설치되는 항목

- `public.travel_trips`: 로그인 사용자별 출장/정산 데이터
- `public.travel_fare_presets`: 로그인 사용자별 개인 운임 기준
- `public.travel_fare_catalog`: 전 직원이 읽는 관리자 공용 운임 기준
- 비공개 Storage 버킷 `travel-sources`
- Edge Function `admin-create-user`, `admin-fare-catalog`
- 사용자 소유권 RLS, Storage 경로 소유권 정책, 명시적 Data API 권한

SQL 마이그레이션은 재실행해도 정책과 버킷 설정이 같은 상태가 되도록 작성했습니다. 이미 배포한 마이그레이션을 수정하지 말고, 이후 변경은 `supabase migration new <name>`으로 새 파일을 추가합니다.

## 1. 준비

필요한 항목은 다음과 같습니다.

- 새 Supabase 프로젝트와 프로젝트 참조값(`PROJECT_REF`)
- Supabase CLI 2.113.0 이상
- 로컬 전체 검증을 할 때만 Docker Desktop

이 저장소의 재현 기준 CLI는 `2.113.0`입니다. 전역 설치 없이 다음과 같이 실행할 수 있습니다.

```powershell
npx --yes supabase@2.113.0 --version
```

## 2. 로컬 검증(권장)

```powershell
npx --yes supabase@2.113.0 start
npx --yes supabase@2.113.0 db reset
npx --yes supabase@2.113.0 status
```

`db reset`이 성공하면 세 테이블, RLS 정책, `travel-sources` 버킷이 로컬 DB에 생성됩니다. 로컬 작업을 마친 뒤에는 `npx --yes supabase@2.113.0 stop`으로 종료할 수 있습니다.

## 3. 원격 프로젝트 연결과 마이그레이션

```powershell
npx --yes supabase@2.113.0 login
npx --yes supabase@2.113.0 link --project-ref PROJECT_REF
npx --yes supabase@2.113.0 db push --linked --dry-run
npx --yes supabase@2.113.0 db push --linked
npx --yes supabase@2.113.0 seed buckets --linked
```

먼저 `--dry-run` 결과가 이 저장소의 신규 마이그레이션만 포함하는지 확인합니다. `db push`가 버킷을 생성하며, `seed buckets`는 `config.toml`에 선언한 비공개 여부·4 MiB 제한·허용 MIME을 한 번 더 맞춥니다.

## 4. 호스팅 Auth 설정

`supabase/config.toml`의 Auth 항목은 로컬 개발 기준입니다. 호스팅 프로젝트의 Dashboard에서 다음 항목을 별도로 맞춥니다.

1. 일반 사용자 직접 가입을 끕니다. 직원 계정은 관리자 Function만 생성합니다.
2. 최소 비밀번호 길이를 8자로 설정하고 문자와 숫자를 요구합니다.
3. 애플리케이션의 실제 Site URL과 허용 Redirect URL을 등록합니다.
4. 관리자 생성 계정은 `email_confirm: true`로 만들어지므로 확인 메일 없이 로그인할 수 있습니다.
5. Authentication > Providers > Email에서 **Secure password change**를 켭니다.

내 계정 화면은 새 비밀번호를 저장하기 전에 현재 비밀번호로 재로그인해 본인 확인을 직접 수행합니다. 이 확인은 프로젝트 설정과 무관하게 항상 동작하므로 세션만 탈취한 사람은 비밀번호를 바꿀 수 없습니다. 위 5번은 그 위에 얹는 서버 측 방어입니다. `updateUser`에 전달하는 `current_password`는 GoTrue가 해당 옵션을 켠 프로젝트에서만 검증하므로 이 값에만 의존해서는 안 됩니다.

## 5. 최초 관리자와 Function 비밀값

두 관리자 Function은 요청의 Bearer 토큰을 Supabase Auth 서버에서 다시 검증한 뒤 다음 중 하나일 때만 허용합니다.

- 검증된 사용자의 `app_metadata.role`이 `admin` 또는 `super_admin`
- 검증된 사용자의 `app_metadata.roles` 배열에 `admin` 또는 `super_admin`이 포함됨
- 검증된 사용자의 이메일이 Edge Function 비밀값 `ADMIN_EMAILS`에 포함됨

`user_metadata`는 권한 판정에 사용하지 않습니다. 최초 설치는 Dashboard의 Authentication > Users에서 관리자 계정을 하나 만든 뒤, 저장소에 커밋되지 않는 `supabase/.env.functions.local` 파일에 allowlist를 둡니다.

```dotenv
ADMIN_EMAILS=FIRST_ADMIN_EMAIL,SECOND_ADMIN_EMAIL
ALLOWED_ORIGINS=https://YOUR-DEPLOYMENT.vercel.app
```

`ALLOWED_ORIGINS`에는 관리자 화면을 여는 실제 배포 주소를 넣습니다. 두 관리자 Function은 이 목록에 있는 오리진에만 CORS를 허용하며, 비워 두면 예전처럼 모든 오리진을 허용합니다. 쉼표·세미콜론·공백으로 여러 주소를 구분할 수 있습니다.

쉼표, 세미콜론 또는 줄바꿈으로 여러 주소를 구분할 수 있으며 비교 시 공백과 대소문자를 정규화합니다. 이 파일은 `supabase/.gitignore`의 `.env.*.local` 규칙으로 제외됩니다.

이메일 fallback으로 최초 설치한다면 첫 관리자 주소 하나를 Vercel의 `NEXT_PUBLIC_ADMIN_EMAIL`과 이 `ADMIN_EMAILS`에 동일하게 설정하세요. 전자는 관리자 화면 표시용 공개 설정이고, 실제 계정 생성·공용 운임 변경 권한은 Function의 `ADMIN_EMAILS`가 서버에서 검증합니다.

```powershell
npx --yes supabase@2.113.0 secrets set --env-file supabase/.env.functions.local
npx --yes supabase@2.113.0 functions deploy admin-create-user admin-fare-catalog
```

조직에서 서버 측 Admin API로 `app_metadata.role=admin` 또는 `app_metadata.roles=["admin"]`을 관리한다면 `ADMIN_EMAILS` 없이도 동작합니다. 역할은 반드시 Supabase Admin API처럼 비밀키를 보유한 신뢰 서버에서만 변경해야 합니다.

Supabase가 Function에 제공하는 `SUPABASE_URL` 및 secret/service-role 시스템 환경값은 자동으로 사용합니다. 이 비밀키를 직접 브라우저나 Vercel의 `NEXT_PUBLIC_*` 변수에 넣지 마십시오.

## 6. 애플리케이션 환경 변수

웹 애플리케이션에는 공개 가능한 값 두 개만 설정합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SB_PUBLISHABLE_KEY
```

`SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, 데이터베이스 비밀번호는 애플리케이션 클라이언트 환경 변수에 두지 않습니다. 관리자 Function이 필요한 비밀키는 Supabase가 관리하는 Function 환경에서만 읽습니다.

## 7. 배포 확인

```powershell
npx --yes supabase@2.113.0 migration list --linked
npx --yes supabase@2.113.0 functions list
npx --yes supabase@2.113.0 secrets list
```

Dashboard SQL Editor에서 다음 읽기 전용 쿼리로 스키마와 정책을 확인할 수 있습니다.

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('travel_trips', 'travel_fare_presets', 'travel_fare_catalog')
order by tablename;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename like 'travel_%')
   or (schemaname = 'storage' and tablename = 'objects' and policyname like 'travel_%')
order by schemaname, tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('travel_trips', 'travel_fare_presets', 'travel_fare_catalog')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'travel-sources';
```

최종 권한 검증은 서로 다른 테스트 사용자 A/B로 수행합니다.

1. A가 만든 `travel_trips`와 `travel_fare_presets`가 B에게 조회·수정·삭제되지 않아야 합니다.
2. B가 `travel/A_USER_ID/...` 경로에 파일을 올리거나 읽으려 하면 거부되어야 합니다.
3. 로그인 사용자는 `travel_fare_catalog`를 읽을 수 있지만 직접 쓰기는 거부되어야 합니다.
4. 일반 직원의 두 관리자 Function 호출은 `403`이어야 합니다.
5. `app_metadata`의 `admin`/`super_admin` 역할 또는 `ADMIN_EMAILS`에 등록된 사용자의 호출만 허용되어야 합니다.

## 보안 기준

- `travel-sources`는 공개 버킷이 아니며 객체 경로의 두 번째 구간이 현재 `auth.uid()`와 같을 때만 접근됩니다.
- PDF/HWPX 객체당 최대 크기는 4 MiB입니다. 애플리케이션은 두 원본의 합계도 4 MiB 이하로 제한합니다.
- 신규 Supabase 프로젝트의 Data API 자동 권한에 의존하지 않고 `authenticated`와 `service_role` 권한을 명시적으로 부여합니다.
- 관리자 판정은 서버에서 검증한 Auth 사용자와 서버 비밀값으로만 수행합니다.
- Edge Function의 `@supabase/supabase-js`는 `2.112.2`로 고정되어 공급망 변경이 예고 없이 반영되지 않습니다.
