<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope 망원경 아이콘">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>변경을 보고, 이유를 이해하고, 사람이 코드 안에 남게 하세요.</strong></p>

<p align="center"><a href="README.md">English</a></p>

Hope는 pull request를 승인하거나 머지하기 전에 사람이 변경을 이해하도록 돕는다.
`$hope:diff`에 GitHub pull request URL을 주면 정확한 변경을 하나의 시각적이고
인터랙티브한 review로 바꾼다. 코드 근거에 기반한 설명, 자동 채점 퀴즈, 동작을
탐색하는 선택적 microworld가 포함된다.

Hope는 현재 활성 Codex 구독 세션 안에서 동작한다. OpenAI API 키, 모델 설정,
별도 서버, 중첩 모델 호출, 캐시, 데이터베이스가 필요 없다.

> **Alpha:** `v0.3.0-alpha`는 GitHub pull request에 집중한다. Dogfooding
> 결과에 따라 인터페이스와 schema가 바뀔 수 있다.

## 설치

다음이 필요하다.

- Node.js 20 이상
- 대상 pull request에 접근할 수 있도록 인증한
  [GitHub CLI](https://cli.github.com/) (`gh auth login`)
- ChatGPT 구독으로 로그인한 Codex

태그가 지정된 marketplace에서 Hope를 설치한다.

```bash
codex plugin marketplace add dkstm95/hope --ref v0.3.0-alpha
codex plugin add hope@hope
```

이전 Hope 또는 DiffScope alpha가 설치되어 있다면 기존 plugin과 marketplace를
제거한 뒤 위 명령을 실행한다.

```bash
codex plugin remove hope@hope
codex plugin marketplace remove hope
codex plugin remove diff-scope@diff-scope
codex plugin marketplace remove diff-scope
```

설치 후 새 Codex 작업을 시작해야 `$hope:diff`가 로드된다.

## 사용

### 1. Hope에 pull request URL 전달하기

```text
$hope:diff https://github.com/owner/repository/pull/123
```

Hope는 기존 `gh` 인증으로 GitHub pull request를 조회하고 merge base에서 head까지
비교 범위를 수집한다. 로컬 clone이나 checkout은 필요 없다. 여러 commit으로
구성된 pull request도 하나의 Change Request이자 하나의 review로 다룬다.

본인이 만든 pull request와 다른 사람이 만든 pull request에 같은 흐름을 사용한다.
Open, draft, merged, closed 상태를 review에 그대로 표시하며, review 준비가 된 open
pull request가 이번 alpha의 기본 사용 사례다.

Hope는 base, merge-base, head SHA를 기록한다. 렌더링 전후에 pull request를 다시
확인하고, 생성 중 force-push, base 갱신, 관련 metadata 변경이 생기면 서로 다른
snapshot을 섞어 보여주지 않고 결과를 취소한다.

### 2. Hope Review 탐색하기

Hope는 비공개 self-contained 파일 하나를 반환한다.

```text
hope-review.html
```

로컬 browser에서 열면 된다. 네트워크 연결 없이 다음 내용을 볼 수 있다.

- pull request에 선언된 목표와 코드에서 관찰한 실제 동작
- 변경을 명확하게 만드는 before/after panel, flow, decision table 시각화
- 선택한 코드 근거와 설명을 연결한 literate diff
- 결정, 불변식, 위험, 미확인 사항, 명시적인 검증 한계
- 예측과 위험 추론을 포함한 자동 채점 문제 3~5개
- 탐색이 이해에 도움이 될 때만 제공하는 interactive microworld
- 작성자에게 물어볼 가치가 있는 질문
- 프로젝트의 장기 지식으로 승격할 수 있는 선택적 후보

Microworld는 의도적으로 선택 사항이다. 다이어그램과 퀴즈가 더 적합한 변경에
장식용 simulator를 만들지 않는다.

고정 UI는 영어를 사용하고, AI가 작성한 설명과 학습 내용은 사용자의 작업 언어를
따른다.

## 산출물 관리가 필요 없는 하나의 review

Hope는 내부에서 크기가 제한된 구조화 context와 검증된 review model을 사용하지만
모두 일시적이다. 렌더링 또는 처리된 실패 후 제거하며 `intent.json`,
`artifact.json`, 별도 Markdown 설명을 사용자 산출물로 만들지 않는다.

기본 HTML은 비공개 OS 임시 디렉터리에 둔다. Hope는 다음 작업을 하지 않는다.

- `.hope/` 디렉터리 생성 또는 `.gitignore` 수정
- 캐시, registry, database, 검색용 review index 유지
- review commit 또는 pull request 첨부
- comment 게시, approve, close, merge
- 지식 후보를 대상 저장소에 자동 반영

사용자가 명시적으로 요청하면 HTML을 원하는 경로로 export할 수 있다. 이 경우에도
기존 파일을 덮어쓰거나 자동 게시하지 않는다.

Review는 background에서 최신 상태를 유지하는 문서가 아니라 수집한 pull request
snapshot에 연결된 view다. Head나 base가 바뀌면 `$hope:diff`를 다시 실행한다. 기본
임시 review는 프로젝트에 정리할 파일을 만들지 않는다. 검토가 끝나면 닫아도 되며
OS의 임시 파일 정책에 따라 회수된다. 명시적으로 export한 사본의 보존 여부만
사용자가 결정한다. 사람과 AI 중 누가 머지해도 되며 Hope는 머지 작업에 관여하지
않는다.

## 문서 부채 없이 인지 부채 줄이기

생성된 모든 설명을 머지 후에도 남기면 코드와 어긋날 수 있는 또 하나의 유지보수
대상이 된다. Hope는 일회성 학습 view와 프로젝트의 장기 지식을 구분한다.

Pull request는 변경 당시의 역사적 이유를 보존한다. 현재 시스템의 진실은 코드,
테스트, 타입, 프로젝트의 기존 SSOT 문서에 둔다. Hope Review는 승격할 지식 후보를
제안할 수 있지만 직접 반영하지 않는다. Git과 코드만으로 복원하기 어렵고, 미래
판단에 영향을 주며, 머지 후에도 유효하고, 사람이 확인한 내용만 승격한다.

- 동작 계약과 경계 사례는 테스트, 타입, assertion, fixture에 둔다.
- 국소적이고 비자명한 이유는 해당 코드 가까이에 둔다.
- 아키텍처 결정은 프로젝트의 ADR이나 설계 문서에 둔다.
- 운영 제약은 runbook에 둔다.
- 작은 변경의 이유는 pull request에 둔다.

원칙은 **장기 의도는 보존하고, 설명은 다시 만들며, 이해는 실제로 확인한다**이다.

## Alpha 범위

Hope는 입력을 provider와 독립적인 **Change Request**로 모델링한다. 첫 adapter는
인증된 GitHub CLI를 통해 GitHub pull request를 지원한다. Git, 로컬 저장소,
OpenAI API 키는 필요 없다. 다른 forge, OpenAI API 생성, CI batch 생성, pull
request 자동 게시 기능은 이번 alpha 범위에 포함하지 않는다.

Collector는 파일 수, 분석한 변경 줄, byte, 시간을 제한한다. Binary, generated,
lockfile, submodule, rename-only, 민감한 path, 가려진 내용은 명확한 metadata-only
coverage로 표시할 수 있다. 크기 한도로 임의의 일부 이야기만 남거나 설명할 text가
하나도 없으면 review를 만들지 않는다.

## 안전 경계

Pull request의 title, body, commit 제목, path, patch, 저장소 내용은 신뢰하지 않는
입력이다. Hope는 그 안의 지시를 따르지 않는다. 사용자의 GitHub 계정이 접근할 수
있는 private pull request의 source를 포함해 선택된 source는 활성 Codex 서비스를
통해 처리된다.

Collector는 위험한 GitHub environment redirect를 제거하고, 외부 작업의 크기와
시간을 제한하고, 일반적인 secret path를 차단하고, 의심되는 credential을 가린다.
Hope가 GitHub token을 직접 읽거나 쓰지 않으며 인증은 `gh`가 관리한다.

최종 HTML은 고정 runtime으로 렌더링한다. 모델이 작성한 HTML, CSS, JavaScript,
SVG, URL, shell command를 실행하지 않고 raw patch를 포함하지 않는다. Secret
탐지는 보조 장치일 뿐 완전한 보장이 아니므로 민감한 저장소에서는 pull request
범위를 먼저 확인해야 한다.

## 개발

결정론적 adapter 경계, collector, validator, renderer, quiz, microworld runtime은
Node.js built-in만 사용한다. 테스트는 fake GitHub adapter를 사용하며 Codex나
network를 호출하지 않는다.

```bash
npm test
npm run check
```

```text
.agents/plugins/marketplace.json     Codex marketplace
plugins/hope/                        배포 플러그인
  .codex-plugin/plugin.json
  skills/diff/                       pull request 이해 workflow
test/                                결정론적 contract와 runtime 테스트
tools/check-release.mjs              릴리스 일관성 검사
```

개발 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안 취약점 제보 방법은
[SECURITY.md](SECURITY.md)를 참고한다.

## 라이선스

[MIT](LICENSE)
