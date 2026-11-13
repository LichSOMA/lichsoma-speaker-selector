# Speaker Selector 모듈 연동 API

4.0.0의 공개 API 규약이다. 모듈의 `init` 초기화에서 설치되므로 소비 모듈은 모든 `init`이 끝난 `ready` 이후에 접근한다. DOM 생성 완료를 의미하지는 않는다.

```js
const module = game.modules.get('lichsoma-speaker-selector');
const api = module?.active ? module.api : null;
const supported = api?.supports?.('chatPresentation') === true
  && typeof api.registerChatSystemModule === 'function';
```

`apiVersion: 1`은 호출 규약 버전이며 모듈 버전과 별개다. 기존 호출은 유지한다. 배포 3.0.0에도 `apiVersion: 1`과 등록 함수가 있지만 새 표시 처리기는 없다. 함수 존재만으로 새 기능을 판정하면 안 된다. `supports(feature)`는 알 수 없는 이름이나 문자열이 아닌 값에 `false`를 반환한다. API와 `capabilities` 객체는 읽기 전용이다.

| 기능 이름 | 보장 범위 |
|---|---|
| `chatMergeRules` | 현재/이전 메시지 병합 제외 규칙 |
| `chatExportRules` | HTML 로그 병합 제외, 본문 클래스·포트레잇 규칙 |
| `chatPresentation` | 네이티브 헤더 판정, 실시간·내보내기 표시 준비 등 `ChatSystemBridge.presentation` |
| `speakerPresentation` | 스피커 선택 옵션·발신자 표시·별칭 처리 |
| `chatTheme` | `getChatTheme()`으로 현재 테마 조회 |
| `textFormatting` | `formatChatText(element)`로 루비·인라인 Markdown 처리 |

## 등록과 해제

```js
if (supported) {
  api.registerChatSystemModule('my-module:chat-share', {
    isNativeHeader: ({message, element}) => isShare(message),
    prepareLivePresentation: ({message, element}) => prepareShare(element),
    prepareExportPresentation: async ({message, element}) => prepareShare(element),
    mergeExcludeCurrent: ({message}) => isShare(message),
    mergeExcludePrevious: ({message}) => isShare(message),
    exportExcludeCurrent: ({message}) => isShare(message),
    exportExcludePrevious: ({message}) => isShare(message)
  });
}
// 해제할 때: api.unregisterChatSystemModule('my-module:chat-share');
```

예시의 `isShare`와 `prepareShare`는 소비 모듈이 구현한다. ID는 소비 모듈 이름을 포함해 충돌을 피한다. 같은 ID 재등록은 교체하며 중복 실행되지 않는다. 동기 규칙은 동기 함수를 사용하고, 비동기는 `prepareExportPresentation`에서만 사용한다. 예외는 소비 모듈에서 처리한다. 판정 규칙은 대상 메시지에만 true를 반환해야 다른 어댑터 처리를 막지 않는다. 표시 준비 처리기는 성공 시 true를 반환한다. 지원하지 않는 처리기를 등록하더라도 구형 셀렉터에 새 기능이 생기지는 않는다.

## 테마와 서식

`getChatTheme()`은 `dark-simple`, `simple-light`, `retro-terminal`, `terminal-red` 중 하나를 반환한다. 표시 이름은 심플 다크·심플 라이트·터미널 그린·터미널 레드이다. 테마 설정을 변경하는 공개 메서드는 제공하지 않는다. CSS 연동 시 body의 `lichsoma-speaker-theme-<key>` 클래스를 사용할 수 있으며, CSS 변수에는 기본값을 지정한다. 두 터미널 테마는 `--speaker-terminal-*` 변수 이름을 공유하고 색상 값만 바뀐다.

테마 적용 후 `lichsoma-speaker-selector.themeChanged(theme)` Hook을 알린다. 작업표시줄·캘린더는 이를 구독해 표시와 설정 잠금을 갱신한다. `ready`에서 현재 테마를 먼저 확인하고 이후 변경을 구독할 수 있다.

테마 선택은 클라이언트 설정이며 GM 제한이 없다. 이 Hook과 body 클래스는 해당 클라이언트에서만 변경된다. 스테이지·작업표시줄·캘린더는 각 클라이언트의 테마를 상속한다. Retro PC-Com의 전용 창은 자체 클라이언트 테마를 사용한다.

`formatChatText(element)`는 전달한 DOM의 텍스트 노드에 루비·인라인 서식을 적용한다. HTML 안전성 검사나 Foundry 문서 링크 확장을 대신하지 않는다. 외부 HTML은 소비 모듈이 먼저 안전하게 구성해야 한다.

기존 `ActorEmotions`, `SpeakerSelector`, `ChatMerge`, `ChatRenderLimiter`, `ChatSystemBridge`, 등록/해제 함수와 진단용 조회 함수는 유지한다. 새 연동은 모듈 내부 파일 경로를 직접 import하기보다 공개 API를 우선 사용한다. 기존 스테이지의 직접 import는 후속 이전 전까지 유지한다. `ActorEmotions`의 밑줄로 시작하는 메서드는 내부 구현이다.
