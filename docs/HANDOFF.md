# 작업 인수인계

- 마지막 작업: 2026. 10. 23. 보안 패치 — Next.js 15.5.23→15.5.28(sharp 0.35.5) 업그레이드, 2026. 10. 14. Next.js 보안 권고 대응. 로컬 빌드 통과 후 main 푸시(92ff437).
- 다음 할 일(긴급): 운영 Vercel 프로젝트 budget-change-workroom은 CLI 수동 배포(e1c16f4, Next 15.5.23) 상태. 이 폴더에서 `vercel link --project budget-change-workroom` 후 `vercel --prod` 또는 `vercel git connect`로 Git 자동배포 연결 필요.
- (이전) 2026. 09. 02. 가상 직원·합성 승인 PDF로 로그인부터 파싱, 여비 계산, Ollama 복명서, Excel·A4 출력까지 3분짜리 Full HD 전 직원 사용 영상을 제작
- 다음 할 일: 직원 2~3명에게 영상과 실제 사이트를 먼저 배포해 첫 로그인·승인 문서 파싱·출력 흐름을 점검한 뒤 전 직원 공지에 첨부
- 주의사항: 데모 영상은 김하늘이라는 가상 직원과 합성 승인 문서만 사용하며 생성 영상·중간 파일은 `output/`·`tmp/`에 두고 Git 저장소에는 커밋하지 않는다
