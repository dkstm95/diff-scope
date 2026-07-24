<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope 망원경 아이콘">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>플러그인과 스킬 진입점을 함께 제공하는 AI 작업 하네스</strong></p>

<p align="center"><a href="README.md">English</a></p>

Hope는 서로 분리된 두 진입 경로를 중심으로 구성한다.

- 독립 Hope 하네스를 사용한다.
- Codex 또는 Claude Code에서 Hope 플러그인과 스킬을 사용한다.

두 경로는 같은 기능 코드를 호출한다. 어느 쪽도 별도 구현을 갖지 않는다.
Claude와 Codex 스킬이 첫 번째 완성된 diff 경로를 제공한다. 독립 하네스는 설정,
수집, 검증, 렌더링, 수명 주기 코드를 함께 쓰며 자체 AI 어댑터는 아직 제공하지
않는다고 분명히 알린다.
프로젝트 방향은 [PRINCIPLES.md](PRINCIPLES.md), 현재 구조는
[docs/architecture.md](docs/architecture.md)에 정리되어 있다.

## 현재 상태

Hope diff는 하나의 정확한 GitHub PR을 설명하는 비공개 단일 HTML 파일을
만든다. URL을 생략하면 현재 저장소에서 사용자가 만든 열린 PR을 고르고,
GitHub PR URL을 직접 받을 수도 있다.

Claude와 Codex 스킬은 활성 AI 세션을 구조화된 분석 작성에만 사용한다.
공용 Hope 코드는 PR 수집, 모든 파일과 근거 검증, 스냅샷 재확인, 오프라인
HTML 렌더링, 비공개 실행 데이터 정리를 담당한다.

전역 Hope 설정은 두 경로에서 함께 쓸 `ko-KR` 또는 `en-US`와 `system`,
`light`, `dark` 테마를 정한다.

## 필요한 환경

Hope는 Node.js 20 이상과 인증된 GitHub CLI가 필요하다. 플러그인에서 자동 AI
분석을 사용할 때는 Codex나 Claude Code도 필요하다.

## 하네스

Codex나 Claude 없이 하네스를 실행할 수 있다.

```bash
npm run hope -- --help
npm run hope -- diff
npm run hope -- settings show
```

명령은 `harness/`에 있고 `features/`의 기능 코드를 호출한다. 현재 `hope diff`는
독립 하네스에 AI 모델 어댑터가 없음을 알리며, 분석을 완료한 것처럼 보이지 않는다.

## 플러그인과 스킬

`plugins/hope/`의 배포 패키지 하나가 Codex와 Claude Code를 모두 지원한다.
각 AI 도구는 자신의 설정 파일을 읽고, 둘은 같은 `diff` 스킬과 같은 기능 코드를
사용한다.

개발 중에는 Claude Code에서 패키지를 바로 불러올 수 있다.

```bash
claude --plugin-dir ./plugins/hope
```

Codex에서는 `$hope:diff`, Claude Code에서는 `/hope:diff`를 사용한다.
공용 언어와 테마 기본값은 `$hope:settings` 또는 `/hope:settings`로 저장한다.
저장소에는 Claude Code marketplace 목록도 있다. 공개된 저장소는 다음처럼
추가하고 설치할 수 있다.

```bash
claude plugin marketplace add dkstm95/hope
claude plugin install hope@hope
```

직접 수정하는 원본은 루트 `docs/`, `features/`, `settings/`, `locales/`,
`design/`에 둔다.
`npm run build:plugin`은 패키지 사본을 갱신한다. 배포 검사는 모든 생성 파일을
원본과 비교하므로 두 번째 구현이나 SSOT가 될 수 없다.

원본을 바꿀 때는 다시 만든 패키지 사본도 함께 커밋한다. 원본만 바꾸어 푸시하면
이전 플러그인이 조용히 배포되는 대신 검증이 실패한다.

## 개발

처음 한 번 잠긴 개발 의존성을 설치한다. 생성된 플러그인은 독립 패키지이므로
사용자가 플러그인을 실행할 때 별도로 패키지를 설치하지 않는다.

```bash
npm install
npm run check
```

릴리스 준비는 한 명령으로 한다. 버전 앞에 `v`를 붙이지 않는다.

```bash
npm run release:prepare -- 0.4.1-alpha
```

이 명령은 패키지와 두 플러그인 설정의 버전을 함께 바꾸고, 패키지 사본을 다시
만든 뒤 모든 검사를 실행한다. 변경을 검토하고 커밋한 다음 같은 버전의
`v0.4.1-alpha` 태그를 만든다. 릴리스에는 `tools/plugin-package-files.txt`에
적힌 파일만 들어가며, 태그의 커밋은 이미 `main`에 포함되어 있어야 한다.

## 라이선스

[MIT](LICENSE)
