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
