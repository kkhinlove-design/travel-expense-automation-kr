# 출장서류 자동화 KR

승인된 출장신청 PDF와 원본 HWPX를 읽어 출장 정보를 확인하고, 여비 계산부터 여비지급신청서·지출명세서·출장복명서의 A4 출력까지 이어 주는 한국어 Next.js 웹앱입니다.

[![CI](https://github.com/kkhinlove-design/travel-expense-automation-kr/actions/workflows/ci.yml/badge.svg)](https://github.com/kkhinlove-design/travel-expense-automation-kr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Deploy with Vercel](https://vercel.com/button)][vercel-deploy]

> 이 프로젝트는 기관별 규정을 입력·검토하는 업무 보조 도구입니다. 계산 결과와 제출 서류는 반드시 담당자가 원문 규정 및 증빙과 대조해 확정하세요.

## 주요 기능

- 승인 PDF, 원본 HWPX 또는 두 파일을 함께 업로드해 표 구조 기반으로 출장 정보 추출
- 여러 출장자, 경유지, 가는 길·오는 길이 다른 운임을 개별 반영
- 개인차·법인차, 장기 체류, 식사 제공 등 출장 규칙에 따른 여비 자동 계산
- 개인·공용 운임을 직접 입력하거나 엑셀 양식으로 일괄 등록
- 여비지급신청서, 지출명세서, 출장복명서를 기존 방향에 맞춰 A4 인쇄
- Supabase 이메일/비밀번호 로그인, 직원 일괄 등록, 사용자별 출장·원본 저장 및 삭제
- 내 PC의 Ollama 또는 브라우저 WebGPU로 출장복명서 초안 작성
- 국토교통부 TAGO 열차·고속버스·시외버스 운임 조회(선택 기능)

## 화면 미리보기

![출장서류 자동화 KR 화면 미리보기](./public/og-travel.png)

## 3단계 빠른 시작

### 1. Supabase 준비

새 Supabase 프로젝트를 만들고 [Supabase 설정 안내](./docs/SUPABASE_SETUP.md)에 따라 데이터베이스 마이그레이션, 비공개 Storage 버킷, Edge Functions와 최초 관리자 계정을 준비합니다.

### 2. Vercel 배포

[![Deploy with Vercel](https://vercel.com/button)][vercel-deploy]

배포 화면에서 Supabase URL, publishable key와 최초 관리자 이메일을 입력합니다. 쉬운 초기 설정은 같은 이메일을 Vercel의 `NEXT_PUBLIC_ADMIN_EMAIL`과 Supabase Function secret `ADMIN_EMAILS`에 모두 넣는 방식입니다. 이후 `app_metadata.role=admin`을 안전한 Admin API로 부여하면 이메일 fallback 없이 운영할 수 있습니다. Deploy 버튼은 앱을 복제·배포하지만 Supabase 스키마와 Edge Functions를 대신 적용하지는 않습니다.

### 3. 연결 확인

Supabase Auth의 Site URL과 Redirect URL을 실제 Vercel 주소로 설정한 뒤 관리자 계정으로 로그인합니다. 직원 1명 생성, 샘플 문서 저장·삭제, A4 인쇄 미리보기를 차례로 확인하면 준비가 끝납니다.

자세한 운영 배포 절차는 [배포 안내](./docs/DEPLOYMENT.md)를 참고하세요.

## 로컬 개발

Node.js 22 이상이 필요합니다.

```bash
git clone https://github.com/kkhinlove-design/travel-expense-automation-kr.git
cd travel-expense-automation-kr
npm ci
cp .env.example .env.local
npm run dev
```

Windows PowerShell에서는 `cp` 대신 `Copy-Item .env.example .env.local`을 사용할 수 있습니다. 브라우저에서 `http://localhost:3000`을 여세요.

```bash
npm test
npm run build
```

## 환경변수

| 이름 | 필수 | 노출 범위 | 설명 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 예 | 브라우저 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 예 | 브라우저 | Supabase publishable key. `service_role`/secret key를 넣지 마세요. |
| `NEXT_PUBLIC_ADMIN_ROLES` | 아니요 | 브라우저 | 관리자 UI가 인정할 `app_metadata` 역할. 기본값 `admin,super_admin` |
| `NEXT_PUBLIC_ADMIN_EMAIL` | 조건부 | 브라우저 | 쉬운 최초 설치용 관리자 UI 이메일. `app_metadata.role=admin`을 쓰면 생략 가능 |
| `DATA_GO_KR_SERVICE_KEY` | 아니요 | 서버 | 공공데이터포털 TAGO 일반인증키. 없으면 운임을 직접 입력합니다. |

기관명·앱 이름·기본 출발지와 Ollama 모델 등 선택 설정은 주석이 포함된 [`.env.example`](./.env.example)에서 확인할 수 있습니다. `ALLOW_LOCAL_DEV_USER=true`는 Supabase 없이 UI를 확인하는 로컬 개발에서만 사용하고 Vercel에는 설정하지 마세요.

이메일 기반 초기 관리자를 사용할 때는 `NEXT_PUBLIC_ADMIN_EMAIL`과 별도로 Supabase Function secret `ADMIN_EMAILS`에도 같은 이메일을 설정해야 합니다. 전자는 UI 진입용 공개 힌트이고, 실제 관리자 작업 권한은 후자의 서버 allowlist가 검증합니다. 자세한 권한 구성은 [Supabase 설정 안내](./docs/SUPABASE_SETUP.md)를 따르세요.

실제 값은 `.env.local`, Vercel Environment Variables 또는 Supabase Function secrets에만 저장하세요. 비밀키를 Git, 이슈, 빌드 로그에 올리지 마세요.

## 개인정보와 로컬 AI

- PDF/HWPX 분석은 브라우저에서 이루어지며, 사용자가 **저장**할 때만 구조화된 출장 정보와 원본이 자신의 Supabase 프로젝트로 전송됩니다.
- Ollama는 브라우저가 `127.0.0.1:11434`에 직접 연결해 추론합니다. WebGPU 대체 모드도 프롬프트 추론을 브라우저 안에서 수행합니다.
- TAGO 조회를 사용하면 출발지·도착지·조회일이 앱 서버를 거쳐 공공데이터포털로 전송됩니다.
- 출장 문서에는 개인정보가 포함될 수 있습니다. 기관의 보존기간, 접근권한 및 파기 정책을 적용하세요.

세부 내용은 [개인정보 및 데이터 흐름](./docs/PRIVACY.md)과 [로컬 AI 설정](./docs/LOCAL_AI.md)을 확인하세요.

## 알려진 제한사항

- 구형 `.hwp`는 지원하지 않습니다. 한글에서 `.hwpx`로 다시 저장하세요.
- PDF와 HWPX 원본의 합계는 한 출장당 4MB 이하여야 합니다.
- 스캔 이미지만 있는 PDF는 OCR이 없어 자동 추출 정확도가 낮습니다.
- 문서 양식이 달라지거나 표가 크게 수정되면 추출값을 직접 보정해야 합니다.
- TAGO에 노선·일자 데이터가 없으면 저장 운임 또는 실제 증빙 금액을 입력해야 합니다.
- 브라우저, 프린터 드라이버, 여백 설정에 따라 출력 결과가 달라질 수 있습니다. Chrome/Edge의 A4 미리보기에서 배율 100%와 배경 그래픽을 확인하세요.
- 기본 구성은 한 기관이 별도 Supabase 프로젝트와 배포를 운영하는 방식입니다. 여러 기관을 한 배포에 혼합하는 멀티테넌시는 제공하지 않습니다.

## 문서

- [Supabase 설정](./docs/SUPABASE_SETUP.md)
- [Vercel 및 운영 배포](./docs/DEPLOYMENT.md)
- [로컬 AI와 Ollama](./docs/LOCAL_AI.md)
- [개인정보 및 데이터 흐름](./docs/PRIVACY.md)
- [기여 방법](CONTRIBUTING.md)
- [보안 정책](SECURITY.md)

## 기여

버그 재현, 양식 호환성 개선, 테스트 보강을 환영합니다. 개인정보가 포함된 실제 출장 문서는 이슈나 PR에 첨부하지 말고 재현용으로 비식별화한 최소 샘플을 사용해 주세요. 자세한 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를 확인하세요.

## 라이선스

[MIT License](LICENSE)

[vercel-deploy]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkkhinlove-design%2Ftravel-expense-automation-kr&project-name=travel-expense-automation-kr&repository-name=travel-expense-automation-kr&env=NEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CNEXT_PUBLIC_ADMIN_EMAIL&envDescription=Supabase%20URL%2C%20publishable%20key%EC%99%80%20%EC%B5%9C%EC%B4%88%20%EA%B4%80%EB%A6%AC%EC%9E%90%20%EC%9D%B4%EB%A9%94%EC%9D%BC%EC%9D%84%20%EC%9E%85%EB%A0%A5%ED%95%98%EC%84%B8%EC%9A%94.%20%EA%B0%99%EC%9D%80%20%EC%9D%B4%EB%A9%94%EC%9D%BC%EC%9D%84%20Supabase%20Function%20secret%20ADMIN_EMAILS%EC%97%90%EB%8F%84%20%EC%84%A4%EC%A0%95%ED%95%A9%EB%8B%88%EB%8B%A4.&envLink=https%3A%2F%2Fgithub.com%2Fkkhinlove-design%2Ftravel-expense-automation-kr%2Fblob%2Fmain%2Fdocs%2FSUPABASE_SETUP.md
