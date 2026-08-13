# 작업 인수인계

- 마지막 작업: 2026. 08. 13. 코드 점검에서 나온 보안·유지보수 이슈 11건 수정(무인증 운임 API, open redirect 3곳, 비밀번호 확인, Function CORS, pdf 워커 버전 고정, 죽은 예산 HWPX 라우트 제거 등)
- 다음 할 일: 호스팅 프로젝트에 Secure password change를 켜고 Function secret `ALLOWED_ORIGINS`에 배포 주소를 등록한 뒤, 비밀번호 변경·비밀번호 재설정 메일·운임 조회를 실제 배포에서 한 번씩 확인
- 주의사항: `pdfjs-dist`를 올릴 때는 반드시 `npm run sync:pdf-worker`를 함께 실행(테스트가 막아 줌). A4 인쇄와 Excel 출력 양식은 이번에도 손대지 않음
