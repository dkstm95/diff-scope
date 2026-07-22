<p align="center">
  <img src="plugins/hope/assets/telescope.svg" width="128" alt="Hope 망원경 아이콘">
</p>

<h1 align="center">Hope</h1>

<p align="center"><strong>플러그인과 스킬 진입점을 함께 제공하는 AI 작업 하네스</strong></p>

<p align="center"><a href="README.md">English</a></p>

Hope는 서로 분리된 두 진입 경로를 중심으로 구성한다.

- 독립 Hope 하네스를 사용한다.
- Codex 또는 Claude Code에서 Hope 플러그인과 스킬을 사용한다.

두 경로는 같은 기능 코드를 호출한다. 어느 쪽도 별도 구현을 갖지 않는다. 구조는
마련했지만 새 구현을 만드는 동안 diff는 사용할 수 없다.
프로젝트 방향은 [PRINCIPLES.md](PRINCIPLES.md), 현재 구조는
[docs/architecture.md](docs/architecture.md)에 정리되어 있다.

## 현재 상태

Hope diff는 [docs/diff.md](docs/diff.md)를 기준으로 다시 만들고 있다. 이전
collector, review model, renderer, HTML 디자인과 그 파일을 지우던 cleanup은
제거했다. 현재 소스 버전은 review 결과물을 만들지 않는다.

두 진입 경로는 하나의 공용 diff 경계에 연결되어 있으며 같은 재구축 안내와
함께 멈춘다. 이것은 개발 중인 임시 상태이며 완성된 diff 릴리스가 아니다.

## 필요한 환경

현재 Hope는 Node.js 20 이상이 필요하다. 플러그인 경로를 사용할 때는 Codex나
Claude Code도 필요하다.

## 하네스

Codex나 Claude 없이 하네스를 실행할 수 있다.

```bash
npm run hope -- --help
npm run hope -- diff
```

명령은 `harness/`에 있고 `features/`의 기능 코드를 호출한다.

## 플러그인과 스킬

`plugins/hope/`의 배포 패키지 하나가 Codex와 Claude Code를 모두 지원한다.
각 AI 도구는 자신의 설정 파일을 읽고, 둘은 같은 `diff` 스킬과 같은 기능 코드를
사용한다.

개발 중에는 Claude Code에서 패키지를 바로 불러올 수 있다.

```bash
claude --plugin-dir ./plugins/hope
```

스킬 이름은 `/hope:diff`다. 저장소에는 Claude Code marketplace 목록도 있다.
공개된 저장소는 다음처럼 추가하고 설치할 수 있다.

```bash
claude plugin marketplace add dkstm95/hope
claude plugin install hope@hope
```

직접 수정하는 원본은 루트 `docs/`와 `features/`에만 둔다.
`npm run build:plugin`은 패키지 사본을 갱신한다. 배포 검사는 모든 생성 파일을
원본과 비교하므로 두 번째 구현이나 SSOT가 될 수 없다.

## 개발

별도 패키지 설치는 필요하지 않다.

```bash
npm run check
```

## 라이선스

[MIT](LICENSE)
