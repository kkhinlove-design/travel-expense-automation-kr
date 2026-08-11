# Vercel 배포 안내

이 문서는 Next.js 앱 배포 흐름을 설명합니다. 데이터베이스·Storage·Edge Functions의 상세 명령은 [Supabase 설정 안내](./SUPABASE_SETUP.md)를 따릅니다.

## 준비 사항

- GitHub, Vercel, Supabase 계정
- Node.js 22 이상과 npm
- 기관 전용 Supabase 프로젝트
- 최초 관리자 이메일
- 선택 사항: 공공데이터포털 TAGO 일반인증키

## 권장 순서

1. Supabase 프로젝트를 만들고 스키마, RLS, 비공개 Storage 버킷, Edge Functions를 적용합니다.
2. Auth의 최초 관리자 계정을 만들고 관리자 이메일을 기록합니다.
3. README의 **Deploy with Vercel** 버튼으로 저장소와 Vercel 프로젝트를 만듭니다.
4. Vercel의 Production·Preview·Development 환경에 필요한 환경변수를 설정합니다.
5. Production 배포 주소를 Supabase Auth Site URL과 허용 Redirect URL에 추가합니다.
6. 새 배포를 실행한 뒤 아래 점검표를 확인합니다.

Vercel 빌드 과정에서 `supabase db push`나 관리자 생성을 실행하지 마세요. Preview 배포마다 데이터베이스 변경이 반복될 수 있고, 빌드 환경에 과도한 권한을 두게 됩니다.

## 환경 구분

| Vercel 환경 | 권장 Supabase 연결 |
| --- | --- |
| Production | 운영 전용 프로젝트 |
| Preview | 테스트 전용 프로젝트 또는 쓰기 기능을 제한한 프로젝트 |
| Development | 로컬 개발 프로젝트 |

Preview가 운영 Supabase를 공유하면 PR 코드가 실제 출장 데이터에 접근할 수 있습니다. 외부 기여자의 Preview에는 운영 환경변수를 제공하지 않는 구성이 안전합니다.

## Git 기반 배포

Vercel Git Integration을 연결하면 `main` push는 Production, PR과 다른 브랜치는 Preview 배포가 됩니다. 이 저장소의 GitHub Actions는 테스트와 빌드만 수행하며 배포 권한이나 Vercel 토큰을 요구하지 않습니다.

수동 확인이 필요하면 로컬에서 다음을 실행합니다.

```bash
npm ci
npm test
npm run build
```

Vercel CLI를 사용하는 경우 먼저 새 프로젝트에 정확히 연결됐는지 확인하고 환경변수를 가져오세요.

```bash
npx vercel link
npx vercel env pull .env.local
```

`.vercel/project.json`과 `.env.local`은 커밋하지 않습니다.

## 배포 후 점검

- `/signin`에서 관리자 계정 로그인
- `/admin`에서 직원 1명 생성 후 해당 계정 로그인
- PDF 단독, HWPX 단독, 두 파일 동시 업로드
- 출장 저장 후 다른 브라우저 새로고침에서 재조회
- 저장한 출장과 원본 삭제
- 공용 및 개인 운임 등록·자동 적용
- Ollama 미연결 상태의 규칙형/WebGPU 대체 동작
- A4 인쇄 미리보기에서 신청서 세로, 지출명세서 가로, 복명서 1쪽 확인

## 롤백과 데이터 변경

앱 문제는 Vercel의 이전 정상 배포를 Production으로 승격하거나 Rollback할 수 있습니다. 데이터베이스 마이그레이션은 앱 롤백과 별개이므로, 파괴적 변경은 백업·역방향 절차·호환 기간을 먼저 준비하세요.
