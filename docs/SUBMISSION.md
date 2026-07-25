# MAPAE — 심사위원용 5분 워크스루 (GASOK 1기)

> 최종 배포 기준 (M5, GIWA Sepolia · 배포 22개 전부 verified). 전체 주소 표: [`docs/DEPLOYMENTS.md`](DEPLOYMENTS.md)

MAPAE는 GIWA 위의 크리에이터 온체인 회원권 플랫폼입니다 — **발행(정가 공모) · 유통(AMM
정가 상장) · 소비(리딤·후원 소각)** 세 개의 시장이 전부 온체인이며, 아래 explorer 링크를
순서대로 클릭하면 전체 수명주기를 5분 안에 확인할 수 있습니다.

## 1. 발행 — 검증된 크리에이터만, 정가 공모

| 확인할 것 | 링크 |
|---|---|
| Factory `createOffering` — Dojang Verified 크리에이터가 스택 전체(토큰·공모·리딤·베스팅·후원)를 한 트랜잭션에 배포 | [tx](https://sepolia-explorer.giwa.io/tx/0xb610613d61a975b77c0b65e24d16003f5c1d5cd2d89970418293373eb1c5ffad) |
| 팬 6명 응모 (지갑당 한도 L·실명 검증·발행자 자기응모 차단) + 부분 취소 1건 | [Offering A](https://sepolia-explorer.giwa.io/address/0xdE5c071C58553A9fd8662eDdD51A30bAFCfabaec) |
| **DojangEASAdapter** — 실제 GIWA DojangScroll·EAS predeploy를 조회하는 검증 어댑터 (GIWA-Native) | [adapter](https://sepolia-explorer.giwa.io/address/0x69903dD3b32B5EC3BB8DE8D167053ec80e4b3566) |

## 2. 정산 — 공개 검증 가능한 배정 + 원자적 상장

| 확인할 것 | 링크 |
|---|---|
| `settle` 트랜잭션 1개 안에서: 민트 → 미판매분 소각 → **AMM 풀 정가 시딩** → **LP 지분 0xdEaD 민트** → 대금 배분 | [settle A](https://sepolia-explorer.giwa.io/tx/0xb3f3921a854547741b1053e5f0603e339dd09446a3ecdfac230ae3fa1fbc7abb) |
| `Settled` 이벤트의 시드 — 배정(균등+가중추첨)은 결정론적: 누구나 `script/allocation/`으로 재계산해 머클루트 일치를 검증 | 같은 tx |
| Offering B: **UnsoldBurned** — 미달 공모의 미판매분 40% 즉시 소각 (`Transfer → 0x0`) — "더 희소하게 태어난다" | [settle B](https://sepolia-explorer.giwa.io/tx/0x0f14b9234708021ad0d4427ea705dc8dfaa1a64cac14cedd27252be28be9091f) |
| **상장 순간** 스팟가 = 공모가 P — settle A tx의 시딩 이벤트(LiquidityMinted: **75만 KRWs / 75장** = 10,000 KRWs/장)에서 확인. 현재 풀 스팟은 이후 데모 거래를 반영한 값. LP 지분 100% = 0xdEaD 보유 (러그 구조적 불가, 불변식 7·11) | [settle A](https://sepolia-explorer.giwa.io/tx/0xb3f3921a854547741b1053e5f0603e339dd09446a3ecdfac230ae3fa1fbc7abb) · [MapaePool A](https://sepolia-explorer.giwa.io/address/0x23CAB150FA6Ca1503aA1FA10B1C7FE3b88db7CB6) |

## 3. 유통 + 소비 — 플라이휠

| 확인할 것 | 링크 |
|---|---|
| AMM 매수/매도 — 수수료 2% 3분할: 크리에이터 로열티 1% + 소각 0.5% + LP 0.5% | [매수](https://sepolia-explorer.giwa.io/tx/0xc0b19bfa4bfe534f6fe988c9aabe340598d3dc265239d379c3240ef96547156c) · [매도](https://sepolia-explorer.giwa.io/tx/0xd497d2a294f9c559a2a62ee6a3d3b46fdf768c5d8d7c7d79b265c1d034a23015) |
| 매도 시 토큰 0.5% 즉시 소각 (`Transfer → 0x0`이 모든 매도 tx에 포함) | 매도 tx 내 이벤트 |
| 후원 `sponsorKRWs` — 10%는 풀에서 매수 후 소각, 90% 크리에이터, 메시지가 이벤트에 (방송 오버레이) | [tx](https://sepolia-explorer.giwa.io/tx/0xd9e31a26f798542bc21d6b6684101b97eb09b2f6e494ab07d98ac4f92dc5a745) |
| `convertAndBurn` — 적립된 소각 수수료로 누구나 바이백·소각 실행 (미니 BuybackVault) | [tx](https://sepolia-explorer.giwa.io/tx/0xd0d0b339290ad6a64d3b8019ec7462ca511400fbd84d3c07bcc8c007534f4a00) |
| 리딤 — 회원권을 소각하고 혜택 클레임 (시세 무관 장수 고정) | [tx](https://sepolia-explorer.giwa.io/tx/0x85f176ee0d093bb86558d6fa541067c93e6ab3d8f45afffdee045dbdb216166f) |
| 크리에이터 베스팅 — 클리프 6mo 이전 릴리즈 0 (불변식 6) | [MapaeVesting A](https://sepolia-explorer.giwa.io/address/0x4E0528b1C72073d55583332915f75A7cf2F7422f) |

## 신뢰할 수 있는 이유 (요약)

- **논업그레이더블 전 모듈** + 민트 권한 정산 시 영구 소각 — 공급 조작 불가
- 조작된 배정 루트가 있어도 온체인 회계 상한이 초과 인출 차단 (`docs/TRUST.md`)
- 정산 지연·미달 시 **누구나** 환불 개시 가능 (escape hatch) — 자금 잠김 없음
- 145개 Foundry 테스트 (invariant 14 포함) + 결정론적 배정 파이프라인 공개
- **컨트랙트 13종 · 배포 22개 전부 Blockscout verified** — 소스와 바이트코드가 explorer에서 대조 가능

## 리포 가이드

`docs/SPEC.md`(설계 SSOT) · `docs/TRUST.md`(신뢰 모델·알려진 한계) ·
`docs/DOJANG.md`(실 Dojang 연동) · `docs/DEPLOYMENTS.md`(주소·아키텍처) ·
`script/allocation/README.md`(배정 재계산 절차)
