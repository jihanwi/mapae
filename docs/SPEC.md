# MAPAE(마패) 스마트 컨트랙트 스펙 (SSOT)

> 이 문서는 MAPAE 컨트랙트 개발의 단일 기준(Single Source of Truth)이다.
> 모든 코딩 세션은 이 문서를 기준으로 진행한다.

MAPAE: GIWA 체인(업비트/두나무의 이더리움 L2) 위의 크리에이터 온체인 회원권 플랫폼.
검증된 크리에이터가 실명 지갑으로 발행하는 고정 공급 양도가능 회원권 ERC-20.
발행은 정가 공모, 유통은 AMM, 소비(리딤)는 원화 고정가.

## v3 변경 (Phase 1, 실명 본딩커브 레일): 이 절이 하위 절과 상충 시 **우선**

v3에서 바뀐 컨트랙트 구성과 인터페이스. 숫자는 전부 `src/` 상수에서 옮겼다. 작업 기록은 `docs/WORKLOG_v3.md`,
배포 주소는 `docs/DEPLOYMENTS.md`.

### 컨트랙트 구성

| 컨트랙트 | 역할 |
|---|---|
| `src/lib/CurveMath.sol` | 가상 준비금 상수곱 커브의 순수 수학 라이브러리. 저장소·수수료 없음 |
| `src/CurvePresets.sol` | 커브 기하, 가상 호가 준비금, 수수료 프리셋 상수 |
| `src/CurveSale.sol` | L0 커브 1차 시장(`IPrimaryMarket` 구현). 매수·매도·수수료 적립·졸업 |
| `src/CurveFactory.sol` | 커브 개설, Dev 첫 매수, 발행 빈도 제한, ETH 매수·개설 경로 |
| `src/MapaeFactory.sol` | 정가 공모 팩토리 + 호가 자산 레지스트리(`allowQuote`, `setQuoteEnabled`) |
| `src/FeeRouter.sol` | 등급별 AMM 요율 + 커브 요율(`getCurveFees`)과 하드 밴드 |
| `src/MapaePool.sol` | AMM 풀. 스왑 실명 게이트, 풀 몫 상한 |
| `src/MembershipToken.sol` | 고정 공급 ERC-20. `endTransferLock()` 추가 |
| `src/interfaces/IWETH.sol` | WETH 최소 인터페이스(`deposit`, `withdraw`) |

### 커브 기하 (`CurvePresets`)

| 상수 | 값 |
|---|---|
| `TOTAL_SUPPLY` | 1,000,000,000e18 |
| `CURVE_SUPPLY` (S, 커브 판매 물량) | 800,000,000e18 |
| `DEX_SUPPLY` (졸업 풀 시딩 물량) | 200,000,000e18 |
| `VIRTUAL_TOKEN_RESERVE` (Vt) | 1_066_666_666_666_666_666_666_666_667 (= 3,200,000,000e18 / 3 올림) |
| `VIRTUAL_QUOTE_KRWS_WHOLE` | 2,000,000 (원 단위, `krwsVirtualQuote(decimals)` = 2,000,000 × 10^decimals) |
| `VIRTUAL_QUOTE_RESERVE_WETH` | 0.6e18 (메인넷 프리셋. 테스트넷 배포는 레지스트리에 0.002 ETH 등록) |

- Vt 유도: 풀 시딩가 = 커브 종가가 되려면 `DEX_SUPPLY = S × (Vt − S) / Vt`, 즉 `Vt = S² / (S − DEX_SUPPLY)` = 32억/3.
- 결과(Vq 무관 비율): 졸업 임계(수수료 제외 순모금) = 3 × Vq, 졸업 FDV = 15 × Vq, 졸업가/시작가 = 16배.
  KRWs 프리셋에서 임계 6,000,000 KRWs, FDV 30,000,000 KRWs.

### CurveMath

- 모델: `(Vq + r) × (Vt − s) ≥ Vq × Vt = k` (Vq 가상 호가 준비금, r 실 준비금, s 누적 판매량).
- `buyExactQuoteIn(p, r, s, quoteIn) → (tokensOut, quoteUsed)`: tokensOut 내림, quoteUsed는 산 물량의 올림 비용,
  잔여 물량 `S − s`에서 자른다. 비용이 0으로 계산되는 매수는 `(0, 0)`이고, 잔여분 전량을 가져가는 종결 매수만 예외다.
- `sellExactTokenIn(p, r, s, tokenIn) → quoteOut`: 내림. `tokenIn > s`면 revert.
- `costToSellOut(p, r, s)`, `spotPrice(p, r, s)`(분자, 분모), `validate(p)`.
- 상태 불변식: 라이브러리 결과만 반영하면 `Vq + r == ceil(Vq × Vt / (Vt − s))`가 항상 성립한다.

### CurveSale

- 생성자 `InitParams { quote, dojang, dev, feeRouter, poolFactory, mapaeFactory, tokenName, tokenSymbol, virtualQuote }`.
  생성 시 FeeRouter 커브 요율을 immutable로 스냅샷하고, 토큰을 전송 잠금 `CURVE_LOCK_DURATION = 100 * 365 days`로
  만든 뒤 `TOTAL_SUPPLY` 전량을 자신에게 민트한다(민트 권한 소각).
- 거래: `buy(quoteIn, minTokensOut)`, `sell(tokenIn, minQuoteOut)`, `buyFor(trader, quoteIn, minTokensOut)`(factory 전용).
  거래자 실명 게이트(fail-closed), 졸업 후 revert.
- 수수료 청구(t = platform + dev + lpSeed):
  - 매수: `net = quoteIn − floor(quoteIn·t/1e4)`로 커브 계산, 청구액 `P = min(quoteIn, ceil(quoteUsed·1e4/(1e4 − t)))`,
    `fee = P − quoteUsed`, platform·dev는 P 기준 floor, lpSeed는 나머지. 매수자에게서 정확히 P만 가져온다.
  - 매도: `gross = sellExactTokenIn`, `fee = floor(gross·t/1e4)`, 지급 `gross − fee`는 r에서만 나간다.
- 졸업 조건: 커브 완판(`s == CURVE_SUPPLY`) 하나뿐. 그 매수와 같은 tx에서 L0 풀을 만들고(royalty
  `SWAP_FEE_DEV_BPS` 30, burn 0, creator = dev) `DEX_SUPPLY`와 `r + lpSeedAccrued`를 넣어 LP를 0xdEaD로 민트한 뒤
  `endTransferLock()`을 호출한다.
- 실명 카운트: 주소당 첫 매수에서 `verifiedBuyerCount` 증가, dev는 영구 제외.
- 인출: `claimDevFees()`(dev 전용), `sweepPlatformFees()`(누구나 호출, treasury로). 졸업 후에도 동작.
- view: `quoteBuy`, `quoteSell`(실행과 wei 단위 일치), `spotPrice`, `token`, `settlementToken`(= quote),
  `phase`(졸업 전 Open, 후 Settled), `tier`(항상 L0), `totalFeeBps`.

### CurveFactory

- 생성자: `(dojang, feeRouter, poolFactory, mapaeFactory, weth, owner)`.
- `createCurve(quote, name, symbol, devBuyQuoteIn, minTokensOut)`: 검사 순서 `curveEnabled` → 개설자 실명 →
  `mapaeFactory.isQuoteAllowed(quote)` → 발행 빈도 → 이름·심볼 길이. 가상 준비금은 레지스트리 값.
  `devBuyQuoteIn > 0`이면 같은 tx에서 `buyFor(dev, ...)`로 Dev 첫 매수, 미사용분 환불, allowance 0 복구.
- `createCurveWithETH(name, symbol, minTokensOut)`(payable): quote = WETH, Dev 첫 매수 금액 = msg.value.
- `buyWithETH(curve, minTokensOut)`(payable): WETH 커브만, 미사용분은 ETH로 환불. `receive()`는 WETH만 받는다.
- 발행 빈도: 실명 지갑당 연속 7일(`CURVE_WINDOW`) 안 최대 3개(`MAX_CURVES_PER_WINDOW`).
- 이름 1~32 bytes(`MAX_NAME_BYTES`), 심볼 1~10 bytes(`MAX_SYMBOL_BYTES`).
- `setCurveEnabled`(onlyOwner): 새 커브 개설만 막는다.
- 레지스트리: `allCurves`, `curvesByDev`, `curveOf(token)`, `devOf(token)`, `isCurve(curve)`, `nextAllowedAt(dev)`.

### 호가 자산 레지스트리 (`MapaeFactory`)

- `QuoteConfig { registered, enabled, decimals, curveVirtualQuote }`.
- `allowQuote(quote, curveVirtualQuote)`(onlyOwner): 한 번만 등록, decimals는 `IERC20Metadata.decimals()`로 저장,
  등록 후 가상 준비금과 decimals는 바꿀 수 없다.
- `setQuoteEnabled(quote, enabled)`(onlyOwner): 새 커브 개설 허용 여부만 바꾼다.
- view: `isQuoteAllowed`, `quoteConfig`, `allQuotes`. 정가 공모는 등급과 무관하게 `paymentToken`(KRWs)만 쓴다.

### 수수료 구조와 밴드 (`FeeRouter`, `MapaePool`, `Offering`)

커브 구간 요율(`getCurveFees`, `setCurveFees`):

| 몫 | 프리셋 | 밴드 |
|---|---|---|
| platform | 50 | 40~60 |
| dev | 35 | 20~40 |
| lpSeed | 15 | 0~20 |
| 합 | 100 | 80~100 |

AMM 프리셋 `TierFees(offering, platform, royalty, burn, lp, merch)`: L0 `(500, 40, 30, 0, 30, 0)`,
L1 `(750, 40, 60, 30, 20, 400)`, L2 `(750, 40, 60, 30, 20, 300)`.

| 밴드 | L0 | L1 / L2 |
|---|---|---|
| swapPlatform | 40~70 | 20~60 |
| 스왑 4필드 합 | 80~100 | 100~150 |
| 라우터 몫(platform + lp) | ≤ 70 | ≤ 60 |
| offering | 0~500 | 500~1000 |
| merch | 0 | 0~500 |
| 풀 몫(royalty + burn, `MapaePool` 생성자) | royalty ≤ 30, burn 0 | ≤ 90 |
| 풀 총 요율 | ≤ 100 (1.00%) | ≤ 150 (1.50%) |

- 정가 공모 per-pool 밴드(`Offering`): L1/L2 royalty ≤ 80, burn ≤ 50, 합 ≤ 90. L0 royalty ≤ 30, burn 0.
- `CurvePresets.BUYBACK_BPS` = 5000 상수는 있으나 플랫폼 수수료의 바이백 라우팅은 구현돼 있지 않다.

### 정가 공모 토크노믹스 (결정 21)

- 플랫폼 토큰 배분 없음(전 등급). 실행가능식은 `fBps + creatorTokenBps + lpTokenBps ≤ 10_000`.
- 정산 tx에서 잔여 물량(공급 − 판매분 − 크리에이터 몫 − LP 몫)과 LP 시딩 잉여를 소각(`RemainderBurned`).
- `AllocationRecipients`는 `(creatorVesting, platform)` 2개이고, platform은 공모 대금의 플랫폼 몫만 받는다.
- 기본 프리셋(공모 60 / 크리에이터 25 / LP 9)에서는 잔여 6%가 소각된다.

### 전송·실명 규칙

- 커브 토큰은 졸업 전 커브와의 왕복 전송만 허용(`MembershipToken`: 잠금 중 `to == offering` 예외), 졸업 시 해제.
- `MapaePool.swapQuoteForToken` / `swapTokenForQuote`는 전 등급에서 호출자와 수령자 모두 실명이어야 한다.
  `swapForBurn`(등록 burner), `convertAndBurn`, `mint`, `burn`은 게이트 없음.
- `MapaePool`, `PoolFactory.createPool`은 dojang 0 주소로 만들 수 없다.

## v5.2 변경 (Milestone A · 코어) — 이 절이 하위 절과 상충 시 **우선**

수수료 모델 개편 + 유틸리티 등급제를 코어에 반영 (태그 `v2.0-core`, 브랜치 `v2-dev`,
베이스라인 `v1.0-gasok`). 논업그레이더블·민트권한 소각·OZ v5 유지. [QUESTION]·스펙
이탈 상세는 `docs/WORKLOG_v2.md`.

- **FeeRouter (신규 모듈)** — 등급별 수수료 단일 소스. `enum UtilityTier {L0,L1,L2}`,
  `TierFees{offeringFeeBps, swapPlatformBps, swapRoyaltyBps, swapBurnBps, swapLpBps,
  merchFeeBps}`. 초기 프리셋 L0={500,60,20,20,0,0}/L1={750,40,60,30,20,400}/
  L2={750,40,60,30,20,300}. **온체인 밴드(하드코딩 상수, 오너도 위반 불가)**:
  L0 swapPlatform∈[60,80]·스왑합∈[80,100]·offering∈[0,500]·merch=0;
  L1/L2 스왑합∈[100,150]·swapPlatform∈[20,60]·offering∈[500,1000]·merch∈[0,500].
  `setFees` onlyOwner + 밴드 검증 revert, `platformTreasury` 교체 가능.
  **후원은 이 컨트랙트를 호출하는 경로가 없어 "후원 0%"를 코드 부재로 증명.**
- **등급제** — `createOffering(...,tier)`, Factory `tokenTier(token)` (전 모듈 게이트 근거),
  `isBurner(addr)` (swapForBurn 허용목록). **지갑당 라이브 토큰 = 버킷 분리(R3)**: liveL0 / 
  liveMembership(L1+L2) 독립 카운트 — L0 개설 `liveL0<3`, L1/L2 개설 `liveMembership==0`,
  **교차 보유 허용**(L0→L1 업셀 퍼널). 실패 공모(refunding+0공급)는 버킷별 슬롯 미소모.
  `minRaise` 배포 인자(테스트넷 500,000) — **L0 포함 전 등급** `R<minRaise` revert(Offering
  레벨 floor라 L0 가이드 우회와 무관).
- **등급별 밴드** — 기간 T: L1/L2 [12h,48h] / **L0 [1h,48h]**. 토크노믹스 L0: f∈[70,80]%,
  발행자 배분∈[5,15]%, **플랫폼 토큰=0 강제**, c 기본 25%. 베스팅 L0 3~6mo·클리프 0 허용.
  **L0는 `cancel()` 무조건 revert**(응모=확정), 프리즈 로직 비활성.
- **공모 대금 플랫폼 몫** — 하드코딩 10% → `FeeRouter.getFees(tier).offeringFeeBps`,
  **개설 시점 스냅샷**(진행 중 요율 변경 소급 금지). 실행가능식:
  `f + 발행자배분 + 플랫폼토큰배분 + c×f ≤ 100%`.
- **MapaePool 수수료 (방향별 4분할, R1)** — platform·LP 몫은 FeeRouter tier 조회(오버라이드
  불가), royalty·burn 몫은 **per-token 크리에이터 설정**(R2, 개설 시 tier 밴드 검증 + 스냅샷).
  방향별 수취로 **royalty는 항상 KRWs, treasury는 KRWs만 수취**:
  - 매수(KRW in): 4분할 전부 입력 KRWs 기준 — platform→treasury, royalty→creator,
    burn→burnBuffer, lp 잔류(라운딩 흡수 → 각 몫=floor(base×bps), 합=총 요율).
  - 매도(token in): burn·lp는 입력 토큰(burn 즉시 소각, lp 잔류), platform·royalty는
    **출력 KRWs**에서 수취(treasury/creator KRWs), 잔여 dust는 호출자(팬) 몫.
  - **불변식 17**: 임의 스왑 시퀀스 후 platformTreasury의 크리에이터 토큰 잔고는 항상 0.
- **per-token royalty·burn 밴드 (R2)** — L1/L2 royalty [0,80]bps·burn [0,50]bps,
  L0 royalty [0,30]·burn [0,50]. 기본값은 FeeRouter tier 테이블. platform·LP는 조회 유지.
- **`swapForBurn(amountIn,minOut)` — 수수료 0 경로**: Factory 등록 Sponsorship·BuybackVault만
  호출(그 외 revert), 출력은 풀이 원자 소각(반환 없음). `convertAndBurn`도 이 0% 경로로 통일.
- **RedeemManager** — `createPaidDrop`/`purchaseDrop` 유료 드랍(merchFee→treasury,
  환원율분→BuybackVault, 잔여→크리에이터). **L0는 소각형·유료 드랍 전부 revert.**
- **Sponsorship** — 소각 매수를 `swapForBurn`(0%) 경유로 교체, 환원율 route 훅.
  **L0 revert.**
- **BuybackVault (신규, 전역 싱글턴)** — `route`/`topUp`/`executeBuyback`(onlyExecutor)/
  `setExecutor`. **withdraw 계열 부재 = executor를 악의 주소로 바꿔도 KRWs는 소각 매수
  외 경로로 유출 불가**(핵심 불변식). 크리에이터별 환원율 0~30% 저장. L0 revert.
- **BuybackExecutor v1 (신규, 교체 가능 전략)** — `run(token)`: intervalSec(기본 24h),
  dailyCapBps(풀 깊이 대비, 기본 500), maxSlippageBps. onlyOwner (keeper 자동화는 로드맵).
- **IPrimaryMarket 추출** — `token()/settlementToken()/phase()`; Offering이 구현,
  Factory는 이 인터페이스로 상호작용(후속 CurveSale이 같은 자리에 꽂힘).

## 모듈 구성 (8개 — 이번 제출 최소 범위는 1–4번)

1. **MapaeFactory** — 크리에이터별 토큰+공모+리딤 스택 배포·와이어링. 호출자는 Dojang Verified Address 필수 (`IDojang.isVerified(msg.sender)` — **fail-closed**: 조회 실패 시 거부), `creator = msg.sender` 강제 (대리 발행 금지). **지갑당 발행 1회 = 라이브 기준 (M2 확정)**: 크리에이터당 활성 토큰 1개, 직전 공모가 실패 종료(`refunding && totalSupply == 0`)한 경우만 재발행 허용 — 실패는 슬롯을 소모하지 않음 (재도전 허용이 제품 의도). P·R·L은 플랫폼 가이드 밴드 검증 (오너 갱신 가능 config, 컨트랙트는 논업그레이더블). settle 권한은 항상 플랫폼 운영 지갑 (`platformOwner` 주입).
2. **MembershipToken (ERC-20 + EIP-2612 Permit)** — 고정 공급: 공모 확정 시 1회 민트 후 민트 권한 영구 소각. `burn/burnFrom`. 전송 훅 옵션: 지갑당 보유 상한(예: 총공급 3%), 상장 후 N일 양도 잠금. **cap 정책 (M2 확정)**: 클레임 지급(`from == offering`)은 cap **면제** — 1차 배정은 실명 지갑당 한도 L로 이미 제한되며, cap의 목적은 유통 시장 고래 축적 방지. 면제하지 않으면 모드 B 소량 판매 시 cap(S'×bps)이 배정량보다 작아져 claim이 막히는 조합이 존재. 소각·민트는 모든 게이트 예외.
3. **Offering (공모)** — 정가 단일 공모 (본딩커브·변동가 발행 금지):
   - 파라미터: `P` 발행가(결제토큰 기준), `R` 모금 목표, `T` 공모 기간(**12~48h**, 온체인 강제 — 기획 v4.5), `L` 지갑당 한도, `refundMode`. 취소 프리즈는 절대시간 2h 고정 (비례식 금지) — MIN 12h > 프리즈 2h 보장
   - 파생: 공모 물량 `Q_sale = R/P`, 총공급 `S = Q_sale/0.60` (개설 시점 확정)
   - `commit(amount)`: 결제토큰 전액 예치. Dojang 검증 + 지갑당 누적 ≤ L 강제. **발행자 지갑 자기 응모 컨트랙트 차단**
   - `cancel`: **마감 2시간 전까지만** 허용 (이후 프리즈 — 막판 일괄취소 어뷰징 차단)
   - `settle()`: 마감 후 균등+추첨 배정을 **오프체인 결정론적 계산** → 배정 머클루트만 온체인 커밋. 배정 규칙: ① 전원 min(신청량, floor(공모물량/참여자수)) 균등 배정 ② 잔여분 미충족 신청량 가중 추첨. 랜덤니스: 테스트넷 blockhash / 프로덕션 지연 블록해시 + 참가자 머클루트 커밋 (VRF 가용 시 교체). 시드 공개 → 누구나 재계산 검증 가능
   - `claim()`: 배정·환불 수령은 각자 풀(pull) 방식 — 참여자 수 무관 확장
   - 미달 시: 모드 A(올오어낫싱) 전액 환불·토큰 미발행 / 모드 B(부분 진행) 실판매분만 발행, 미판매분 `burnUnsold()` 소각
   - **공모 종료 전 토큰 전송·상장 불가.** 공모 대금 배분: 크리에이터 80 / LP 시딩 10 / 플랫폼 10 (가안)
4. **RedeemManager** — `createRedeemable(id, burnAmount, maxClaims, deadline)` (크리에이터), `redeem(id)` (소각 + 클레임 기록). 교환비는 장수 고정, 시세 무관.
5. **Vesting** ✅ **(M4 구현)** — 크리에이터 배분 수령처 = `MapaeVesting`(OZ VestingWalletCliff). 리니어 + 클리프, 밴드 12~48mo(기본 36) / 클리프 ≥3mo(기본 6), beneficiary = creator, 시작 = 공모 deadline, 철회 불가·논업그레이더블. `release()` 풀 방식.
6. **Sponsorship** ✅ **(M4 구현)** — `sponsorKRWs(krwAmount, message)`: X%(파라미터, 밴드 0~2000bps, 기본 1000) 풀에서 매수→즉시 소각, 나머지 크리에이터 이체. 이벤트에 KRW 표시액 + 메시지(오버레이용, 해시 인덱싱). `sponsorToken`은 스팟 환산액 기록. **슬리피지 가드**: 소각 매수는 스팟·수수료 반영 기대치 대비 최대 500bps 편차 내에서만 (얕은 풀 조작 방지 — §8-B ②). 후원 규모는 풀 깊이에 비례 제한됨.
7. **AMM/LP** ✅ **(M4 구현, D7·D8)** — 자체 미니멀 CPAMM `MapaePool`(x·y=k, UniV2 포크 아님) + `PoolFactory`(토큰당 1풀, 생성은 해당 토큰의 Offering만 — 프론트런 DoS 차단). **상장은 settle 원자 실행**: lpProceeds(c×모금액)와 토큰을 정확히 스팟가 P로 시딩, **LP 지분은 0xdEaD로 직접 민트** (영구 락업이 explorer에서 검증 가능 — 불변식 7·11). 스왑 수수료 2% 입력액 기준 3분할: 크리에이터 로열티(0~150bps, 기본 100) + 소각(0~100bps, 기본 50 — 토큰 입력은 즉시 소각, KRWs 입력은 burnBuffer 적립 후 누구나 `convertAndBurn()`으로 매수·소각하는 미니 바이백) + LP 강화(50bps 고정, 풀 잔류 → k 단조 증가). 전송 게이트 연동(D9): 풀은 cap 면제 + 양도 잠금 중 송신자로서 면제 — 락 중 매수 가능, 매도 불가.
8. **BuybackVault** (스트레치, 미구현) — TWAP 분할 매수 볼트는 로드맵. 소각 수수료의 `convertAndBurn()` 미니 바이백(모듈 7)이 "매출→매수→소각" 내러티브를 부분 커버.

## 토크노믹스 (총공급 S' 기준 — M2 파라미터화, 오너 확정 2026-07-21)

크리에이터가 밴드 내에서 설정 (스펙 4-B), 플랫폼 몫은 고정:

| 항목 | 파라미터 | 밴드 | 기본 프리셋 |
|---|---|---|---|
| 공모 | `fBps` | 50~70% | **60%** |
| 크리에이터 | `creatorTokenBps` | 15~30% | **25%** (36mo 베스팅, 6mo 클리프 — M4) |
| LP 시딩 | 파생 `l = c×f` (불변식 11) | — | **9%** (15%×60%) |
| 플랫폼 | 고정 500bps | — | **5%** |
| 커뮤니티 리저브 | 잔여 (라운딩 흡수) | — | **1%** |

**공모 대금 배분**: LP `cBps` (밴드 15~30%, 기본 **15%**) / 플랫폼 고정 10% / 크리에이터 = 잔여 (기본 **75%**)

**플랫폼 수익원 (라이브 기준 — 덱과 동기, 오너 확정)**: 플랫폼 수익 = **공모 대금 10%** (+ 토큰 배분 5%는 보유분). 현행 스왑 수수료 2%는 크리에이터 로열티 1.0 / 소각 0.5 / LP 강화 0.5(영구 락업 풀 잔류)로 **플랫폼 수취분 없음** — 플랫폼 스왑 수수료는 v2 로드맵. 환원(바이백)의 라이브 실체 = 스왑 소각 적립분 `convertAndBurn` 미니 바이백 + 후원 소각 X%. 매출 연동 TWAP BuybackVault는 Phase 3(8월) 로드맵.

**종합 실행가능성 검증 (Offering constructor)**: `f + creatorToken + 5% + (c×f) ≤ 100%` — 위반 시 `InvalidConfig`. 리저브 = 잔여 ≥ 0이 항상 성립하므로 settle은 밴드 내 전 조합에서 언더플로 불가 (fuzz 테스트로 검증). 기본 프리셋에서 f 실질 상한은 ~66%, c·creatorToken 최소치에서도 ~69.5%.

## 파라미터 밴드 (Factory 검증 로직 기준, 가안)

- 공모 비율 f: 50~70% (기본 60%) / 크리에이터 배분: 15~30% (기본 25%), 베스팅 12~48mo, 클리프 ≥3mo
- LP 대금 비율 c: **최소 15%**~30% (기본 15% — 오너 확정 2026-07-21)
- 스왑 로열티 0~1.5% / 스왑 소각률 0~1.0% / 후원 소각률 X 0~20% / 환원율 0~30%
- 최소 응모 금액: 플랫폼 하한 이상. P·R·L 밴드는 오너 확정 대기 (가안: P 1천 원~10만 원 상당, R 5백만 원~5억 원 상당, L 공모 물량의 0.1~5%)

## 설계 원칙

- **결제 토큰은 컨트랙트 파라미터** (IERC20 주입) — 테스트넷 MockKRW → 메인넷 USDT → KRWs 전환 경로. decimals 하드코딩 금지, `decimals()` 동적 처리
- 전 모듈 **논업그레이더블**, OpenZeppelin v5 외 의존성 금지
- Dojang 검증은 commit 시점 스냅샷 — 이후 KYC 만료는 기배정에 소급 적용하지 않음

## 불변식 (Invariants — 전부 Foundry invariant/fuzz 테스트 대상)

1. 총공급은 공모 확정 후 증가 불가 (`totalSupply` 단조 감소만 허용)
2. 공모가 미확정이면 어떤 토큰도 유통 불가
3. 지갑당 공모 배정 ≤ L, (옵션 활성 시) 지갑 보유 ≤ 상한
4. 모드 A에서 목표 미달 → 모든 예치금 환불 가능, 토큰 발행 0
5. 소각분은 어떤 경로로도 재발행·회수 불가
6. 크리에이터 베스팅 물량은 클리프 이전 이동 불가
7. LP 락업 토큰은 영구 인출 불가
8. 발행자 지갑은 자기 공모에 commit 불가
9. 공모 종료 전 전송·상장 불가 (공모와 AMM 공존 구간 없음)
10. 모드 B 미판매분은 소각 외 어떤 경로도 없음
11. LP 시딩은 l = c×f 준수 → 상장가 = 공모가 (파라미터 무관)
12. BuybackVault 매입 토큰은 소각 외 어떤 전송 경로도 없음 (홀더 분배 불가)

### v5.2 신규 불변식 (test/FeeRouterV2·InvariantsV2·PeripheralsV2 — 신규 28 테스트)

1. `swapForBurn`은 등록된 Sponsorship/BuybackVault 외 호출자에서 항상 revert (fuzz)
2. `swapForBurn` 실행 후 어떤 주소의 토큰 잔고도 증가하지 않고 `totalSupply`만 감소
3. L0 Offering `cancel()`은 모든 상태에서 revert (fuzz: 임의 금액·시각)
4. L0 공모는 플랫폼 토큰 배분 0 외 값으로 개설 불가
5. 모든 공모 개설 시 `R ≥ minRaise`
6. FeeRouter `setFees`는 밴드 밖 값에서 revert (경계값 ±1 + 전수 fuzz)
7. L0 `swapPlatformBps`는 어떤 갱신 경로로도 60 미만 불가 (fuzz)
8. L0 토큰은 RedeemManager(소각형·유료 드랍)·Sponsorship·BuybackVault 호출 전부 revert
9. BuybackVault: executor를 임의 주소로 교체해도 KRWs는 소각 매수 외 경로로 감소 불가 (fuzz)
10. 스왑 수수료 몫 = floor(base×bps), 방향별 base (매수=입력 KRWs / 매도=입력토큰(burn·lp)+
    출력 KRWs(platform·royalty)) — 매수 4분할 합 = 총 요율, 매도 출력분할 합 = grossOut,
    정밀도 손실 0 (fuzz 양방향)
11. 공모 진행 중 FeeRouter 갱신이 진행 중 공모 분배에 영향 없음 (스냅샷 검증)
12. 상장가 = 공모가 (l=c×f) — L0 프리셋(f=70%, c=25%)에서도 성립 (회귀)
17. 임의 스왑 시퀀스 후 platformTreasury의 크리에이터 토큰 잔고 = 0 (R1, fuzz) —
    treasury는 KRWs만 수취, royalty도 항상 KRWs

## 배포 환경

- GIWA Sepolia: chain ID 91342, RPC https://sepolia-rpc.giwa.io, Blockscout https://sepolia-explorer.giwa.io (verify: `--verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api`, API key 불필요)
- Dojang 실 주소: EAS `0x4200000000000000000000000000000000000021`, SchemaRegistry `0x4200000000000000000000000000000000000020`, DojangScroll `0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9`, Verified Address Schema UID `0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08`
