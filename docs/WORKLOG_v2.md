# MAPAE v5.2 — Milestone A (코어) 작업 로그

브랜치 `v2-dev` (베이스라인 태그 `v1.0-gasok` = 32f9b82). 완료 태그 목표 `v2.0-core`.

## 베이스라인 사실 정정
- 스펙은 "forge test 145 그린"이라 명시하나, 태그 `v1.0-gasok`에서 `forge test`는
  **144 통과**(0 실패). 신규 테스트 증분은 144 기준으로 보고한다.

## [QUESTION] 목록 (임의결정 대신 기록 · fail-closed 진행)

- **[Q1] FeeRouter L0 merchFeeBps 밴드 미명시.** L0은 RedeemManager/유료드랍 경로가
  전부 revert(게이트)이므로 merch 요율이 의미 없음. 가장 보수적으로 **L0 merchFeeBps == 0
  강제**(0 외 값 revert)로 진행. 초기 프리셋도 L0 merch=0.
- **[Q2] 스왑 수수료 platform 몫의 표기 자산.** 스펙: "platform 몫은 KRWs로 즉시 이체".
  그러나 불변식 10("4분할 합 = 총 요율, 정밀도 손실 0, fuzz 임의 금액")은 4개 몫이 모두
  동일 base(amountIn)의 bps 분할임을 요구 → **입력자산 기준 4분할**로 확정. 매수(KRW 입력)
  시 platform 몫은 KRWs로 treasury 이체(스펙 문자 충족). 매도(토큰 입력) 시 platform 몫은
  멤버십 토큰으로 treasury 이체(풀 내부 토큰→KRW 원자 변환은 AMM 불변식·슬리피지 가드를
  왜곡하므로 배제). 이 절충은 fail-closed(불변식 10 우선)이며 보고서 이탈목록에 기재.
- **[Q3] L0 cBps 밴드 미명시("c 기본 25%"는 기본값).** L1/L2와 동일한 [1500,3000] 밴드를
  L0에도 적용, 기본 2500. (프리셋 f=70%, c=25% → lpToken=17.5%, 실행가능식 통과.)
- **[Q4] 지갑당 라이브 토큰 교차등급 규칙 미명시.** liveCount = 크리에이터의 실패하지 않은
  공모 수(전 등급 합산). L1/L2 개설: liveCount==0 요구. L0 개설: liveCount<3 요구.
  (동일등급 시퀀스에서 스펙의 1/3 캡을 정확히 만족. 실패 공모는 슬롯 미소모 유지.)
- **[Q5] BuybackVault 스코프(전역 vs 토큰별) 미명시.** 시그니처가 token 파라미터를 받고
  ("route(token,amount)", "executeBuyback(token,...)") "크리에이터별 환원율 저장"(복수
  크리에이터)이라 명시 → **전역 싱글턴**으로 구현(배포 스크립트에서 1회 배포, 팩토리에
  주입·burner 등록). L0 토큰 route/topUp/executeBuyback는 notL0 가드로 revert.
- **[Q6] route() 호출자 제한.** 스펙 "Sponsorship·RedeemManager로부터". withdraw 경로가
  없어 외부가 KRW를 넣어도 소각 매수로만 나가므로(무탈취) route/topUp 모두 permissionless
  입금으로 구현. 안전상 손실 없음(불변식 9 유지). 이탈목록 기재.

## 이탈(스펙 대비) 결정 — 상세는 각 커밋/보고서

(작업 진행하며 갱신)
