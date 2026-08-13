# 작업 인수인계

- 마지막 작업: 2026. 08. 13. 코드 점검 지적사항 11건 수정에 이어, 금액을 조용히 0원으로 바꾸던 문제를 잡음(계산기는 경고를 남기고 저장 API는 400으로 거부)
- 다음 할 일: 호스팅 프로젝트에 Secure password change를 켜고 Function secret `ALLOWED_ORIGINS`에 배포 주소를 등록한 뒤, 비밀번호 변경·비밀번호 재설정 메일·운임 조회를 실제 배포에서 한 번씩 확인
- 주의사항: 금액은 `wonAmount()`로만 읽고 `Number(...) || 0`을 새로 쓰지 말 것. `pdfjs-dist`를 올릴 때는 `npm run sync:pdf-worker`를 함께 실행(테스트가 막아 줌)
