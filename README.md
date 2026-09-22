# kktae.io

Hugo/PaperMod 기반의 한국어 기술 블로그입니다. 화면 구성은 프로젝트에서 관리하고, PaperMod의 기본 스타일·코드 강조·SEO 유틸리티를 필요한 범위에서 재사용합니다. React, 별도 CSS 프레임워크, npm 설치 단계는 없습니다.

## 실행과 검증

`.hugo-version`, `.python-version`, `.node-version`에 로컬/CI 런타임을 정확히 고정합니다. 현재 Hugo Extended 0.166.0, Python 3.14.7, Node.js 26.10.0을 사용하며 GitHub Actions도 같은 파일을 읽습니다. 사이트 생성 자체에는 Node.js가 필요하지 않고, Node.js는 vendored Fuse.js 경계 테스트에만 사용합니다.

```sh
hugo version
hugo server --bind 127.0.0.1 --port 1313 --disableFastRender

ruff check scripts/check-browser.py scripts/check_dependencies.py tests/test_site.py
python3 -m unittest discover -s tests -v
node --test tests/fuse.test.mjs
python3 scripts/check_dependencies.py
hugo --minify --panicOnWarning --cleanDestinationDir
```

Ego 브라우저가 설치된 로컬 환경에서는 위 Hugo 서버를 켜 둔 상태에서 실제 화면·상호작용을 검사할 수 있습니다.

```sh
python3 scripts/check-browser.py
```

기존 브라우저 작업 공간을 재사용할 때는 `--space-id <ID>`를 지정합니다. 화면과 결과 JSON은 운영체제의 임시 디렉터리 아래 `kktae-blog-qa`에 저장합니다. 클립보드 검사는 성공/실패 API를 시뮬레이션하므로 사용자의 실제 클립보드 내용을 바꾸지 않습니다. 브라우저 검사는 GitHub Actions의 필수 의존성이 아닙니다.

## 파일 구조

| 경로 | 역할 |
|---|---|
| `hugo.toml` | 한국어 설정, 메뉴, 페이지 크기, 콘텐츠 옵션 |
| `.hugo-version` | 로컬/CI에서 사용할 Hugo 버전 |
| `layouts/` | 홈, 글 목록, 본문, 시리즈, 검색, RSS 등 현재 Hugo 템플릿 |
| `layouts/_partials/` | 글 행, 메타데이터, 목차, 시리즈 데이터 등 공통 요소 |
| `layouts/_markup/` | 제목 링크와 Mermaid 렌더링 훅 |
| `assets/css/extended/` | 색상 토큰, 탐색/목록, 본문, 인쇄 스타일 |
| `assets/js/` | 테마·목차·복사, 검색, 필요한 페이지의 Mermaid 로딩 |
| `assets/js/vendor/` | 검색 라이브러리 소스, 라이선스, 변경 이력 |
| `data/dependencies.toml` | 외부 라이브러리 버전과 경로 |
| `content/posts/` | 게시글 Markdown |
| `static/` | 그대로 배포할 이미지·favicon·독립 HTML 슬라이드 |
| `tests/` | 빌드 결과, 기존 URL, 검색, 시리즈 등의 회귀 테스트 |

## 글 추가

기존 글과 동일하게 `content/posts/<주제>/` 아래에 Markdown을 추가합니다. 시리즈는 `series`와 `series_order`로 지정합니다. 한 글에 여러 시리즈를 지정한 경우 본문 이어 읽기는 첫 시리즈를 사용합니다.

```yaml
---
title: "글 제목"
date: 2026-09-22
summary: "글 목록에서 보여줄 짧은 설명"
tags: ["GCP"]
series: ["시리즈 이름"]
series_order: 1
---
```

홈에는 `params.homePostLimit`만큼 최신 글을 표시하며, 전체 글은 `/posts/`에서 페이지별로 탐색합니다. 기존 URL 회귀 테스트는 신규 글 수를 제한하지 않습니다.
홈의 글 목록은 제목과 날짜·읽기 시간만 표시하는 compact row를 사용합니다. 게시글 `summary` 데이터는 삭제하지 않고 `/posts/`, 검색 index, RSS, 개별 글 `meta description`, Open Graph/Twitter description에 그대로 유지해 검색·공유용 설명 정보는 보존합니다.
헤더의 사이트 브랜드는 36px(모바일 32px) 아바타와 `kktae.io`를 하나의 홈 링크로 묶습니다. 홈의 별도 프로필 블록은 두지 않고 바로 최신 글로 시작하며, `소개` 메뉴와 별도 소개 페이지도 제거했습니다. 기존 `/about/` URL은 외부 링크 호환을 위해 홈으로 리다이렉트합니다. 아바타는 72px WebP 한 장만 배포합니다.
본문 목차는 저장된 선호가 없으면 기본 펼침으로 렌더링합니다. 사용자가 접거나 다시 펼치면 `localStorage`의 `pref-toc-open`에 저장해 같은 브라우저의 다음 방문과 새로고침에서도 상태를 유지합니다.
태그 상세 URL은 기존 링크 호환을 위해 유지하되 `/tags/` 목록에는 `params.curatedTags`의 상위 주제만 표시합니다. 글이 하나뿐인 세부 태그 페이지는 `noindex`로 처리해 검색엔진의 thin taxonomy 노출을 줄입니다.

`content/**/references/`는 작업 자료용입니다. `.gitignore`뿐 아니라 Hugo의 `ignoreFiles`에서도 제외하므로 페이지·RSS·검색 결과로 공개되지 않습니다. 게시용 이미지와 파일은 `static/` 또는 게시글의 page bundle에 둡니다.

독립 슬라이드는 `static/posts/gemini-enterprise/slides/index.html`에 있고 블로그 테마와 별도로 렌더링합니다. 14MB animated GIF는 약 1.4MB H.264 MP4 + poster로 교체했고, PNG는 lossless 최적화했습니다. 슬라이드 이미지는 크기·lazy loading·async decoding을 명시하며 reduced-motion에서는 동영상과 smooth scroll을 중지합니다.

## 의존성 관리

2026-09-22에 공식 GitHub release API, npm/PyPI registry, Python/Node 배포 목록으로 확인한 최신 stable 버전을 정확히 고정했습니다. `scripts/check_dependencies.py`와 주간 dependency-audit workflow가 직접 의존성의 최신성을 확인합니다.

| 의존성 | 버전/리비전 | 관리 위치 |
|---|---|---|
| Hugo Extended | 0.166.0 | `.hugo-version` |
| Python | 3.14.7 | `.python-version` |
| Node.js | 26.10.0 | `.node-version` |
| Ruff | 0.16.8 | GitHub Actions + `ruff.toml` |
| PaperMod | `d3768854d00ad003b0a8dbdba254ce9224377a01` | Git submodule |
| Mermaid | 12.0.0 | `data/dependencies.toml`, 사용 페이지에서만 동적 로딩 |
| Fuse.js | 7.5.0 + `substr` 두 곳의 `slice` 전환 | `assets/js/vendor/` |
| actions/checkout | 7.0.1 | 워크플로의 commit SHA |
| actions/setup-python | 7.0.0 | 워크플로의 commit SHA |
| actions/setup-node | 7.0.0 | 워크플로의 commit SHA |
| astral-sh/ruff-action | 4.1.0 | 워크플로의 commit SHA |
| actions/configure-pages | 6.0.0 | 워크플로의 commit SHA |
| actions/upload-pages-artifact | 5.0.0 | 워크플로의 commit SHA |
| actions/deploy-pages | 5.0.1 | 워크플로의 commit SHA |
| peaceiris/actions-hugo | 3.2.1 | 워크플로의 commit SHA |

Fuse.js 7.5.0의 배포 형식에 맞춰 ESM을 사용합니다. npm tarball의 integrity를 검증한 뒤 source와 Apache-2.0 라이선스를 보관했습니다. 남아 있던 deprecated `String.substr` 두 곳은 의미가 같은 `slice`로 변경했으며, 32자 경계를 넘는 검색어도 별도 테스트합니다. 상세 출처와 패치는 `assets/js/vendor/README.md`에 있습니다.

PaperMod submodule 내부는 수정하지 않습니다. 프로젝트가 사용하는 deprecated API는 프로젝트 템플릿에서 대체했습니다. 테마 업데이트는 템플릿 lookup, SEO partial, 코드 강조 스타일 변경을 확인하고 전체 테스트 후 반영합니다.

Dependabot은 GitHub Actions와 PaperMod submodule 업데이트를 주간으로 확인하고, 별도 dependency-audit workflow가 매주 Hugo/Python/Node/Ruff/Mermaid/Fuse/PaperMod의 latest stable과 pin을 비교합니다. 외부 CDN은 Mermaid 렌더링에만 남아 있으며 장애 시 다이어그램 원문과 오류 안내를 유지합니다. 메인 블로그와 독립 슬라이드는 렌더링 차단 웹폰트 CDN 없이 운영체제의 로컬 시스템 글꼴을 사용합니다.

## 배포

GitHub Actions는 PR에서 테스트와 엄격 빌드를 실행하고, `main`에 반영된 변경만 GitHub Pages로 배포합니다. deprecated 경고도 빌드를 실패시킵니다. 작업 브랜치의 로컬 수정만으로는 운영 사이트가 바뀌지 않습니다.

## 검증 범위

최종 리팩토링 검증에서 빌드 회귀 테스트 32개와 Fuse 경계 테스트 8개를 실행했습니다. Mac의 Ego Chromium에서는 23개 시나리오 그룹으로 반응형 화면(320/390/768/1440px), 3개 주 메뉴, 헤더 브랜드 아바타(36px/32px), 프로필 중복 제거, 홈 summary 제거와 `/posts/` summary 유지, 기본 펼침 목차와 브라우저별 펼침/접힘 상태 저장, `/about/` 홈 리다이렉트, 44px 모바일 탐색 터치 영역, 검색과 한글 조합 입력, 네트워크 실패 및 재시도, 게시글 10개와 Mermaid 12개, 테마 전환, 클립보드 성공/실패 UI, 인쇄 스타일, 최적화된 슬라이드 video, ARIA slide navigation, reduced-motion, iframe 및 키보드 이동을 검증했습니다.

인쇄 검증은 Chromium의 print 미디어 에뮬레이션이며, 실제 프린터/PDF 페이지 나눔과 Safari·Firefox·Windows 렌더링은 별도 확인 대상입니다. GitHub Actions와 dependency-audit workflow는 고정 런타임·검증 명령을 사용하며, 현재 로컬 아바타/홈 단순화 변경은 아직 원격 배포하지 않았습니다.
