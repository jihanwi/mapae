# MAPAE — 심사위원용 5분 워크스루 (GASOK 1기)

> **상태: 링크 대기.** 아래 `[TBD]` 링크는 7/28~29 최종 재배포(M5 Part B) 후 채워진다.
> 그 전 1차 배포(M3) 기록은 `docs/DEPLOYMENTS.md`와 `deployments/archive-m3/` 참조.

MAPAE는 GIWA 위의 크리에이터 온체인 회원권 플랫폼입니다 — **발행(정가 공모) · 유통(AMM
정가 상장) · 소비(리딤·후원 소각)** 세 개의 시장이 전부 온체인이며, 아래 explorer 링크를
순서대로 클릭하면 전체 수명주기를 5분 안에 확인할 수 있습니다.

## 1. 발행 — 검증된 크리에이터만, 정가 공모

| 확인할 것 | 링크 |
|---|---|
| Factory `createOffering` — Dojang Verified 크리에이터가 스택 전체(토큰·공모·리딤·베스팅·후원)를 한 트랜잭션에 배포 | `[TBD tx]` |
| 팬 6명 응모 (지갑당 한도 L·실명 검증·발행자 자기응모 차단) + 부분 취소 1건 | `[TBD Offering A 주소]` |
| **DojangEASAdapter** — 실제 GIWA DojangScroll·EAS predeploy를 조회하는 검증 어댑터 (GIWA-Native) | `[TBD 주소]` |

## 2. 정산 — 공개 검증 가능한 배정 + 원자적 상장

| 확인할 것 | 링크 |
|---|---|
| `settle` 트랜잭션 1개 안에서: 민트 → 미판매분 소각 → **AMM 풀 정가 시딩** → **LP 지분 0xdEaD 민트** → 대금 배분 | `[TBD settle tx]` |
| `Settled` 이벤트의 시드 — 배정(균등+가중추첨)은 결정론적: 누구나 `script/allocation/`으로 재계산해 머클루트 일치를 검증 | 같은 tx |
| Offering B: **UnsoldBurned** — 미달 공모의 미판매분 40% 즉시 소각 (`Transfer → 0x0`) — "더 희소하게 태어난다" | `[TBD settle tx]` |
| 풀 스팟가 == 공모가 P (상장가 조작 구조적 불가, 불변식 11) · LP 100% dEaD (러그 구조적 불가, 불변식 7) | `[TBD pool 주소]` |

## 3. 유통 + 소비 — 플라이휠

| 확인할 것 | 링크 |
|---|---|
| AMM 매수/매도 — 수수료 2% 3분할: 크리에이터 로열티 1% + 소각 0.5% + LP 0.5% | `[TBD swap tx]` |
| 매도 시 토큰 0.5% 즉시 소각 (`Transfer → 0x0`이 모든 매도 tx에 포함) | 같은 tx |
| 후원 `sponsorKRWs` — 10%는 풀에서 매수 후 소각, 90% 크리에이터, 메시지가 이벤트에 (방송 오버레이) | `[TBD sponsor tx]` |
| `convertAndBurn` — 적립된 소각 수수료로 누구나 바이백·소각 실행 (미니 BuybackVault) | `[TBD tx]` |
| 리딤 — 회원권을 소각하고 혜택 클레임 (시세 무관 장수 고정) | `[TBD redeem tx]` |
| 크리에이터 베스팅 — 클리프 6mo 이전 릴리즈 0 (불변식 6) | `[TBD vesting 주소]` |

## 신뢰할 수 있는 이유 (요약)

- **논업그레이더블 전 모듈** + 민트 권한 정산 시 영구 소각 — 공급 조작 불가
- 조작된 배정 루트가 있어도 온체인 회계 상한이 초과 인출 차단 (`docs/TRUST.md`)
- 정산 지연·미달 시 **누구나** 환불 개시 가능 (escape hatch) — 자금 잠김 없음
- 143개 Foundry 테스트 (invariant 14 포함) + 결정론적 배정 파이프라인 공개

## 리포 가이드

`docs/SPEC.md`(설계 SSOT) · `docs/TRUST.md`(신뢰 모델·알려진 한계) ·
`docs/DOJANG.md`(실 Dojang 연동) · `docs/DEPLOYMENTS.md`(주소·아키텍처) ·
`script/allocation/README.md`(배정 재계산 절차)
