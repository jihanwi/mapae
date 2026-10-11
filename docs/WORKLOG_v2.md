# MAPAE v5.2 — Milestone A (코어) 작업 로그

브랜치 `v2-dev` (베이스라인 태그 `v1.0-gasok` = 32f9b82). 태그: `v2.0-core`(초안) →
`v2.0.1-core`(PM 리뷰 R1·R2·R3 반영).

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
  → **PM 리뷰에서 기각. R1로 방향별 수취(매도 platform·royalty를 출력 KRWs에서 수취)로 변경 —
  treasury·royalty 항상 KRWs, 불변식 17 추가.**
- **[Q3] L0 cBps 밴드 미명시("c 기본 25%"는 기본값).** L1/L2와 동일한 [1500,3000] 밴드를
  L0에도 적용, 기본 2500. (프리셋 f=70%, c=25% → lpToken=17.5%, 실행가능식 통과.)
- **[Q4] 지갑당 라이브 토큰 교차등급 규칙 미명시.** liveCount = 크리에이터의 실패하지 않은
  공모 수(전 등급 합산). L1/L2 개설: liveCount==0 요구. L0 개설: liveCount<3 요구.
  (동일등급 시퀀스에서 스펙의 1/3 캡을 정확히 만족. 실패 공모는 슬롯 미소모 유지.)
  → **PM 리뷰에서 변경. R3로 liveL0 / liveMembership 버킷 분리(교차 보유 허용).**
- **[Q5] BuybackVault 스코프(전역 vs 토큰별) 미명시.** 시그니처가 token 파라미터를 받고
  ("route(token,amount)", "executeBuyback(token,...)") "크리에이터별 환원율 저장"(복수
  크리에이터)이라 명시 → **전역 싱글턴**으로 구현(배포 스크립트에서 1회 배포, 팩토리에
  주입·burner 등록). L0 토큰 route/topUp/executeBuyback는 notL0 가드로 revert.
- **[Q6] route() 호출자 제한.** 스펙 "Sponsorship·RedeemManager로부터". withdraw 경로가
  없어 외부가 KRW를 넣어도 소각 매수로만 나가므로(무탈취) route/topUp 모두 permissionless
  입금으로 구현. 안전상 손실 없음(불변식 9 유지). 이탈목록 기재.

## PM 리뷰 반영 (v2.0.1-core) — R1·R2·R3 + minRaise 확인

- **R1 (이탈 2 기각 반영).** 스왑 platform·royalty를 방향별 수취로 재구현: 매수는 입력 KRWs
  4분할, 매도는 burn·lp를 입력 토큰에서, platform·royalty를 **출력 KRWs**에서 수취. royalty는
  항상 KRWs, treasury는 KRWs만. **신규 불변식 17** 추가(fuzz). 불변식 10을 방향별 base로
  재정의. 슬리피지 가드·getKrwOut 견적 방향별 갱신.
- **R2 (이탈 3 기각 반영).** per-token `swapRoyaltyBps`/`swapBurnBps` 복원 → CreateParams·
  OfferingParams·PoolFactory·MapaePool 생성자에 재추가, 개설 시 tier 밴드 검증(L1/L2
  royalty[0,80]·burn[0,50], L0 royalty[0,30]·burn[0,50]) + 스냅샷. platform·LP는 FeeRouter
  조회 유지(오버라이드 불가). 밴드 경계 테스트 추가.
- **R3 (Q4 변경).** 라이브 토큰 카운트를 liveL0 / liveMembership(L1+L2) **버킷 분리**.
  L0 개설 `liveL0<3`, L1/L2 개설 `liveMembership==0`, 교차 보유 허용. 교차 시나리오 4종 테스트.
- **minRaise 확인.** 전역 minRaise(500,000)는 Offering 생성자 레벨 floor라 L0 가이드 우회와
  무관하게 **L0에도 적용**됨을 코드로 재확인 + 전용 테스트 추가(코드 변경 불필요).

신규 테스트 8 추가 → 총 **180 그린** (144 기존 + 36 신규).

## 이탈(스펙 대비) 결정 (v2.0.1-core 기준)

1. **베이스라인 테스트 수 144 (스펙은 145 명시).** 태그 `v1.0-gasok` 실측 144 그린.
   신규 36 추가 → 총 **180 그린**.
2. **`IOffering.Phase` → `IPrimaryMarket.Phase`.** Step 3의 IPrimaryMarket 추출로 Phase가
   상위 인터페이스로 이동. Solidity가 상속 enum을 파생 인터페이스명으로 접근 불가하여
   테스트 참조를 `IPrimaryMarket.Phase`로 갱신.
3. **L0 큐레이션 게이트 = 가이드 밴드 우회.** "L0는 Dojang 검증만"을 가이드 P/R/L 밴드
   미적용으로 해석(L0는 자체 토크노믹스 밴드 + minRaise 플로어 + Dojang만). L1/L2는 현행
   가이드 유지. (미해석 시 guide.minRaise 5M이 L0 미니 공모를 막음.)
4. **sponsorToken 환원율 route 미적용.** 환원율은 KRWs 흐름 대상. `sponsorToken`은
   토큰 표기라 볼트(KRWs) route 부적합 → 토큰 후원은 잔여 전액 크리에이터. `sponsorKRWs`만
   route 훅 적용.
5. **데모 스크립트 재구성.** M5의 3-stage 내러티브(모드 A/B 초과·미달) → 밀스톤이 명시한
   4 시나리오(① L1 풀사이클 ② L0 미니 T=1h ③ 유료 드랍 ④ 바이백)를 단일
   `script/DemoV2.s.sol`(vm.warp 시뮬레이션, 자체 검증)로 대체. 구 DemoStage1~3 제거.
6. **GIWA Sepolia 재배포 미실행 (핸드오프).** keystore(`deployer`) 언락이 필요한 대화형·
   외부 작업이라 자율 실행하지 않음. Deploy.s.sol·verify-children.js는 새 시그니처로
   갱신, DemoV2 시뮬레이션으로 전 흐름 검증 완료. 운영자 실행 명령은 docs/DEPLOYMENTS.md.

## 산출물 요약

- 신규 컨트랙트: FeeRouter, BuybackVault, BuybackExecutor + 인터페이스 IFeeRouter,
  IPrimaryMarket, IBurnerRegistry, ITierSource.
- 변경: MapaeFactory, Offering, MapaePool, RedeemManager, Sponsorship, MapaeVesting,
  PoolFactory, StackDeployer, IOffering, IRedeemManager.
- 테스트: 144(기존, 요율 변경분 갱신) + 36 신규 = **180 그린**. 신규 파일 FeeRouterV2(7)·
  InvariantsV2(17)·PeripheralsV2(8) + 기존 MapaeFactory.t에 R3 교차 4.
- 스크립트/문서: Deploy.s.sol, DemoV2.s.sol, verify-children.js, SPEC/TRUST/DEPLOYMENTS.md.
