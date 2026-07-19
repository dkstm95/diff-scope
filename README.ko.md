<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope 망원경 아이콘">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>변경을 보고, 이유를 이해하고, 사람이 코드 안에 남게 하세요.</strong></p>

<p align="center"><a href="README.md">English</a></p>

Hope는 크고 작은 pull request를 승인하거나 머지하기 전에 사람이 변경을 이해하도록
돕는다. `$hope:diff`에 GitHub pull request URL을 주면 정확한 전체 변경을 하나의
비공개 오프라인 리뷰로 바꾼다. 무엇이 왜 바뀌었는지, 동작이 어떻게 연결되는지,
핵심 코드와 위험, 선택적인 동작 실험, 자동 채점 이해도 확인을 함께 제공한다.

Hope는 현재 활성 Codex 구독 세션 안에서 동작한다. OpenAI API 키, 모델 설정,
별도 서버, 중첩 모델 호출, 캐시, 데이터베이스가 필요 없다.

> **Alpha:** `v0.3.1-alpha`는 GitHub pull request에 집중한다. Dogfooding
> 결과에 따라 인터페이스와 schema가 바뀔 수 있다.

## 설치

다음이 필요하다.

- Node.js 20 이상
- 대상 pull request에 접근할 수 있도록 인증한
  [GitHub CLI](https://cli.github.com/) (`gh auth login`)
- ChatGPT 구독으로 로그인한 Codex

태그가 지정된 marketplace에서 Hope를 설치한다.

```bash
codex plugin marketplace add dkstm95/hope --ref v0.3.1-alpha
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

Hope는 base, merge-base, head SHA를 기록한다. 렌더링 전에는 전체 Change Request를
다시 수집해 비교하고, 렌더링 후에는 live pull request metadata를 재확인한다. 생성
중 force-push, base 갱신, 관련 metadata 변경, context 불일치가 생기면 서로 다른
snapshot을 섞어 보여주지 않고 결과를 취소한다.

### 2. 전체 변경을 점진적으로 분석하기

Hope는 하나의 완전한 Change Request와 파일 지도를 수집한 뒤 결정론적인
`analysisPlan`을 만든다. 먼저 전체 변경 summary를 읽고, 그다음 모든 pass를
순서대로 분석한다. 각 pass에는 최대 4,000개의 변경 줄과 64 KiB의 안전한 patch
text만 들어간다. 따라서 큰 pull request도 하나의 과도하게 큰 prompt나 임의로
잘린 앞부분이 아니라 여러 개의 제한된 pass로 다룬다.

Summary와 pass view는 각각 최대 16 KiB인 compact page로 전달된다. 다음 page를
받으려면 바로 앞 page의 snapshot-bound receipt가 필요하고, Review Model은 page
count와 terminal receipt를 활성 세션의 inspection attestation으로 기록한다.
Validator는 이 attestation이 정확한 결정론적 view에 연결되는지 확인하지만, AI가
page를 실제로 읽거나 이해했다는 사실까지 증명한다고 주장하지 않는다. Paging은
지원 범위 안의 파일 지도, commit 이력, patch가 AI 도구의 command output 한도에서
조용히 잘리지 않게 한다.

Pass와 stdout page는 내부 context 단위이지 사용자 산출물이나 리뷰 섹션이 아니다.
Hope는 모든 pass를 분석한 뒤 경계를 가로지르는 근거를 연결하고, 변경을 동작
흐름과 흐름 사이의 영향으로 구성한다. 이해에 필요할 때만 동작 실험 하나를 만들고,
그 뒤에 전체 변경을 다루는 이해도 확인 하나를 둔다. 사용자가 pass를 선택하거나
이름 붙이거나 저장하거나 정리할 필요는 없다.

한 pass의 한도를 넘는 것만으로 coverage가 partial이 되거나 review가 차단되지는
않으며 Hope가 제한된 pass를 하나 더 만든다. 다만 provider 데이터가 불완전하거나,
전체 안전 한도를 넘거나, 일반 text patch 또는 계획된 pass가 빠졌거나, pull
request snapshot이 오래되면 결과를 만들지 않고 중단한다.
Model에 노출될 budget은 paging 전에 확인하므로, 활성 구독 세션이 정직하게 끝낼 수
없는 변경은 분석을 시작한 뒤 멈추는 대신 명시적으로 거절한다.

### 3. Hope Review 탐색하기

Hope는 비공개 self-contained 파일 하나를 반환한다.

```text
hope-review.html
```

로컬 browser에서 열면 된다. 네트워크 연결 없이 다음 내용을 볼 수 있다.

- 짧은 리뷰 제목, 원본 PR 링크, 명확한 변경 코드 수집 범위
- 무엇이 왜 바뀌었는지와 변경 전후 동작
- 변경을 명확하게 만드는 before/after panel, flow, decision table 시각화
- 주요 동작 흐름과 흐름 사이의 영향
- 반드시 지켜야 할 조건, 위험, 결정, 검증 한계, 확인할 질문
- 핵심 코드 따라보기와, 원문이 페이지마다 반복되지 않는 하나의 근거 색인
- 탐색이 이해에 도움이 될 때 제공하는 동작 실험과, 그 뒤에 이어지는
  자동 채점 이해도 질문 3~5개
- 프로젝트의 장기 지식으로 승격할 수 있는 선택적 후보
- 정확한 PR 버전, 전체 파일 목록, 분석 범위를 담은 접힌 세부 정보

“변경 코드: 모두 확인”은 PR diff에서 바뀐 코드 부분을 모두 확인했다는 뜻이다.
PR 설명과 커밋 제목도 근거로 사용한다. 이번 alpha는 그 부분 밖의 코드, PR
토론, 리뷰 댓글, CI 결과를 수집하지 않는다.

동작 실험은 의도적으로 선택 사항이다. 다이어그램과 질문이 더 적합한 변경에는
장식용 시뮬레이터를 만들지 않는다.

고정 UI, 설명, 피드백, 학습 내용은 선택한 한국어 또는 영어 리뷰 언어를 함께
사용한다. PR 제목, 파일 경로, 명령어, 근거 인용은 원문을 유지한다.

## 산출물 관리가 필요 없는 하나의 review

Hope는 내부에서 하나의 완전한 구조화 Change Request, 크기가 제한된 inspector
pass, 검증된 review model을 사용하지만 그 상태는 모두 일시적이다. 먼저 비공개
입력을 삭제하지 않고 Review Model을 오프라인으로 검증하며, 오류가 있으면 수정해
다시 검증할 수 있다. 최종 렌더링이나 명시적인 포기 cleanup 뒤에는 비공개 입력을
제거한다. 일시적인 GitHub 오류 때는 현재 Hope 작업이 같은 렌더링을 한 번
재시도할 수 있도록 입력을 유지하며, 재시도도 실패하거나 포기하면 cleanup으로
제거해 쌓이지 않게 한다. Pass별
report, `intent.json`, `artifact.json`, 별도 Markdown 설명을 사용자 산출물로
만들지 않는다.

기본 HTML은 비공개 OS 임시 디렉터리에 둔다. Hope는 다음 작업을 하지 않는다.

- `.hope/` 디렉터리 생성 또는 `.gitignore` 수정
- 캐시, registry, database, 검색용 review index 유지
- review commit 또는 pull request 첨부
- comment 게시, approve, close, merge
- 지식 후보를 대상 저장소에 자동 반영

Hope는 새 기본 임시 review를 만들기 전에 7일이 지나 정리 대상이 된 이전 기본
review 중 Hope가 만든 것이 확실한 것만 안전하게 제거한다. 렌더링 인계에는 정확한
`eligibleAfter` 시각을 포함하며, 생성할 때 review 첫 줄에 같은 값을 한 번 기록한다.
나중에 파일을 touch해도 이 기준 시각은 바뀌지 않는다. Background process가 그
시각에 바로 지우는 것이 아니라, 그 이후 실행되는 다음 기본 렌더링에서 정리한다.
이름, 관리 표식, 구조, symbolic link 중 하나라도 예상과 다르면 보존한다.
운영체제가 소유자와 비공개 권한 검사를 제공하면 두 조건도 반드시 확인한다.
POSIX에서는 현재 사용자 전용 또는 안전한 sticky shared 임시 루트만 검사한다.

사용자가 명시적으로 요청하면 HTML을 원하는 경로로 export할 수 있다. 이 경우에도
기존 파일을 덮어쓰거나 자동 게시하지 않는다. Export에는 관리 대상 임시 파일
표식을 넣지 않아 절대 삭제 대상이 되지 않는다. OS 임시 경로의 이름이 우연히
일치하면 검사 후 거부될 수 있지만, export 자체는 Hope가 관리하지 않고 사용자가
직접 관리한다.

Review는 background에서 최신 상태를 유지하는 문서가 아니라 수집한 pull request
snapshot에 연결된 view다. Head나 base가 바뀌면 `$hope:diff`를 다시 실행한다. 기본
임시 review는 프로젝트에 정리할 파일을 만들지 않는다. 검토가 끝나면 닫아도 되며,
`eligibleAfter` 이후 실행되는 첫 기본 렌더링에서 Hope가 제거할 수 있다. OS가 더
일찍 또는 늦게 회수할 수도 있다. 명시적으로 export한 사본은 사용자만 보존 여부를
결정한다. 사람과 AI 중 누가 머지해도 되며 Hope는 머지 작업에 관여하지 않는다.

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

Collector는 전체 외부 작업, byte, 시간을 제한하고 inspector는 각 분석 pass를
최대 4,000개의 변경 줄과 64 KiB의 안전한 patch text로 제한한다. Binary,
generated, lockfile, submodule, rename-only, 민감한 path의 body는 명확한
metadata-only coverage로 표시할 수 있다. 파일 patch 어디에서든 secret 탐지가
작동하면 Hope는 그 body 전체를 patch, 분석, 근거, literate diff에서 제외한다.
파일 자체는 `bodyState: redacted`와 partial metadata-only coverage로 파일 지도에
남는다. Hope는 discovery, body, analysis coverage를 구분해 보여준다. Pass가 여러
개라는 이유만으로 partial이나 blocked가 되지는 않는다. Provider 데이터 불완전,
전체 안전 한도 초과, 일반 text 또는 pass 누락, 설명할 text 부재, 오래된
snapshot은 결과를 만들지 않고 중단한다.

현재 GitHub alpha는 정규화된 전체 변경 summary가 128 KiB 이하일 때만 commit
250개와 변경 파일 200개까지 지원한다. 전체 변경 줄은 20,000개, 파일 하나의 안전한
patch text는 256 KiB, 전체 안전한 patch text는 768 KiB까지 지원한다. Pull request
설명은 32 KiB까지 수집하고 inspector page는 계속 16 KiB 이하로 유지한다. 이는 pass
경계가 아니라 활성 구독 세션에서 model에 노출할 수 있는 정직한 안전 상한이다.
Hope는 paging 전에 이 상한을 확인하며, 하나라도 넘으면 불완전하거나 실제로 끝낼 수
없는 설명을 만드는 대신 review를 중단한다.

## 안전 경계

Pull request의 title, body, commit 제목, path, patch, 저장소 내용은 신뢰하지 않는
입력이다. Hope는 그 안의 지시를 따르지 않는다. 사용자의 GitHub 계정이 접근할 수
있는 private pull request의 source를 포함해 선택된 source는 활성 Codex 서비스를
통해 처리된다.

Collector는 위험한 GitHub environment redirect를 제거하고, 외부 작업의 크기와
시간을 제한하며, 일반적인 secret path를 차단한다. 파일 patch가 secret 탐지에
걸리면 해당 body는 어떤 부분도 분석이나 근거에 노출하지 않는다. Hope가 GitHub
token을 직접 읽거나 쓰지 않으며 인증은 `gh`가 관리한다.

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
    scripts/inspect-change-request.mjs 제한된 summary와 pass inspector
    scripts/lib/inspection-pages.mjs 16 KiB receipt-chain 전송
test/                                결정론적 contract와 runtime 테스트
tools/check-release.mjs              릴리스 일관성 검사
```

개발 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안 취약점 제보 방법은
[SECURITY.md](SECURITY.md)를 참고한다.

## 라이선스

[MIT](LICENSE)
