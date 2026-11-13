> **AI 제작 안내: 이 프로젝트는 생성형 AI의 도움을 받아 제작되었습니다.**

# LichSOMA's Speaker Selector

## 배포 버전·설치 안내

- **현재 버전**: 4.1.0
- **Foundry VTT**: 13 / 14 (manifest의 verified: 14)
- **최신 릴리즈**: [LichSOMA's Speaker Selector Releases](https://github.com/LichSOMA/lichsoma-speaker-selector/releases/latest)
- **설치용 manifest**: [module.json](https://github.com/LichSOMA/lichsoma-speaker-selector/releases/latest/download/module.json)
- **수동 설치 ZIP**: [lichsoma-speaker-selector.zip](https://github.com/LichSOMA/lichsoma-speaker-selector/releases/download/4.1.0/lichsoma-speaker-selector.zip)

릴리즈 첨부 파일의 `lichsoma-speaker-selector.zip`을 사용하세요. GitHub의 자동 생성 `Source code` 압축 파일과는 구성이 다릅니다. ZIP에는 실행 파일·자원, README와 라이선스를 포함하며, 테스트·개발용 문서와 이전 압축 파일은 포함하지 않습니다. 개발·API 문서는 GitHub 저장소에서 확인할 수 있습니다.

업데이트 전 월드를 백업하고, 교체 후 월드와 브라우저를 다시 불러오세요. 함께 사용하는 LichSOMA 모듈도 이번 릴리즈 버전으로 업데이트하는 것을 권장합니다.

## 소개

Foundry VTT의 채팅 시스템을 확장하는 모듈입니다. 토큰 선택과 독립적인 스피커 선택, 포트레잇·감정 표현, 채팅 머지와 수정·삭제, 나레이터 모드, HTML 로그 내보내기·아카이브 등을 제공합니다.

## 호환성·의존성

- **Foundry VTT**: v13 / v14 (manifest 기준, 검증 기준은 v14)
- **언어 지원**: 한국어 / 영어 / 일본어
- 별도 필수 모듈은 없습니다. 전용 호환 처리는 D&D 5e·DX3rd·LANCER·PF1·PF2e·Ordem Paranormal·CAIN Alter에 제공합니다. 세부 범위는 [시스템별 호환성 안내](https://github.com/LichSOMA/lichsoma-speaker-selector/blob/main/docs/compatibility/README.md)를 참고하세요.

## 설치

1. 모듈 폴더를 Foundry 사용자 데이터의 `Data/modules/lichsoma-speaker-selector`에 배치합니다.
2. 해당 폴더 바로 안에 `module.json`이 있는지 확인합니다.
3. FVTT를 시작하고 월드의 **게임 설정 → 모듈 관리**에서 **LichSOMA's Speaker Selector** 항목을 활성화합니다.

Manifest URL이 제공된 배포본은 모듈 설치 화면의 **Manifest URL** 입력란을 사용할 수도 있습니다.

```text
https://github.com/LichSOMA/lichsoma-speaker-selector/releases/latest/download/module.json
```

## 주요 기능·사용법

### 스피커와 포트레잇

채팅 입력 영역의 드롭다운에서 토큰 선택과 별개로 스피커를 선택합니다. GM은 설정 버튼으로 등록 액터를 관리하고, 액터별 감정 포트레잇과 표시 크기를 설정할 수 있습니다. 지원 시스템에서는 네이티브 헤더·이름·포트레잇 표시를 함께 보정합니다.

같은 사용자·스피커·포트레잇 조건의 연속 메시지는 반복 헤더를 생략합니다. 유저 색상과 마크다운(굵게·기울임·취소선), 루비 `[[본문|읽기]]`를 지원합니다.

### 입력·수정·삭제

- 사이드바의 왼쪽 가장자리와 입력 영역의 위쪽 가장자리를 드래그해 크기를 조정합니다. FVTT 14의 Chat Notifications 입력 높이는 별도로 유지합니다.
- 지원되는 채팅 편집기에는 이미지 삽입 버튼을 제공합니다.
- 자신의 메시지를 수정·삭제할 수 있으며 GM은 다른 사용자의 메시지도 관리합니다. 삭제 호버는 본문만 강조하고 헤더 색상은 유지합니다.

### 나레이터

GM은 버튼 또는 기본 단축키 `Shift+Space`로 나레이터를 전환하고, `/desc …`로 나레이터 카드를 출력할 수 있습니다. 단축키는 FVTT 키 설정에서 변경할 수 있습니다. 타이핑·사운드·루비 서식과 페이드 연출을 지원하며, 귓속말·블라인드 메시지는 나레이터 바에 표시하지 않습니다.

### 테마 적용 범위

심플 다크(기본)·심플 라이트·터미널 그린·터미널 레드를 클라이언트별로 선택합니다. 채팅·입력/수정 모드·사이드바·게임 설정·장면 컨트롤과 전용 창, HTML 로그에 반영합니다. 유저 색상과 콘텐츠 이미지, 채팅의 반투명 배경은 유지합니다.

일반 애플리케이션·다이얼로그에는 배경과 글자 대비를 적용하며 내부 조작부와 폰트는 유지합니다. 문서 시트·DX3rd 전용 창·Retro PC-Com·작업표시줄 파일 선택창 등 자체 스타일을 가진 대상은 제외합니다. HUD·전역 툴팁·컨텍스트 메뉴는 일괄 변경하지 않습니다. 터미널 테마의 대상 창에는 CRT 효과를 적용하며 채팅에는 적용하지 않습니다.

스테이지·작업표시줄·캘린더는 각 사용자의 셀렉터 테마를 이어받습니다. Retro PC-Com은 별도 테마를 사용합니다.

### HTML 로그와 아카이브

- 채팅 로그를 단일 HTML로 저장하며 선택한 테마·웹폰트와 지원 시스템의 카드 스타일을 반영합니다.
- 이미지 Base64 포함, 주사위 툴팁, 타임스탬프·기준 URL·추가 CSS를 설정할 수 있습니다. Base64 옵션은 원본 이미지 한 장당 최대 **5MiB(약 5MB)**를 내장합니다. 초과하거나 읽지 못한 이미지는 원본 주소로 남기고 알림을 표시합니다.
- 전체 로그 삭제 전 HTML 백업을 제공하며 백업 저장에 실패하거나 Base64 설정에서 이미지 내장이 누락되면 삭제를 중단합니다.
- 저장된 로그의 폴더 탐색·검색·뷰어를 제공합니다. HTML 뷰어는 게임 화면과 분리해 표시합니다.

### DX3rd 카드 보정

DX3rd 월드에서는 라이트 카드 보정과 터미널 카드 보정을 각각 켜고 끌 수 있습니다. 기본값은 켜짐이며 해당 테마의 카드·표·버튼·펼친 주사위 결과와 HTML 로그에 반영합니다. 라이트 보정은 성공·실패·경고 색상을 구분하고, 터미널 보정은 테마의 단색 계열로 통일합니다. 터미널에서도 결과 문구·증감 부호와 주사위 장식은 유지하며 처리된 버튼은 하이라이트로 구분합니다.

### Ordem Paranormal 카드 지원 (4.1.0)

OP 시스템 8.0.2의 아이템·의식 카드, 능력/기능·공격·피해 판정, 명중·반응·피해 적용 표시를 네 가지 채팅 테마로 꾸밉니다. 판정 제목에는 별도 헤더 영역을 적용하고 원본 버튼·숨김·권한·판정 계산을 유지합니다.

**OP — 채팅 카드 헤더 폰트 / 본문 폰트**는 개인 설정이며 시트·발화자·일반 대화·일반 주사위 폰트와 독립적입니다. 본문은 태그·표·버튼·판정 결과를 포함합니다. `@font-face` 또는 `@import`와 `.lichsoma-op-font-settings { font-family: "My Font", sans-serif; }`를 입력하세요. 임의의 일반 CSS는 실행하지 않고 폰트 선언만 적용합니다. 빈 설정은 OP 테마의 기본 글꼴을 사용합니다.

Ordem Interface에서 저장했던 카드 헤더/본문 폰트는 클라이언트에 남아 있으면 최초 한 번만 같은 역할로 옮깁니다. 이미 지정한 새 설정(의도적으로 비운 설정 포함)은 덮어쓰지 않습니다. 계속 상속하거나 동기화하지 않으며, 시트 폰트·테마는 옮기지 않습니다.

채팅 팝아웃·알림·이전 기록 복원·HTML 로그에도 같은 분류와 폰트를 사용합니다. OP 액터가 발화자인 기본 주사위 형식은 시스템의 무표식 피해/위협 판정과 `/r`를 구분할 표식이 없어 동일하게 꾸밉니다. 다른 모듈의 구조화된 카드, 일반 대화, 무표식 효과 종료·반응 설명은 추측해서 OP 카드로 바꾸지 않습니다.

시트·전용 다이얼로그·650px 기본 너비는 **Ordem Interface 0.2.0 이상**에서 담당합니다. 두 모듈은 필수 의존성이 없으며, UI 모듈은 시스템의 요청 명령어를 고치거나 자동 피해/반응 규칙을 추가하지 않습니다. 구형 Interface의 카드 UI와 중복 적용하지 마세요. 이전 Interface를 유지할 경우 카드 UI와 카드 폰트 설정을 끄거나 비운 뒤 사용하세요. 자세한 검증 범위는 [OP 호환성 안내](https://github.com/LichSOMA/lichsoma-speaker-selector/blob/main/docs/compatibility/ordemparanormal.md)를 참고하세요.

## 설정

**게임 설정 → 모듈 설정**에서 조정합니다. 테마는 각 사용자가 선택하며 헤더·메시지·주사위·나레이터 웹폰트 CSS와 DX3rd 카드 보정은 GM의 월드 설정입니다.

웹폰트 CSS는 `@font-face`와 `font-family`를 사용합니다. 적용 굵기·기울임·가변 폰트 축도 지정할 수 있습니다. 비워 두면 테마와 Foundry의 기본 글꼴을 사용합니다. D&D 5e의 네이티브 헤더는 이름·보조 정보용 웹폰트를 별도로 지정할 수 있습니다.

## 개발 문서

[공개 API와 기능 지원 규약](https://github.com/LichSOMA/lichsoma-speaker-selector/blob/main/docs/MODULE_API.md), [시스템별 호환성 안내](https://github.com/LichSOMA/lichsoma-speaker-selector/blob/main/docs/compatibility/README.md)를 참고하세요. 대용량 이미지 처리는 [이미지 내보내기 모듈](scripts/lichsoma-chat-export-images.js)로 분리했습니다. 외부 모듈은 `supports(feature)`로 기능을 확인하며, 시스템별 표시 처리는 [어댑터](scripts/systems/)에서 분리합니다.

권한·나레이터·아카이브 관련 자동 검사는 모듈 폴더에서 `node --test tests/narrator-security.test.mjs`로 실행합니다. 실제 FVTT 다중 클라이언트 검증은 별도로 필요합니다.

## 라이선스·크레딧

MIT License. 자세한 조건은 [`LICENSE.md`](LICENSE.md)를 참조하세요.

제작: LichSoma

## 업데이트 내역

### 4.1.0

- Ordem Paranormal 카드·판정 제목과 독립 헤더/본문 폰트를 네 가지 채팅 테마 및 HTML 로그에서 지원합니다.
- 이전 Interface 카드 폰트를 기존 설정을 덮어쓰지 않고 한 번만 이전하며, 원본 판정·권한·후처리를 유지합니다.
- 분리된 사이드바를 포함한 디렉터리 구분선과 내보내기 CSS 처리를 보완했습니다.

### 4.0.0

- 클라이언트별 심플 다크·라이트, 터미널 그린·레드 테마를 추가했습니다. 스테이지·작업표시줄·캘린더는 셀렉터 테마를 상속하고 Retro PC-Com은 독립적으로 선택합니다.
- 채팅 입력·수정 모드·배경·좌우 간격·스크롤 페이드를 정리하고 HTML 로그에도 테마를 반영합니다. 시트와 다른 모듈 전용 UI는 적용 범위를 구분합니다.
- D&D 5e·DX3rd·LANCER 연동을 정리하고 PF1·PF2e·Ordem Paranormal·CAIN Alter 어댑터를 추가했습니다. DX3rd 카드·펼친 주사위에는 선택형 라이트·터미널 보정을 제공합니다.
- 공개 API에 기능 지원 조회·테마 조회·텍스트 서식 처리를 추가하고 기존 호출을 유지했습니다.
- 이미지 한 장당 5MiB 내장과 대용량 HTML 조립·복원을 지원하고, 이미지 누락 안내와 삭제 전 백업 검사를 보완했습니다.
- 나레이터 권한·메시지 공개 범위, 스테이지 연동과 메시지·HTML 로그 출력의 안정성을 개선했습니다.

### 3.0.0

- 채팅 렌더링·메시지 처리·HTML 로그 출력 구조를 정리하고 성능을 개선했습니다.
- 전체 채팅 로그 삭제 전 HTML 백업을 추가하고, D&D 5e·DX3rd·LANCER의 표시와 내보내기를 보완했습니다.
- 웹폰트·나레이터·메시지 편집 동작을 개선하고 영어·일본어 UI를 추가했습니다.
