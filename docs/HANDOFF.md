# 작업 인수인계

- 마지막 작업: 2026. 08. 18. 출발 기준지·결재라인·관리자 편집·A4/Excel·Kordoc 교차 파싱과 Supabase 보강을 운영 반영하고 Vercel 프로덕션을 배포했으며, Kordoc의 동적 `cfb` 의존성이 함수 trace에서 빠지는 운영 500을 재현해 필수 패키지 강제 포함과 빌드 가드로 수정
- 다음 할 일: 수정 배포의 Kordoc API 401 및 실제 비식별 HWPX 업로드를 스모크 테스트하고, 자동 운임 적용과 A4 세로·가로·세로 출력 흐름을 지속 모니터링
- 주의사항: 공유 Supabase의 과거 migration 이력이 이 저장소와 달라 전체 `db push`는 금지하고 단일 migration만 적용해야 하며, 출장 앱 밖의 `billing` Function(JWT 미검증)과 leaked-password protection 경고는 별도 서비스 영향 검토 후 조치
