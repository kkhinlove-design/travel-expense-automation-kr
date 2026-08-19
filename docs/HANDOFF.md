# 작업 인수인계

- 마지막 작업: 2026. 08. 19. Windows에서 PDF/HWPX의 브라우저 MIME이 비어 있어도 Supabase Storage 허용 형식에 맞게 표준 MIME의 바이트 배열로 원본을 저장하도록 수정하고 86개 테스트와 프로덕션 빌드를 통과
- 다음 할 일: Vercel 운영에서 실제 PDF·HWPX 원본 저장 후 `travel_trips` 행과 비공개 `travel-sources` 객체가 함께 생성되는지 확인
- 주의사항: Storage SDK에 `File`을 직접 넘기면 `options.contentType`보다 파일 자체의 빈 MIME이 사용되어 버킷에서 400이 날 수 있으므로 원본 업로드는 `uploadTravelSourceObject`의 바이트 배열 경로를 유지한다. 공유 Supabase 전체 `db push`는 실행 금지
