> **AI 제작 안내: 이 프로젝트는 생성형 AI의 도움을 받아 제작되었습니다.**

# 시스템별 호환성 안내

[사용법](../../README.md) · [공개 API](../MODULE_API.md)

활성 게임 시스템에 해당하는 어댑터만 불러옵니다. 아래는 전용 보정이 있는 시스템이며, 나머지 시스템에서는 공통 채팅 처리를 사용합니다.

| 시스템 | 주요 보정 | 구현 |
| --- | --- | --- |
| D&D 5e | 네이티브 헤더·포트레잇·발신자와 HTML 로그 | [dnd5e](../../scripts/systems/dnd5e/) |
| Double Cross 3rd | 시스템 메시지 머지 제외, 테마별 카드·주사위와 HTML 로그 | [dx3rd](../../scripts/systems/dx3rd/) |
| LANCER | 파일럿 이름·콜사인·메크와 카드 내보내기 | [lancer](../../scripts/systems/lancer/) |
| Pathfinder 1e | 구조화된 메시지와 구형 클릭 대상 보존 | [pf1](../../scripts/systems/pf1/) |
| Pathfinder 2e | 네이티브 포트레잇과 메시지·테마·내보내기 | [pf2e](../../scripts/systems/pf2e/) |
| Ordem Paranormal | 카드·판정 제목·독립 헤더/본문 폰트·원본 후처리와 HTML 로그 | [ordemparanormal](ordemparanormal.md) |
| CAIN Alter | 시스템 내보내기 훅과 폰트 우선순위 | [cain-alter](../../scripts/systems/cain-alter/) |

전용 보정이 있다는 것이 해당 시스템의 모든 버전·확장 모듈 조합을 검증했다는 뜻은 아닙니다. 문제가 생기면 게임 시스템과 모듈의 버전, 인게임과 HTML 로그 중 어느 쪽에서 발생하는지, 사용 테마와 웹폰트 설정을 함께 확인하세요. DX3rd의 라이트·터미널 카드 보정은 해당 시스템에서 제공되는 별도 설정으로 끌 수 있습니다.
