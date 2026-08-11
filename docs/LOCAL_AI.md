# 로컬 AI와 Ollama 설정

출장복명서 초안은 외부 생성형 AI API 없이 작성할 수 있습니다.

## 처리 순서

1. 브라우저가 내 PC의 Ollama(`127.0.0.1:11434`)를 확인합니다.
2. 연결되면 설치된 모델 중 Qwen 계열을 우선 사용합니다.
3. Ollama가 없고 WebGPU를 지원하면 브라우저용 Qwen 모델로 전환합니다.
4. 둘 다 사용할 수 없으면 입력 사실을 정리한 규칙형 초안을 만듭니다.

WebGPU 모드는 최초 사용 시 모델 파일을 내려받을 수 있지만 출장 프롬프트의 추론은 브라우저에서 수행합니다.

## Ollama 설치

1. [Ollama 공식 사이트](https://ollama.com/download)에서 운영체제용 앱을 설치합니다.
2. 터미널에서 모델을 내려받습니다.

```bash
ollama pull qwen2.5:7b
ollama list
```

3. Ollama 앱을 실행한 상태에서 출장서류 자동화 화면의 **다시 연결**을 누릅니다.

PC 사양이 낮으면 `qwen2.5:3b`처럼 더 작은 Qwen 모델을 선택하고, 충분한 메모리가 있으면 기관의 품질 기준에 맞는 큰 모델을 사용할 수 있습니다. 기본 추천 모델은 `NEXT_PUBLIC_OLLAMA_PULL_MODEL`로 바꿀 수 있습니다.

## 배포 사이트 허용

Ollama는 허용된 웹 출처에서만 브라우저 연결을 받습니다. 실제 배포 주소와 로컬 주소만 정확히 허용하고 `*`는 사용하지 마세요.

Windows PowerShell에서 사용자 환경변수를 설정하는 예시입니다.

```powershell
[Environment]::SetEnvironmentVariable(
  "OLLAMA_ORIGINS",
  "https://your-app.vercel.app,http://localhost:3000",
  "User"
)
```

macOS에서는 다음과 같이 설정할 수 있습니다.

```bash
launchctl setenv OLLAMA_ORIGINS "https://your-app.vercel.app,http://localhost:3000"
```

설정 후 Ollama를 완전히 종료했다가 다시 실행하세요. 회사에서 배포 도메인을 바꾸면 허용 주소도 갱신해야 합니다.

Ollama가 다른 로컬 주소에서 실행되는 경우 `NEXT_PUBLIC_OLLAMA_BASE_URL`을 바꿀 수 있습니다. 이 값은 브라우저에 공개되므로 인증 토큰이나 비밀정보를 포함하지 마세요.

## 보안 주의사항

- Ollama 포트 11434를 공유기 포트포워딩, 공인 IP, Cloudflare Tunnel 등으로 공개하지 마세요.
- `OLLAMA_HOST=0.0.0.0` 같은 전체 인터페이스 공개 설정은 공동 서버를 별도로 보호할 때만 검토하세요.
- 생성된 복명서는 초안입니다. 기관명, 일시, 참석자, 성과와 후속 조치를 제출 전에 확인하세요.
- 공용 PC에서는 모델 캐시, 브라우저 다운로드, 최근 문서 흔적의 삭제 정책을 확인하세요.

## 문제 해결

- **연결할 수 없음**: Ollama 앱 실행 여부와 `http://127.0.0.1:11434/api/tags` 응답을 확인합니다.
- **브라우저에서만 실패**: `OLLAMA_ORIGINS`에 현재 사이트의 정확한 `https://` 주소가 있는지 확인합니다.
- **모델 없음**: `ollama list`를 확인하고 Qwen 모델을 하나 이상 내려받습니다.
- **느림 또는 메모리 부족**: 작은 모델을 사용하거나 WebGPU/규칙형 초안으로 전환합니다.
- **WebGPU 미지원**: 최신 Chrome 또는 Edge와 그래픽 드라이버를 사용합니다.
