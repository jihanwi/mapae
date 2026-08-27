# 신뢰 모델 (M1 — 테스트넷 MVP)

Offering 정산의 신뢰 구조와 그 한계를 명시한다. (PM 결정 D2·D3·D5 반영)

## 배정 계산과 검증

- 배정(균등 + 미충족 신청량 가중 추첨)은 **오프체인에서 결정론적으로 계산**된다
  (`script/allocation/` — 같은 커밋 스냅샷 + 같은 시드 → 항상 같은 결과).
- 온체인에는 배정 머클루트만 커밋된다. **시드는 `Settled` 이벤트에 공개**되므로,
  누구든 커밋 스냅샷(온체인 이벤트 리플레이)과 시드로 전체 배정을 재계산해
  루트 일치 여부를 검증할 수 있다. 절차: `script/allocation/README.md`.
- 랜덤니스: 테스트넷은 지연 블록해시. VRF 가용 시 교체 예정.

## 루트 커밋 권한과 온체인 방어선

- `settle()`은 플랫폼 오너 전용(`Ownable`)이다. **챌린지 기간은 M1 범위에서 제외**
  (로드맵 항목) — 즉 오너가 잘못된 루트를 커밋하는 것 자체는 온체인에서 막지 않는다.
- 대신 조작된 루트가 있어도 **초과 인출은 온체인에서 불가능**하다:
  - settle sanity check: `totalSold ≤ qSale`, `totalRaised ≤ totalCommitted`,
    `totalRaised ≤ totalSold × P`, deadline 이후 · 1회만, 모드 A는 목표 달성 시에만
  - claim 회계 상한: 누적 클레임 토큰 ≤ `totalSold`,
    누적 환불 ≤ `totalCommitted − totalRaised`
- 결론: 오너가 조작할 수 있는 최대치는 "배정을 다르게 나누는 것"이며, 그 사실은
  공개 재계산으로 즉시 탐지된다. 자금 총량을 부풀리거나 빼돌리는 것은 불가능하다.

## 자금 잠김 방지 (D3)

- 모드 A 목표 미달: deadline 이후 `totalCommitted < R`은 온체인에서 판정 가능한
  사실이므로 **누구나** `enableRefunds()` 호출 → 전원 `refund()`로 전액 회수.
- settle 지연: deadline + **7일**까지 정산이 없으면 **누구나** `emergencyRefund()`
  호출 → Refunding 전환. 오너가 사라져도 예치금은 잠기지 않는다.

## cancel 정책 (D5)

- commit은 deadline까지, cancel은 deadline − 2h까지만 허용된다 (프리즈는 cancel 전용).
- 배정은 프리즈 이후 확정되는 **마감 시점 최종 스냅샷**만 사용하므로, 취소·재응모를
  반복해도 배정 결과에 영향을 줄 수 없다 (막판 일괄취소 어뷰징 무의미).

## Dojang 검증

- commit 시점 스냅샷 (fail-closed). 이후 KYC 만료·철회는 기배정에 소급 적용하지 않는다.
- M1은 MockDojang, M3에서 EAS 어댑터로 교체 (`docs/DOJANG.md`).

## 알려진 한계 (M5 — 의도된 트레이드오프)

1. **후원 슬리피지 가드는 현재 스팟 기준** — 같은 블록 내 임팩트·조작 매수는 차단하지만
   **사전 펌핑(다중 블록에 걸친 가격 조작)은 방어하지 않는다**. TWAP 기반 실행은
   BuybackVault 모듈(로드맵)에서 도입 예정.
2. **MapaePool 최초 민트에 MINIMUM_LIQUIDITY 락 없음** — UniV2의 인플레이션 공격
   완화책을 생략했다. 시딩 LP 전량이 0xdEaD로 가는 구조상 최초 민터가 공격자가 될 수
   없어 실익이 없다 (후속 LP 추가 시 라운딩 손실 가능성만 존재, 수용).
3. **대형 후원 상한** — 후원 1건의 소각 매수가 풀 깊이 대비 `maxSlippageBps`(기본 5%)를
   넘으면 revert한다. 분할 후원 또는 풀 심화로 해소되는 제품 특성이다 (기본 프리셋
   기준: 풀 750k KRWs → 후원 1건 상한 약 37.5만 KRWs).
4. **양도 잠금 중 `sponsorToken`(토큰 결제 후원) 불가** — 소각 경로가 아닌
   `transferFrom` 경로이므로 전송 게이트가 적용된다. KRWs 후원(`sponsorKRWs`)은
   잠금과 무관하게 동작한다.

## v5.2 신뢰 모델 — 수수료·등급제·바이백

### 스왑 수수료 방향별 수취 (R1) — treasury·royalty는 KRWs만

플랫폼은 크리에이터 토큰을 보유하지 않는다(트레저리가 유저에게 되파는 이해충돌 차단).
따라서 스왑 수수료를 방향별로 받는다: 매수(KRW 입력)는 4분할 전부 입력 KRWs 기준, 매도(토큰
입력)는 burn·lp만 입력 토큰에서 처리하고 platform·royalty는 출력 KRWs에서 수취한다. 결과로
**royalty는 모든 방향에서 KRWs, platformTreasury는 KRWs만 수취**한다(불변식 17로 검증 —
임의 스왑 시퀀스 후 트레저리의 토큰 잔고는 항상 0). royalty·burn 요율은 크리에이터가 tier
밴드 내에서 설정해 개설 시 스냅샷하며(R2, offering fee와 동일 원칙), platform·LP 요율은
FeeRouter 조회로 오버라이드 불가다.

### FeeRouter 밴드가 신뢰의 근거

- 모든 수수료는 FeeRouter에서 등급별로 읽는다. **온체인 밴드(하드코딩 상수)** 밖 값은
  오너의 `setFees`로도 설정 불가(revert). 즉 오너가 장악해도 L0 스왑 플랫폼 몫을 60bps
  미만으로 내리거나, 스왑 총합을 밴드 밖으로 밀거나, 없어야 할 플랫폼 토큰 배분을
  만들 수 없다. **밴드 자체가 신뢰 보증**이며 초기 프리셋은 밴드 내부에 위치한다.
- 공모 대금 플랫폼 몫(offeringFeeBps)은 **개설 시점 스냅샷**이라 진행 중 공모의 분배에
  소급 적용되지 않는다.

### swapForBurn / BuybackVault — "소각 외 목적지 없음"을 코드로 증명

- `swapForBurn`은 Factory 등록 버너(Sponsorship·BuybackVault)만 호출 가능하고, 매수한
  토큰은 같은 트랜잭션에서 전량 소각한다(호출자에게 반환 없음). 후원 소각 경로는
  FeeRouter를 호출하지 않으므로 "후원 수수료 0%"가 코드 부재로 증명된다.
- **BuybackVault에는 withdraw/rescue/sweep 함수가 없다.** executor를 악의 주소로
  교체해도 KRWs는 `executeBuyback → swapForBurn → 소각` 외 경로로 나갈 수 없다.
  자금·회계는 볼트에, 전략은 교체 가능한 executor에 분리했다.

### BuybackExecutor v1의 한계 (의도된 단순 트레이드오프)

1. **트리거는 onlyOwner** — keeper 자동화(무허가 크랭크)는 로드맵이다. v1은 오너가
   `run(token)`을 수동 호출한다. 즉 바이백 실행 타이밍은 오너 신뢰에 의존한다(단,
   실행되어도 소각뿐이므로 자금 탈취 위험은 없다 — 위 볼트 불변식).
2. **슬리피지 가드는 스팟 기준** — TWAP가 아니라 실행 블록 스팟에 대해
   `maxSlippageBps`(기본 5%)만 검증한다. 다중 블록 사전 펌핑은 방어하지 않는다
   (후원 슬리피지 가드와 동일 한계).
3. **dailyCapBps는 풀 KRWs 리저브 대비 비율** — 시간가중이 아닌 단순 상한이며,
   `intervalSec`(기본 24h)로 실행 빈도만 제한한다. 정교한 TWAP 분할 매수는 v2 전략
   컨트랙트로 executor를 교체해 도입한다(볼트/회계 변경 없이).
4. **환원율 route는 무허가 입금** — `route`/`topUp` 모두 누구나 KRWs를 넣을 수 있다.
   withdraw가 없어 넣은 자금도 소각으로만 나가므로 탈취 위험은 없다([Q6]).
