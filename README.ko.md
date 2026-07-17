<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope 망원경 아이콘">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>의도를 맞추고, 변경을 이해하고, 사람이 코드 안에 남게 하세요.</strong></p>

<p align="center"><a href="README.md">English</a></p>

Hope는 AI가 코드를 작성하는 동안 사람이 방향과 이해를 잃지 않도록 돕는다.
대화 기록 속에서 쉽게 사라지는 두 순간을 연결한다.

- `$hope:align`은 코딩 전에 목표, 결정, 제약, 비목표, 예상 시나리오를 확정한다.
- `$hope:diff`는 승인된 의도를 정확한 로컬 변경과 연결하고, 실제 결과를 설명하고,
  이해도를 확인하며, 동작을 직접 탐색하게 한다.

두 skill 모두 현재 활성 Codex 구독 세션 안에서 동작한다. API 키, 모델 설정,
별도 서버, 중첩 모델 호출이 필요 없다.

> **Alpha:** `v0.2.0-alpha`는 구독 사용자와 하나의 로컬 작업 단위만 지원한다.
> Dogfooding 결과에 따라 인터페이스와 schema가 바뀔 수 있다.

## 설치

Git, Node.js 20 이상, ChatGPT 구독으로 로그인한 Codex가 필요하다.

DiffScope `v0.1.0-alpha`를 설치했다면 Hope를 설치하기 전에 기존 플러그인과
marketplace를 제거한다.

```bash
codex plugin remove diff-scope@diff-scope
codex plugin marketplace remove diff-scope
```

이후 Hope를 설치한다.

```bash
codex plugin marketplace add dkstm95/hope --ref v0.2.0-alpha
codex plugin add hope@hope
```

설치 후 새 Codex 작업을 시작해야 `$hope:align`과 `$hope:diff`가 로드된다.

## 사용

### 1. 코딩 전에 의도 맞추기

깨끗한 working tree에서 호출한다.

```text
$hope:align
```

원하는 변경을 설명한다. Hope와 Codex는 사용자의 판단이 필요한 미해결 선택만
드러내며, 결정 카드 수에 임의의 상한을 두지 않는다. 사용자가 명시적으로
승인하면 Hope는 변경 불가능한 intent revision을 비공개 OS 임시 디렉터리에
기록하고 현재 `HEAD`에 연결한다.

반환된 `intent.json` 경로를 보관한다. `$hope:diff`는 이 입력을 사용해 구현 이후
의도를 재구성하지 않고, 실제로 승인했던 내용과 코드를 비교한다.

### 2. 하나의 작업 단위 구현하기

평소처럼 Codex와 작업한다. 하나의 일관된 경계를 검토할 수 있도록 관련 없는
변경은 working tree에서 분리한다.

구현을 시작한 뒤 요구 의도가 바뀌어도 승인한 revision을 실제 코드에 맞춰
다시 작성하지 않는다. 이 alpha는 dirty working tree에서 대체 revision을
확정하지 못한다. 사용자의 통제 아래 현재 작업을 완료·되돌리기·분리한 뒤 다음
clean 경계에서 `$hope:align`을 실행하거나, `$hope:diff`가 현재 불일치를 검토 대상으로
보고하게 한다.

### 3. 승인하거나 머지하기 전에 이해하기

작업 단위 구현을 마치면 호출한다.

```text
$hope:diff
```

승인된 `intent.json`이 있다면 그 경로를 `$hope:diff`에 전달한다. Hope는 정확한
`HEAD -> working tree` snapshot을 수집하고, review를 변경 불가능한 intent
revision과 변경 fingerprint 모두에 연결한다. 이후 충족된 의도, 사용자의 검토가
필요한 이탈, 해결되지 않은 불일치, 코드 근거를 구분한다.

`$hope:align` 없이 `$hope:diff`만 사용할 수도 있다. 이 경우 코드 근거를 바탕으로 변경을
설명하고 가르칠 수 있지만, 구현이 사전에 승인된 의도와 일치한다고 주장할 수는
없다.

## 학습 번들

Hope는 기본적으로 비공개 임시 디렉터리에 하나의 번들을 만든다.

- `artifact.json`: 전달된 intent revision과 정확한 변경에 연결해 검증한 원본
  데이터
- `explanation.md`: 목표, 인과 흐름, 의도 비교, 결정, 위험, 근거
- `index.html`: 설명, 자동 채점 퀴즈, 오프라인 인터랙티브 마이크로월드

번들의 고정 UI와 label은 영어를 사용한다. AI가 작성한 설명, 퀴즈 문항,
마이크로월드 내용은 사용자의 작업 언어를 따른다.

번들은 review를 돕지만 퀴즈 통과가 완전한 이해를 증명하지는 않는다. Working
tree가 바뀌면 이전 review는 stale 상태이며 현재 결과처럼 제시해서는 안 된다.

Hope는 이 번들을 commit하지 않고, `.hope/` archive를 만들지 않고,
`.gitignore`를 수정하거나 결과를 게시하지 않는다. 생성된 설명, 퀴즈 상태,
마이크로월드는 프로젝트 문서가 아니라 필요할 때 다시 만들 수 있는 view다.
감사나 교육 목적으로 명시적으로 고정하지 않았다면 merge 후 `artifact.json`을
포함한 번들 전체를 폐기한다.

## 문서 부채 없이 인지 부채 줄이기

AI가 만든 모든 산출물을 머지 후에도 남기면 코드와 어긋날 수 있는 또 하나의
유지보수 대상이 된다. Hope는 작업 중 학습 도구와 장기 보존할 지식을 구분한다.

머지 전에 `$hope:diff`는 승격할 가치가 있는 지식 후보를 제시할 수 있다. Git과
코드만으로 복원하기 어렵고, 미래 판단에 영향을 주며, 머지 후에도 유효하고,
사람이 확인한 내용만 기존 SSOT에 반영한다.

- 동작 계약과 경계 사례는 테스트, 타입, assertion, fixture에 둔다.
- 국소적이고 비자명한 이유는 해당 코드 가까이에 둔다.
- 아키텍처 결정은 프로젝트의 ADR이나 설계 문서에 둔다.
- 운영 제약은 runbook에 둔다.
- 작은 변경의 이유는 commit이나 pull request에 둔다.

개인 퀴즈 답변과 생성된 HTML은 저장소에 넣지 않는다. 원칙은 **의도는
보존하고, 설명은 다시 만들며, 이해는 실제로 확인한다**이다.

## Alpha 범위

`$hope:align`은 깨끗한 working tree에서만 intent를 확정한다. `$hope:diff`는 다음 범위만
분석한다.

```text
HEAD -> 현재 working tree
```

staged, unstaged, 안전한 untracked 텍스트를 포함한다. 현재 working tree에는
완료된 작업 단위 하나만 있어야 한다.

추적된 변경을 숨길 수 있는 `skip-worktree`와 `assume-unchanged` index flag를
거부하므로 sparse worktree는 이번 alpha 범위에 포함하지 않는다.

commit range, branch, pull request, remote 또는 타인의 변경, API provider, CI
batch 생성, binary, generated file, lockfile은 이번 릴리스 지원 범위가 아니다.

## 안전 경계

선택된 범위의 저장소 내용은 활성 Codex 서비스를 통해 처리된다. 로컬
collector는 파일 수, 변경 줄, byte, 시간을 제한하고, 일반적인 secret 경로를
차단하며, 의심되는 credential을 가리고, 외부 Git diff helper를 비활성화한다.
저장소 내용은 신뢰하지 않는 입력으로 취급한다.

최종 HTML은 고정 runtime으로 렌더링한다. 모델이 작성한 HTML, CSS,
JavaScript, SVG, URL, shell command를 실행하지 않고 네트워크도 필요 없다.
Secret 탐지는 보조 장치일 뿐 완전한 보장이 아니므로 민감한 저장소에서는
선택된 범위를 먼저 확인해야 한다.

## 개발

deterministic collector, validator, renderer, quiz, microworld runtime은 Node.js
built-in만 사용한다. 테스트는 Codex나 네트워크를 호출하지 않는다.

```bash
npm test
npm run check
```

```text
.agents/plugins/marketplace.json     Codex marketplace
plugins/hope/                        배포 플러그인
  .codex-plugin/plugin.json
  skills/align/                      승인된 의도 workflow
  skills/diff/                       변경 이해 workflow와 runtime
test/                                deterministic contract와 runtime 테스트
tools/check-release.mjs              릴리스 일관성 검사
```

개발 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안 취약점 제보 방법은
[SECURITY.md](SECURITY.md)를 참고한다.

## 라이선스

[MIT](LICENSE)
