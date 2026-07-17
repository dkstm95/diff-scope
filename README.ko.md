<p align="center">
  <img src="plugins/diff-scope/assets/telescope.svg" width="128" alt="DiffScope 망원경 아이콘">
</p>

<h1 align="center">DiffScope</h1>

<p align="center"><strong>AI가 방금 완료한 코드를 승인하기 전에 이해하세요.</strong></p>

<p align="center">
  <a href="https://dkstm95.github.io/diff-scope/demo/"><strong>설치 없이 데모 체험하기</strong></a>
  ·
  <a href="README.md">English</a>
</p>

합성 예제로 브라우저에서 먼저 시작할 수 있다. 설치, 저장소, API 키가
필요 없다. 데모는 `main`에서 배포되므로 첫 GitHub Pages 배포가
완료되기 전에는 링크에서 404가 보일 수 있다.

설치한 다음에는 Codex에 자연어로 요청하면 된다.

```text
방금 완료한 로컬 변경을 설명하고, 내 이해도를 퀴즈로 확인한 다음 직접 탐색하게 해줘.
```

DiffScope는 한 작업 단위로 완료된 로컬 코드 변경을 서로 연결된 세 가지
학습 결과물로 만든다.

- **설명(Explain)** — before-to-after 동작, 인과 흐름, 판단, 위험, 근거를 본다.
- **확인(Check)** — 예측과 invariant에 대한 자동 채점 퀴즈를 풀어본다.
- **탐색(Explore)** — 오프라인 인터랙티브 마이크로월드에서 입력을 바꿔 변경된
  동작을 직접 살펴본다.

**Alpha 범위:** staged, unstaged, 안전한 untracked 텍스트를 포함한, 완료된 로컬
`HEAD -> working tree` 변경 하나만 다룬다. ChatGPT 구독으로 활성화한 Codex
세션 안에서 동작하며 API 키, 모델 provider 설정, 별도 서버가 필요 없다.

> **Alpha:** `v0.1.1-alpha`는 공개 dogfooding 빌드에 첫 사용 데모와 영문·한국어
> 결과물을 추가한다. 인터페이스와 artifact schema는 계속 바뀔 수 있다.

## 설치

Git, Node.js 20 이상, ChatGPT 구독으로 로그인한 Codex가 필요하다.

Codex에 다음 요청을 복사해 넣는다.

```text
https://github.com/dkstm95/diff-scope에서 DiffScope v0.1.1-alpha를 설치해줘.
diff-scope@diff-scope가 활성화됐는지 확인한 다음, 새 Codex 작업을 시작하라고 알려줘.
아직 $diff는 실행하지 마.
```

또는 CLI를 사용한다.

```bash
codex plugin marketplace add dkstm95/diff-scope --ref v0.1.1-alpha
codex plugin add diff-scope@diff-scope
```

설치 후 새 Codex 작업을 시작해야 `$diff`가 로드된다.

## 사용

로컬 코드 작업 하나를 완료하고 새 Codex 작업을 시작한 다음 자연어로 요청한다.

```text
방금 완료한 로컬 변경을 설명하고, 내 이해도를 퀴즈로 확인한 다음 직접 탐색하게 해줘.
```

또는 skill을 직접 호출한다.

```text
$diff
```

기본적으로 비공개 임시 디렉터리에 다음 결과를 만든다.

- `artifact.json`: 수집된 context에 정확히 연결해 검증한 원본 데이터
- `explanation.md`: 목표, 인과 흐름, 결정, 위험, 검증 근거
- `index.html`: 설명, 자동 채점 퀴즈, 오프라인 마이크로월드

결과를 보존하려면 durable output directory를 요청한다.

## Alpha 범위

DiffScope는 다음 범위만 분석한다.

```text
HEAD -> 현재 working tree
```

staged, unstaged, 안전한 untracked 텍스트를 포함한다. Alpha에서는 현재
working tree가 완료된 작업 하나만 담고 있다고 전제한다. 서로 무관한 변경은
`$diff`를 호출하기 전에 분리해야 한다.

commit range, branch, pull request, remote 변경, API provider, CI batch 생성,
binary, generated file, lockfile은 이번 릴리스 지원 범위가 아니다.

## 안전 경계

선택된 범위의 저장소 내용은 활성 Codex 서비스를 통해 처리된다. 로컬
collector는 파일 수, 변경 줄, byte, 시간을 제한하고, 일반적인 secret 경로를
차단하며, 의심되는 credential을 가리고, 외부 Git diff helper를 비활성화한다.
저장소 내용은 신뢰하지 않는 입력으로 취급한다.

최종 HTML은 고정 runtime으로 렌더링한다. 모델이 작성한 HTML, CSS,
JavaScript, SVG, URL, shell command를 실행하지 않고 네트워크도 필요 없다.
Secret 탐지는 보조 장치일 뿐 완전한 보장이 아니므로 민감한 저장소에서는
수집 범위를 먼저 확인해야 한다.

## 개발

deterministic collector, validator, renderer, quiz, microworld runtime은 Node.js
built-in만 사용한다. 테스트는 Codex나 네트워크를 호출하지 않는다.

```bash
npm test
npm run check
```

```text
.agents/plugins/marketplace.json     Codex marketplace
plugins/diff-scope/                  배포 플러그인
  .codex-plugin/plugin.json
  skills/diff/                       공통 skill과 deterministic runtime
test/                                collector와 renderer 테스트
tools/check-release.mjs              릴리스 일관성 검사
```

개발 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안 취약점 제보 방법은
[SECURITY.md](SECURITY.md)를 참고한다.

## 라이선스

[MIT](LICENSE)
