# MAPAE v3 — Phase 1 (L0 본딩커브) 작업 로그

브랜치 `v3-dev`. 베이스라인: `main` = 502b7ee (태그 `v2.0.1-core` 이후 머지), `v3-dev` = cca28a9.

## 베이스라인 사실

- `v3-dev` cca28a9 에서 `forge test` **190 그린** (0 실패). 신규 테스트 증분은 190 기준으로 보고한다.

## 완료 요약 (오너 로컬, cca28a9 까지)

- **C0** — `src/CurvePresets.sol` 플랫폼 프리셋 라이브러리 + 값 고정 테스트(`test/CurvePresets.t.sol`).
  v3.1 재작성으로 N(졸업 실명 거래자 수), 지갑당 매수 한도, 환불 바닥 프리셋 제거.
  L0 = 표준 커브 단일 포맷, 졸업 조건 = 커브 완판 하나.
- **C8** — MembershipToken 생성 코드를 링크 라이브러리(MembershipTokenDeployer)로 분리해
  EIP-170 여유 확보. OfferingDeployer 런타임 여유 **8,022 B**, MapaeFactory initcode 여유 **8,837 B**.

## T2 — CurveMath 라이브러리 + fuzz 불변식

파일: `src/lib/CurveMath.sol` (pure library, storage·수수료 없음), `test/CurveMath.t.sol`.

### 설계

- 모델: 가상 준비금 상수곱 `(Vq + r) × (Vt − s) ≥ Vq × Vt = k`.
  Vq 가상 호가 준비금, Vt 가상 토큰 준비금, r 실제 누적 호가 준비금, s 누적 판매량, S 판매 물량.
- API: `buyExactQuoteIn(p, r, s, quoteIn) → (tokensOut, quoteUsed)`,
  `sellExactTokenIn(p, r, s, tokenIn) → quoteOut` (tokenIn > s 면 revert),
  `costToSellOut(p, r, s)`, `spotPrice(p, r, s)` (분자·분모 반환), `validate(p)`.
- 모든 곱나눗셈은 OZ `Math.mulDiv(..., Rounding.Ceil)` 로 512비트 중간값 처리.
- 호가 decimals 는 라이브러리가 모른다. 원시 단위만 받는다.

### 라운딩 규칙

- **A (승인).** 매수 `tokensOut = (Vt − s) − ceil(k / (Vq + r + quoteIn))` 내림.
  `quoteUsed` 는 정상 매수에서도 산 물량의 올림 비용 `ceil(k / (Vt − s − tokensOut)) − (Vq + r)`.
  dust `quoteIn − quoteUsed` 는 같은 tx 에서 매수자에게 환불. 매도 `quoteOut` 내림.
  - 근거: 초안(정상 매수 `quoteUsed = quoteIn`)은 fuzz 에서 I2·I3·I5 실패.
    dust 가 r 에 slack 으로 쌓여 다음 거래자가 수 wei 를 추출할 수 있었다.
- **B (조건부 승인 → I9·I10 추가로 확정).** 비용이 0 으로 계산되는 매수는 `(0, 0)`.
  예외는 잔여 물량 `S − s` 전량을 가져가는 종결 매수뿐이며, 이는 `costToSellOut() == 0`
  (잔여분 가치 < 호가 1 단위)일 때만 무료가 된다. 완판(졸업) 도달 가능성을 위해 필요.
- 호출 컨트랙트 의무(NatSpec 명시): `tokensOut == 0` 매수는 revert, `quoteIn − quoteUsed` 는
  같은 tx 환불, 반환값 그대로 (r, s) 갱신, r 에 기부 금액 혼입 금지.

### 불변식 (test/CurveMath.t.sol)

| ID | 내용 |
|---|---|
| I1 | k 비감소: 임의 매수/매도 뒤 `(Vq + r)(Vt − s) ≥ Vq × Vt` |
| I2 | 왕복 무이익: x 로 산 토큰 전부 되팔면 `quoteOut ≤ quoteUsed ≤ x` |
| I3 | 물량 상한: `s ≤ S`, 과대 매수는 정확히 잔여 물량, `quoteUsed == costToSellOut ≤ quoteIn` |
| I4 | 분할 무이익: 두 번 나눠 사도 한 번에 산 것보다 토큰이 많지 않음 |
| I5 | 지급 능력: `sellExactTokenIn(s) == r` (≤ r 보다 강함) |
| I6 | 닫힌 해: 초기 `costToSellOut == ceil(Vq × S / (Vt − S))` + 티켓 참조 벡터 |
| I7 | I1~I5, I8 을 호가 decimals 6, 18 양쪽에서 실행 |
| I8 | 상태 불변식: 임의 시퀀스 뒤 `Vq + r == ceil(Vq × Vt / (Vt − s))` |
| I9 | 0원 매수: `costToSellOut() == 0` 일 때만 `tokensOut = S − s`, 그 외 `(0, 0)` |
| I10 | 무료 잔여분 상한: 비용 0 으로 나가는 물량은 항상 `S − s` 전량, 직전 `costToSellOut() == 0` |

CurveMath 테스트 24개, `FOUNDRY_FUZZ_RUNS=10000` 에서도 실패 0.

## 결정 기록

### C0 기하 변경 — 가상 토큰 준비금 10.73억 → 32억/3 (PM 확정 2026-11-14)

- 졸업 시 커브는 `r = Vq·S/(Vt − S)` 를 보유하고 종가는 `(Vq + r)/(Vt − S) = Vq·Vt/(Vt − S)²`.
- 풀 시딩가는 `r / DEX_SUPPLY = Vq·S / ((Vt − S)·DEX)`.
- 두 가격이 같을 조건: `DEX = S·(Vt − S)/Vt` ⇔ `Vt = S² / (S − DEX)`.
- S = 8억, DEX = 2억 ⇒ `Vt = 32억/3`, 상수 `1_066_666_666_666_666_666_666_666_667` (올림).
- 기존 10.73억에서는 풀 시딩가가 커브 종가보다 1.77% 높았다.
- 바뀐 근거 수치 (Vq 무관 비율):
  - 졸업 임계 = **3 × Vq** (KRWs 6,000,000 / WETH 1.8)
  - 졸업 FDV = **15 × Vq** (KRWs 30,000,000 / WETH 9)
  - 졸업가 / 시작가 = `(Vt/(Vt − S))²` = **16배**
- 신규 테스트: P1 (`graduationThreshold` 과 `CurveMath.costToSellOut` 차이 ≤ 1 wei, 실측 1 wei:
  floor vs ceil), P2 (|풀 시딩가 − 커브 종가| / 커브 종가 < 1e-9, 실측 약 1.25e-27).
  나머지 TOTAL/CURVE/DEX 공급, 가상 호가 준비금, 수수료, 바이백 상수는 변경 없음.

## 미결 메모

- **(a) 커브 LP 시드 수수료 0.15%.** `CURVE_FEE_LP_SEED_BPS` 누적분이 졸업 때 풀에 합류하면
  그만큼 풀 가격이 커브 종가 위로 올라간다(P2 는 수수료 제외 순수 커브 기준). 불변식 23
  문구는 졸업 티켓에서 확정.
- **(b) 라이브러리 링크 배포.** Offering 이 MembershipTokenDeployer 에 링크되므로
  `script/Deploy.s.sol` 과 `verify-children.js` 에 라이브러리 주소 처리가 필요하다 (배포 티켓).

## T3 — C1 호가 자산 레지스트리 + 프리셋 decimals 정리

### 범위 판단 (지시서 v3.1 C1 대비)

- FixedOffering(`Offering.sol`)은 이미 `paymentToken` 을 파라미터로 받고 decimals 를 하드코딩하지
  않는다. 정가 공모는 전 등급 KRWs 전용이므로 팩토리의 `paymentToken` 을 그대로 쓴다.
  `Offering.sol`, `PoolFactory.sol`, `MapaePool.sol`, `FeeRouter.sol` 은 수정하지 않았다.
- 이 티켓의 산출물은 CurveSale 이 쓸 "허용 호가 자산 목록"이다.

### 레지스트리 설계 (`src/MapaeFactory.sol`, 기존 함수·생성자·이벤트 무변경)

- `QuoteConfig { registered, enabled, decimals, curveVirtualQuote }`, `mapping(quote => QuoteConfig)`,
  등록 순서 배열 `_allQuotes`.
- `allowQuote(quote, curveVirtualQuote)` onlyOwner: 0 주소 → `ZeroAddress`, 0 값 → `ZeroCurveVirtualQuote`,
  재등록 → `QuoteAlreadyRegistered` (비활성화 뒤에도 재등록 불가). decimals 는
  `IERC20Metadata.decimals()` 로 읽어 저장. 등록 즉시 enabled. 이벤트 `QuoteAllowed`.
- `curveVirtualQuote`, `decimals` 를 바꾸는 경로는 존재하지 않는다 (가격 경로 = 플랫폼 프리셋).
- `setQuoteEnabled(quote, enabled)` onlyOwner: 미등록 → `QuoteNotRegistered`. 신규 커브 개설 가능
  여부만 바꾼다(열린 커브·풀은 스냅샷 사용 예정). 이벤트 `QuoteEnabledSet`.
- view: `isQuoteAllowed` (registered && enabled), `quoteConfig`, `allQuotes`.
- 생성자에서 `paymentToken` 자동 등록 안 함. 등록은 배포 스크립트 몫(이번 티켓 범위 밖).

### CurvePresets decimals 정리

- `VIRTUAL_QUOTE_RESERVE_KRWS = 2_000_000e18` 제거 → `VIRTUAL_QUOTE_KRWS_WHOLE = 2_000_000` +
  `krwsVirtualQuote(decimals) = WHOLE × 10 ** decimals`.
- `VIRTUAL_QUOTE_RESERVE_WETH = 0.6e18` 유지. 근거: GIWA WETH predeploy 는 18 decimals 고정.
- KRWs 6 / 18 decimals 각각 임계 = 3 × Vq, P1, P2 테스트 추가. P2 헬퍼는 6 decimals 에서
  1e18 스케일 나눗셈 정밀도 손실(3e4 수준)로 실패해 교차곱 비교로 바꿨다(기준 1e-9 동일).

### WETH 확인 사실

- GIWA Sepolia `0x4200000000000000000000000000000000000006`: `symbol() = "WETH"`, `decimals() = 18`
  (PM 확인. 이 세션에서는 RPC 가 네트워크 정책으로 차단되어 직접 호출하지 않음).

### 사이즈 (`forge build --sizes`)

| 컨트랙트 | runtime | initcode | runtime 여유 | initcode 여유 |
|---|---|---|---|---|
| MapaeFactory | 8,817 B | 41,630 B | 15,759 B | 7,522 B |
| OfferingDeployer | 16,554 B | 16,582 B | 8,022 B | 32,570 B |

MapaeFactory initcode 여유는 8,837 → 7,522 B (−1,315 B). 4 KiB 가드 통과.

테스트: 217 + 8 (QuoteRegistry 7, CurvePresets 1) = **225 그린**.

## T4 — MapaePool / PoolFactory krw → quote 개명 (동작 변경 0)

목적: v3 에서 WETH 호가 커브도 졸업 후 같은 MapaePool 을 쓰므로 풀 외부 인터페이스에서 "krw" 를
"quote" 로 바꾼다. 로직, 수수료 계산, 라운딩, 이벤트 타입·순서·indexed 는 변경 없음.

| 이전 | 이후 |
|---|---|
| `IERC20 public immutable krw` | `quote` |
| `uint256 public reserveKrw` | `reserveQuote` |
| `swapKrwForToken(amountIn, minOut, to)` | `swapQuoteForToken` |
| `swapTokenForKrw(amountIn, minOut, to)` | `swapTokenForQuote` |
| `getKrwOut(tokenIn)` | `getQuoteOut` |
| `getTokenOut(krwIn)` 인자명 | `quoteIn` |
| `burn(to)` 반환값 `amountKrw` | `amountQuote` |
| `LiquidityMinted` / `LiquidityBurned` 의 `krwAmount` | `quoteAmount` |
| `ConvertedAndBurned` / `BurnSwapped` 의 `krwIn` | `quoteIn` |
| 생성자 `krw_`, 내부 변수(`krwBal`, `amountKrw`), NatSpec 의 KRWs 표기 | `quote_`, `quoteBal`, `amountQuote`, quote |
| `PoolFactory.createPool` 인자 `krw` | `quote` |

호출부: `BuybackExecutor.reserveQuote()`, script/Demo* 3개, test/ 4개 파일(이름만, 단언·수치 무변경).
web/, deployments/, MockKRW·RedeemManager·Sponsorship·BuybackVault 자체 식별자, FeeRouter 는 무변경.

ABI 셀렉터가 바뀌므로 v2.0.1 배포와 호환되지 않으며 v3 는 신규 배포다.

테스트: 개명 전후 **225 그린** 동일.

## T5 — 풀 스왑 실명 게이트 + 토큰 전송 잠금 확장 + Swapped 인자 개명

### 결정 기록 (PM 2026-11-14)

- **결정 A.** 커브 토큰은 졸업 전에는 커브와 주고받는 전송만 허용하고 졸업 시 해제한다.
- **결정 B.** MapaePool 의 스왑은 실명(Dojang) 지갑만 할 수 있다. L0, L1, L2 전 등급의 풀에 적용
  (STATUS 결정 4 "실명 1인 1지갑은 전 트랙 공통").
- **알려진 한계.** 졸업 후 토큰 전송은 자유이므로 외부 DEX 에 제3자가 풀을 만드는 것은 막지 않는다.

### 풀 게이트 대상 / 비대상

| 함수 | 게이트 | 근거 |
|---|---|---|
| `swapQuoteForToken` | msg.sender 와 `to`(≠ sender 일 때) 모두 `isVerified` | 결정 B |
| `swapTokenForQuote` | 동일 | 결정 B |
| `swapForBurn` | 없음 (기존 burner 레지스트리 제한 유지) | 출력 전량 소각, 호출자 제한 이미 존재 |
| `convertAndBurn` | 없음 | 출력 전량 소각 |
| `mint`, `burn`, view | 없음 | 유동성 시딩·LP 경로, 조회 |

- Dojang 조회가 revert 하면 스왑도 revert (fail-closed, try/catch 없음).
- `MapaePool` 생성자와 `PoolFactory.createPool` 에 `IDojang` 인자 추가(마지막 인자). 0 주소면 각각
  `ZeroAddress` / `ZeroDojang` revert. `Offering._listAtPar` 는 자기 `dojang` 을 넘긴다.
- `Swapped` 이벤트 `bool krwIn` → `bool quoteIn` (타입·순서 그대로, T4 잔여분).

### 토큰 변경 2건 (`src/MembershipToken.sol`, 생성자 시그니처 유지)

1. 전송 잠금 예외 추가: 잠금 중이라도 `to == offering` 인 전송 허용 (커브에 되파는 경로).
2. `endTransferLock()`: offering 만 호출 (`NotOffering`), 잠금 중이면 `transferLockUntil = block.timestamp`
   + `TransferLockEnded(timestamp)`, 아니면 no-op. CurveSale(다음 티켓)이 졸업 tx 에서 호출 예정.

L1 토큰도 잠금 중 offering 으로의 전송이 허용되는 것이 유일한 동작 변화다.

### 테스트 / 사이즈

- 신규: `test/PoolDojangGate.t.sol` G1~G6 (6), `test/MembershipTokenCurveLock.t.sol` L1~L4 (4).
- 설정부만 수정: `test/MapaePool.t.sol`, `test/Sponsorship.t.sol` (MockDojang 배포, 스왑 주체 검증,
  `createPool` 인자 추가). 단언·수치 무변경. 나머지 E2E 는 Offering 경유라 기존 검증 지갑으로 통과.
- 합계 225 → **235 그린**.

| 컨트랙트 | runtime | initcode | runtime 여유 | initcode 여유 |
|---|---|---|---|---|
| MapaePool | 9,646 B | 10,978 B | 14,930 B | 38,174 B |
| Offering | 10,710 B | 15,359 B | 13,866 B | 33,793 B |
| OfferingDeployer | 16,605 B | 16,633 B | 7,971 B | 32,519 B |
| MapaeFactory | 8,817 B | 41,681 B | 15,759 B | 7,471 B |

## T6 — FeeRouter 커브 구간 요율 + L0 스왑 밴드 조정 (지시서 v3.1 C6 중 요율 부분)

v3 요율 (PM 확정): 커브 1.00% = 플랫폼 0.50 / Dev 0.35 / LP 시드 0.15, AMM 1.00% = 플랫폼 0.40 /
Dev 0.30 / LP 0.30. `CurvePresets` 의 `CURVE_FEE_*`, `SWAP_FEE_*` 상수와 일치(F4 테스트로 고정).

### L0 밴드와 프리셋 (이전 → 이후)

| 항목 | 이전 | 이후 |
|---|---|---|
| `L0_SWAP_PLATFORM_MIN` | 60 | **40** |
| `L0_SWAP_PLATFORM_MAX` | 80 | 80 |
| L0 스왑 합 밴드 | 80~100 | 80~100 |
| L0 offering / merch | 0~500 / 0 | 0~500 / 0 |
| L0 프리셋 (offering, platform, royalty, burn, lp, merch) | (500, 60, 20, 20, 0, 0) | **(500, 40, 30, 0, 30, 0)** |
| L1 / L2 밴드·프리셋 | — | 변경 없음 |

### 커브 요율 (신설)

- `IFeeRouter.CurveFees { platformBps, devBps, lpSeedBps }`, `getCurveFees()`, `setCurveFees()` onlyOwner,
  이벤트 `CurveFeesUpdated(old, new)`. 초기값 **(50, 35, 15)**.
- 하드 밴드 (상수, 오너도 위반 불가): platform **40~60**, dev **20~40**, lpSeed **0~20**, 합 **80~100**.
- 생성자 프리셋과 `setCurveFees` 가 같은 `_validateCurve` 를 탄다 (기존 `_validate` 패턴).

### 고친 기존 테스트 (`test/FeeRouterV2.t.sol`, L0 밴드 하한·프리셋에 묶인 것만)

| 테스트 | 바뀐 숫자 |
|---|---|
| `test_InitialPresets` | L0 platform 60→40, royalty 20→30, burn 20→0, lp 0→30 (합 100 단언 유지) |
| `test_Band_L0_Boundaries` | 하한 경계 59 revert / 60 ok → 39 revert `(500,39,41,20,0,0)` / 40 ok `(500,40,40,20,0,0)` |
| `testFuzz_L0_SwapPlatformFloor` (불변식 7) | inBand 하한·`assertGe` 60→40 ("L0 swapPlatformBps 는 어떤 갱신 경로로도 40 미만 불가") |
| `testFuzz_SetFees_NeverEscapesBand` | L0 저장값 하한 단언 60→40 |

밴드와 무관한 단언(합·offering·merch 경계, L1/L2)은 그대로. 플랫폼 60 을 쓰는 나머지 L0 경계
케이스는 새 밴드 안이라 유지.

### 테스트

- 신규 `test/FeeRouterCurve.t.sol` F1~F5 (6: F2 는 경계 ±1 + 전수 fuzz 2개).
- 합계 235 → **241 그린**. FeeRouter runtime 3,602 B (여유 20,974 B).

### 메모

- 바이백 50% 라우팅(`BUYBACK_BPS`)은 미구현. 플랫폼 토큰과 호가 자산별 Vault 경로가 정해진 뒤 별도 티켓.

## T7 — CurveSale 본체 + L0 풀 요율 상한

### 결정: L0 풀 burn 몫 0 (PM, T6 질문 2 회신)

- `Offering` 생성자 per-pool 밴드: `tier == L0` 이고 `swapBurnBps != 0` 이면 `InvalidConfig`.
  L0 royalty 상한 30 유지, L1/L2 무변경.
- 결과: L0 풀 총 스왑 요율 = platform 40 + lp 30 + royalty(0~30) + burn 0 ≤ **100 bps**.
- 고친 기존 테스트(설정값만, 기대 수치 변화 없음): `MapaeFactory.t.sol` `l0CreateParams` burn 20→0,
  `InvariantsV2.t.sol` `_cp` / `_directParams` 의 `l0 ? 20 : 30` → `l0 ? 0 : 30`,
  `test_R2_SwapRoyaltyBurnBands` L0 경계 30/50 ok → 30/0 ok.
- 신규 `test/L0PoolFeeCap.t.sol`: burn 1~50 이면 revert (fuzz), 상장된 L0 풀 `totalFeeBps() ≤ 100` (fuzz).

### CurveSale 설계 요약 (`src/CurveSale.sol`)

- `IPrimaryMarket` 구현, 논업그레이더블, OZ v5 만, `ReentrancyGuard`.
- 생성자(`InitParams` struct): 0 주소·`virtualQuote == 0` revert. FeeRouter `getCurveFees()` 를
  immutable 스냅샷. `MembershipTokenDeployer.deploy(..., CURVE_LOCK_DURATION = 100 × 365 days, 0, [])`,
  `mintAllocations([this], [TOTAL_SUPPLY])` 로 전량 자기 민트(민트 권한 영구 소각).
- 기하는 `CurvePresets`, 가격은 `CurveMath` 만 사용(자체 가격식 없음).
- `buy(quoteIn, minTokensOut)` / `sell(tokenIn, minQuoteOut)`: 실명 게이트(fail-closed), 졸업 후 revert.
  토큰은 msg.sender 에게만. 첫 매수 주소 `hasBought`, dev 제외 `verifiedBuyerCount` 증가.
- `s == CURVE_SUPPLY` 가 되는 매수와 같은 tx 에서 `_graduate()`: L0 풀 생성(royalty
  `SWAP_FEE_DEV_BPS` 30, burn 0, creator = dev), `registerPool`, DEX_SUPPLY + (r + lpSeedAccrued) 시딩,
  LP 전량 0xdEaD, `endTransferLock()`, `graduationReserve = r`, `r = 0`, `lpSeedAccrued = 0`.
- `claimDevFees()` dev 전용, `sweepPlatformFees()` 누구나 호출 → `feeRouter.platformTreasury()`.
  졸업 후에도 동작. 발행 토큰이 수수료로 나가는 경로 없음.
- view: `quoteBuy`, `quoteSell` (실행과 같은 내부 함수 `_quoteBuy`/`_quoteSell` 을 공유 → wei 단위 일치),
  `spotPrice`, `token`, `settlementToken`(= quote), `phase`(졸업 전 Open, 후 Settled).
- 사이즈: runtime 7,922 B (EIP-170 여유 16,654 B), initcode 10,323 B.

### 수수료 청구식

- t = platformBps + devBps + lpSeedBps (스냅샷, 기본 50 + 35 + 15 = 100).
- 매수: `net = quoteIn − floor(quoteIn·t/1e4)`, `(tokensOut, quoteUsed) = CurveMath.buyExactQuoteIn(net)`,
  `P = min(quoteIn, ceil(quoteUsed·1e4/(1e4 − t)))`, `fee = P − quoteUsed`,
  `platform = floor(P·pb/1e4)`, `dev = floor(P·db/1e4)`, `lpSeed = fee − platform − dev`.
  매수자에게서 정확히 P 만 `transferFrom`.
- 매도: `gross = CurveMath.sellExactTokenIn`, `fee = floor(gross·t/1e4)`, platform·dev 는 gross 기준 floor,
  lpSeed = 나머지, 지급 `gross − fee` 는 r 에서만.

### 불변식 대응

| 테스트 | 내용 | 지시서 v3.1 |
|---|---|---|
| C1 | 미검증 주소 buy/sell revert, Dojang revert 시 fail-closed | **26** (매수·매도) |
| C2 | 졸업 전 quote 잔고 = r + 적립 3종, 토큰 잔고 = TOTAL − s | **18** |
| C3 | 매수자 잔고 감소 = quoteSpent ≤ quoteIn, 과대 마감 매수도 필요분만 | **19** |
| C4 | platform + dev + lpSeed = fee, 식 일치, quoteBuy/quoteSell = 실행 | — |
| C5 | treasury 토큰 잔고 0, dev 토큰 = 직접 매수 − 매도 | **17** (treasury 토큰 0) |
| C6 | 실명 지갑 1개가 1회 매수로 셀프졸업 | **20** |
| C7 | 실명 카운트 주소당 1회, dev 제외, 단조 | **21** |
| C8 | LP 전량 dEaD, 풀 준비금 = DEX / r + lpSeed, 풀 스팟 ≥ 커브 종가 | **23** |
| C9 | 졸업 전 보유자 간 전송 revert, 제3자 createPool revert, 졸업 후 전송 | — |
| C10 | 졸업 후 buy/sell revert, 수수료 인출 정상, 풀 스왑·totalFeeBps 100 | — |
| C11 | 전원 전량 매도 시 모두 지급, r = s = 0, 적립금 유지 | — |
| C12 | 슬리피지·tokensOut 0 revert | — |
| C13 | claimDevFees dev 만, sweep 은 treasury 로만 | — |

대응표는 T8 에서 PM 이 준 지시서 v3.1 C9 원문으로 채웠다(아래 T8 절 표 참고). "—" 는 대응하는 번호 없음.

**불변식 23 새 문구:** 준비금 기준으로 풀 스팟가 = 커브 종가, LP 시드 합류분만큼만 위로.
실측 (호가 3종, 혼합 이력 후 졸업): (풀 − 종가)/종가 = lpSeed/r = 0.16856% (1e-9 이내 일치),
lpSeedBps 0 커브에서는 상대 오차 0 / 1.7e-13 / 1e-18 (KRWs18 / 6-dec / WETH).

### 테스트

- 신규: `L0PoolFeeCap.t.sol` 2, `CurveSale.t.sol` 15 × 호가 3종(KRWs 18, 6-dec, WETH 18 Vq 0.6e18) = 45.
- `BytecodeSize.t.sol` 목록에 CurveSale 추가.
- 합계 241 → **288 그린**.

## T8 — CurveFactory (커브 개설, Dev 첫 매수, 발행 빈도 제한) + CurveSale.buyFor

### 지시서 v3.1 C9 불변식 대응표 (T7 표 확정)

| 번호 | 원문 | 테스트 |
|---|---|---|
| 17 | platformTreasury 의 발행 토큰 잔고 항상 0, 전 트랙 적용 | C5 (커브), K9 (전 과정), v2 InvariantsV2 17 (정가 공모) |
| 18 | 커브 매수 후 실 준비금 + 적립 수수료 == 누적 순입금 | C2 |
| 19 | 과납 불가: 졸업 매수 tx 에서 환불 + 사용 금액 == 입력 금액 | C3 |
| 20 | 단일 실명 지갑이 커브 전량을 매수해 졸업시킬 수 있다 | C6, K5 (개설 tx 안 졸업) |
| 21 | verifiedBuyerCount 는 단조 증가, Dev 주소는 영구 미포함 | C7, K5 |
| 23 | 준비금 기준으로 풀 스팟가 = 커브 종가, LP 시드 합류분만큼만 위로, LP 100% 0xdEaD | C8 |
| 26 | 미검증 주소는 생성·매수·매도 전부 revert | 매수·매도 C1, 풀 스왑 T5 G1, 생성 K1 |

22, 24, 25 는 삭제된 번호.

### CurveSale.buyFor (커밋 1)

- `factory = msg.sender`(생성자) immutable. `buy` 본문을 `_buy(trader, payer, quoteIn, minTokensOut)` 로 이동,
  `buy` 는 `_buy(msg.sender, msg.sender, ...)` (동작 변화 없음, 기존 CurveSale 테스트 무수정 그린).
- `buyFor(trader, ...)`: factory 만(`NotFactory`). 실명 게이트·카운트·isDev·이벤트 trader 는 trader 기준,
  호가는 factory 에게서, 토큰은 trader 에게.

### CurveFactory (`src/CurveFactory.sol`, 커밋 2)

- **MapaeFactory 와 분리한 이유:** MapaeFactory initcode 는 OfferingDeployer·StackDeployer 생성 코드를
  이미 품어 여유가 7,396 B 뿐이다. CurveSale 생성 코드(10,673 B)를 넣으면 EIP-3860 한도를 넘는다.
  CurveFactory 는 MapaeFactory 를 호가 레지스트리(`isQuoteAllowed`, `quoteConfig`)와 풀 burner
  레지스트리로만 참조하며 MapaeFactory 는 수정하지 않았다.
- 검사 순서: `curveEnabled` → `dojang.isVerified(msg.sender)` (fail-closed) → `isQuoteAllowed(quote)` →
  발행 빈도 → name 1~32 bytes, symbol 1~10 bytes. virtualQuote 는 레지스트리 값(호출자 지정 불가).
- **발행 빈도 규칙:** 실명 지갑 하나당 연속 7일 안 최대 3개. 지갑별 최근 3개 개설 시각 링버퍼,
  가장 오래된 시각 + 7일 > now 이면 `CurveRateLimited(nextAllowedAt)`. 정확히 7일이 지난 시각부터 가능.
  실패한 개설 시도는 tx 전체가 되돌려지므로 슬롯을 소모하지 않는다.
- `curveEnabled` (기본 true, onlyOwner 토글): 신규 개설만 차단, 기존 커브 거래·졸업 무영향.
- 레지스트리: `allCurves`, `curvesByDev`, `curveOf(token)`, `devOf(token)`, `isCurve(curve)`, `nextAllowedAt(dev)`.
- **Dev 첫 매수 흐름** (`devBuyQuoteIn > 0`): dev → factory 로 devBuyQuoteIn 수취 → curve 에 approve →
  `buyFor(dev, devBuyQuoteIn, minTokensOut)` → 미사용분 dev 환불 → approve 0. 개설 tx 안에서 완판·졸업 허용.
  종료 시 factory 의 호가 잔고와 curve allowance 는 0 (K5).

### 알려진 동작

- **풀 주소 선입금:** 풀 주소는 PoolFactory nonce 로 예측 가능하다. 졸업 전 누군가 그 주소로 호가 자산을
  보내면 졸업 시 `mint` 가 그 잔고까지 시딩에 포함해 풀 가격이 위로만 오른다(토큰은 잠금으로 보낼 수 없음).
  손실은 기부자 본인에게만 있어 대응하지 않는다 (PM 결정, T7 이탈 5).
- **커브 토큰과 L1 모듈:** BuybackVault 의 `route`/`topUp` 은 `ITierSource(token.offering()).tier()` 를
  부르는데 CurveSale 은 `tier()` 가 없어 호출 자체가 revert 한다(K10). 명시적 `TierNotAllowed` 는 아니다.

### 사이즈

| 컨트랙트 | runtime | initcode | runtime 여유 | initcode 여유 |
|---|---|---|---|---|
| CurveFactory | 15,942 B | 16,507 B | 8,634 B | 32,645 B |
| CurveSale | 8,250 B | 10,673 B | 16,326 B | 38,479 B |

### 테스트

- 신규 `test/CurveFactory.t.sol`: K1~K8, K10 13개 × 호가 3종 + K9 (KRWs) 1 = 40. `BytecodeSize` 에 CurveFactory 추가.
- K9 가스 (forge 테스트 내 측정): createCurve 3,428,813 / 일반 buy 67,809 / 졸업 buy 2,401,255.
- 합계 288 → **328 그린**.

### 남은 작업

- ETH 라우터 (ETH → WETH 래핑 후 buy/sell, 매도 시 언랩).
- 배포 스크립트: CurveFactory 배포, `allowQuote` 등록, MembershipTokenDeployer 라이브러리 링크
  (`Deploy.s.sol`, `verify-children.js`).
- DemoCurve 스크립트 (개설 → 매수 → 졸업 → 풀 스왑 시연).

## T9 — ETH 로 커브 매수 (CurveFactory) + CurveSale.tier()

### CurveSale.tier() (커밋 1)

- `tier()` external pure → 항상 `UtilityTier.L0` (ITierSource 호환). T8 이탈 1 처리: BuybackVault `route`/`topUp` 이
  커브 토큰에 대해 `TierNotAllowed` 로 **명시적으로** revert 한다. K10 을 이 selector 단언으로 수정.

### ETH 경로 (커밋 2, `src/CurveFactory.sol`, `src/interfaces/IWETH.sol`)

- **factory 에 둔 이유:** `CurveSale.buyFor` 를 부를 수 있는 유일한 주소가 CurveFactory 다. ETH 래핑을
  factory 에 두면 새 권한·새 컨트랙트 없이 실명 게이트(`buyFor` 안의 trader 검사)를 그대로 재사용한다.
  별도 라우터를 두려면 CurveSale 에 두 번째 권한 주소가 필요했다.
- 생성자에 `IWETH weth` 추가(0 주소 revert, immutable). IWETH = IERC20 + `deposit()` payable + `withdraw(uint256)`.
- `buyWithETH(curve, minTokensOut)`: `isCurve` 아니면 `NotCurve`, quote ≠ weth 면 `NotWethCurve`, `msg.value == 0`
  이면 `ZeroValue`. deposit → approve → `buyFor(msg.sender, msg.value, min)` → approve 0 → 미사용분 withdraw 후 ETH 환불
  (실패 시 `EthRefundFailed`, tx 전체 revert).
- `createCurveWithETH(name, symbol, minTokensOut)`: createCurve 와 같은 검사 함수(`_open`)와 같은 발행 빈도 슬롯.
  quote = weth 고정(레지스트리에 weth 가 허용돼 있어야 함). `msg.value` 가 Dev 첫 매수 금액, 0 이면 개설만.
- `receive()`: `msg.sender == weth` (withdraw 환불 경로)만 허용, 그 외 `DirectEthRejected`.
- 모든 함수 종료 후 factory 의 ETH 잔고·WETH 잔고·curve allowance 는 0 (W1~W10 에서 단언).
- 재진입: `buyWithETH`/`createCurveWithETH` 모두 `nonReentrant`. 환불 수신 중 재호출은 안쪽 revert → 환불 실패 →
  바깥 tx 전체 revert (W6).

### 한계

- 매도(`CurveSale.sell`)와 졸업 후 풀 스왑에는 ETH 경로가 없다. 매도 대금과 풀 스왑 출력은 **WETH** 로 나간다.
  사용자가 직접 unwrap 해야 한다 (이 티켓 범위 밖).

### 테스트 / 사이즈

- 기존: `test/CurveFactory.t.sol` 생성자 인자 추가(설정부)와 K10 단언 강화만.
- 신규 `test/CurveFactoryETH.t.sol` W1~W10 (11, WETH9 방식 테스트 래퍼 포함). 합계 328 → **339 그린**.
- 가스 (첫 매수, 신규 커브라 저장 슬롯이 콜드): buyWithETH 일반 356,233 / 마감(졸업 포함) 2,704,068.

| 컨트랙트 | runtime | initcode | runtime 여유 | initcode 여유 |
|---|---|---|---|---|
| CurveFactory | 17,626 B | 18,293 B | 6,950 B | 30,859 B |
| CurveSale | 8,300 B | 10,723 B | 16,276 B | 38,429 B |

## T10 — 결정 21 반영: 플랫폼 토큰 배분 제거 + 잔여 물량 소각

### 결정 기록

- **STATUS 결정 21:** 플랫폼은 어떤 경로로도 크리에이터 토큰을 받지 않는다. 전 트랙.
- **2026-11-14 추가 결정:** 정가 공모의 잔여 물량(공급 − 판매분 − 크리에이터 몫 − LP 몫)은 리저브 주소로
  보내지 않고 정산 tx 에서 소각한다.

### 배분 흐름 (이전 → 이후, 정가 공모 settle)

| 몫 | 이전 | 이후 |
|---|---|---|
| 판매분 | Offering (클레임 대기) | 동일 |
| 미판매분 | 민트 후 소각 (`UnsoldBurned`) | 동일 |
| 크리에이터 | 베스팅 | 동일 |
| LP | 풀 시딩, 잉여는 **reserve** | 풀 시딩, 잉여는 **소각** (`RemainderBurned`) |
| 플랫폼 토큰 | L1/L2 5% → `recipients.platform`, L0 0% | **없음** (모든 등급) |
| 잔여(라운딩 포함) | **reserve** | Offering 에 민트 후 같은 tx 에서 **소각** (`RemainderBurned`) |

- 코드: `PREMIUM_PLATFORM_TOKEN_BPS`(Offering, MapaeFactory), `OfferingParams.platformTokenBps`,
  `Offering.platformTokenBps`, 관련 밴드 검사 제거. 실행가능성 = `fBps + creatorTokenBps + lpTokenBps ≤ 10_000`.
- `IOffering.AllocationRecipients` / `MapaeFactory.FeeRecipients` 에서 `reserve` 제거(0 주소 검사·capExempt 포함).
  `recipients.platform` 은 공모 대금의 플랫폼 몫(호가 자산) 수령처로만 남고 **발행 토큰을 받지 않는다** (NatSpec 명시).
- 신규 이벤트 `RemainderBurned(uint256)` (잔여 소각, LP 잉여 소각 각각 발행).
- 민트 1회, 정가 상장, 환불 모드, 공모 대금 분배 로직 무변경.
- 기본 프리셋(공모 60 / 크리에이터 25 / LP 9)에서는 잔여 **6%** 가 소각된다(이전 플랫폼 5 + 리저브 1).
  L0 프리셋(70 / 5 / 17.5)은 7.5%.

### 바꾼 기존 테스트 (단언 변경분)

| 테스트 | 이전 단언 | 이후 단언 |
|---|---|---|
| `Offering.t.sol` `test_Settle_DistributionAndProceeds` | totalSupply 50, platform 2.5, reserve 0.5 | totalSupply **47**, platform **0**, reserve **0** |
| `Offering.t.sol` `testFuzz_SettleReserveNeverUnderflows` | Σ(offering, vesting, pool, platform, reserve) = S' = totalSupply, 실행가능성에 +500 | platform+reserve 0, Σ(offering, vesting, pool) = totalSupply = sold + creator + pool ≤ S', 실행가능성 +500 제거, 경계 fallback ct 2000→2500 |
| `Offering.t.sol` `testFuzz_SettleFeasibleAcrossBands` | 위와 같음 | 위와 같음 |
| `OfferingE2E.t.sol` `test_E2E_Oversubscribed_ModeA` | totalSupply = S' | totalSupply = sold + creator + pool, platform 0 |
| `OfferingE2E.t.sol` `test_E2E_Undersubscribed_ModeB` | totalSupply 100, platform 5, reserve 1 | totalSupply **94**, platform **0**, reserve **0** |
| `InvariantsV2.t.sol` `testFuzz_Inv4_L0PlatformTokenMustBeZero` → `testFuzz_Inv4_NoPlatformTokenAnyTier` | L0 은 platformTokenBps ≠ 0 이면 revert | 필드 삭제로 대체: L0/L1/L2 정산 후 platform·treasury 토큰 잔고 0 |
| `MapaeFactory.t.sol` `test_Create_WiresFullStack` | `recipients()` 3개 중 reserve == reserve | `recipients()` 2개(reserve 단언 삭제) |

설정부만 수정: `OfferingTestBase`, `OfferingInvariant.t.sol`, `InvariantsV2.t.sol`(`_directParams`, factory 생성),
`PeripheralsV2.t.sol`, `MapaeFactory.t.sol`(factory 생성). 스크립트: `Deploy.s.sol`, `DemoV2.s.sol` 의
`FeeRecipients` 리터럴에서 `reserve` 제거(컴파일 수정만).

### 테스트 / 사이즈

- 신규 `test/NoPlatformTokens.t.sol` N1~N5 (5). 합계 339 → **344 그린**.

| 컨트랙트 | runtime | initcode | runtime 여유 | initcode 여유 |
|---|---|---|---|---|
| Offering | 10,672 B | 15,129 B | 13,904 B | 34,023 B |
| OfferingDeployer | 16,322 B | 16,350 B | 8,254 B | 32,802 B |
| MapaeFactory | 8,650 B | 41,169 B | 15,926 B | 7,983 B |

### 미결

- `script/verify-children.js` 는 `platformTokenBps()` 를 호출하고 생성자 인코딩에 넣는다. JS 라 컴파일 영향이
  없어 이번엔 두었고, 배포 스크립트 v3 재작성 티켓에서 함께 고친다.

## T11 — 풀 총 스왑 요율 하드캡 (결정 28 + 결정 25 보강)

### 배경

풀 총 요율 = 라우터 몫(swapPlatformBps + swapLpBps, FeeRouter 에서 live) + 풀 몫(royaltyBps + burnBps, 풀 생성 시
immutable). FeeRouter 합계 밴드는 라우터 구조체 4필드 합만 검사해 풀 몫에는 적용되지 않았다.
(예: L0 `setFees(500,80,0,0,20,0)` 통과 → 로열티 30 풀 130 bps, L1 로열티 80 + 소각 50 풀 190 bps.)
목표: owner 가 밴드 안에서 무엇을 설정하든 L0 풀 ≤ 100, L1/L2 풀 ≤ 150.

### 바꾼 상수 / 검사

| 위치 | 이전 | 이후 |
|---|---|---|
| `FeeRouter.L0_SWAP_PLATFORM_MAX` | 80 | **70** |
| `FeeRouter.L0_ROUTER_SHARE_MAX` (신규) | — | 70: L0 platform + lp > 70 → OutOfBand |
| `FeeRouter.PREMIUM_ROUTER_SHARE_MAX` (신규) | — | 60: L1/L2 platform + lp > 60 → OutOfBand |
| `MapaePool.MAX_POOL_SHARE_BPS_L0` (신규) | — | 30: L0 은 burn ≠ 0 또는 royalty > 30 → `PoolShareOutOfBand` |
| `MapaePool.MAX_POOL_SHARE_BPS_PREMIUM` (신규) | — | 90: L1/L2 royalty + burn > 90 → `PoolShareOutOfBand` |
| `Offering` per-pool 밴드 | royalty ≤ 80, burn ≤ 50 | + L1/L2 royalty + burn ≤ 90 (조기 `InvalidConfig`) |
| `Offering` capExempt | [creatorVesting, platform] | **[creatorVesting]** (결정 21) |

생성자 프리셋(L0 40+30, L1/L2 40+20)과 기존 합계 밴드(L0 80~100, premium 100~150)는 그대로. 집행 지점은 MapaePool
생성자(어떤 경로로 만든 풀이든 적용), Offering 은 조기 revert 용.

### 바꾼 기존 테스트

| 테스트 | 이전 | 이후 |
|---|---|---|
| `FeeRouterV2.t.sol` `test_Band_L0_Boundaries` | platform 상한 81 revert / 80 ok `(500,80,10,10,0,0)` | 71 revert `(500,71,10,9,0,0)` / 70 ok `(500,70,15,15,0,0)` |
| `FeeRouterV2.t.sol` `test_Band_Premium_Boundaries` | 합 150 경계 `(750,60,40,30,20,400)` ok | `(750,40,60,30,20,400)` ok (라우터 몫 60) |
| `FeeRouterV2.t.sol` `testFuzz_L0_SwapPlatformFloor` | inBand: platform ≤ 80 | inBand: platform ≤ 70 && platform + lp ≤ 70 |
| `InvariantsV2.t.sol` `test_R2_SwapRoyaltyBurnBands` | L1 80/50 edge ok | 80/50 revert(합 130), 80/10 ok(royalty 경계), 40/50 ok(burn 경계) |

로열티 + 소각 > 90 인 L1/L2 픽스처는 없었다(기본 60/30 = 90).

### 테스트

- 신규 `test/PoolFeeCap.t.sol` F1~F6 (6, F1·F2 fuzz). F7(커브 졸업 풀 totalFeeBps == 100)은 기존
  `CurveSale.t.sol` `test_C10_AfterGraduation`(호가 3종)이 단언. 합계 344 → **350 그린**.

### 사이즈

| 컨트랙트 | runtime | initcode | runtime 여유 | initcode 여유 |
|---|---|---|---|---|
| MapaePool | 9,684 B | 11,184 B | 14,892 B | 37,968 B |
| Offering | 10,672 B | 15,163 B | 13,904 B | 33,989 B |
| OfferingDeployer | 16,356 B | 16,384 B | 8,220 B | 32,768 B |
| FeeRouter | 3,732 B | 6,215 B | 20,844 B | 42,937 B |
| MapaeFactory | 8,650 B | 41,203 B | 15,926 B | 7,949 B |

## T12 — v3 배포 도구: DeployV3, verify-children, DemoCurve

이 세션은 GIWA Sepolia RPC 에 접근할 수 없다. 산출물은 오너가 Mac 에서 한 줄로 돌릴 수 있고 로컬
시뮬레이션 테스트로 검증된 스크립트다. 온체인 tx·broadcast 는 하지 않았다.

### src 변경

- `src/Constants.sol` `GiwaSepolia.WETH = 0x4200…0006` (온체인 확인값 symbol WETH, decimals 18). 그 외 src 무변경.

### script/DeployV3.s.sol (신규, v2 `Deploy.s.sol` 은 기록으로 보존)

- `deploy(deployer, treasury) returns (Deployed)` 로 로직 분리(테스트 호출용), `run()` 은 env `TREASURY_ADDRESS` 를 받아
  0 이거나 deployer 와 같으면 명확한 메시지로 revert. `.env` 파일은 읽지 않는다.
- 순서: MockKRW, MockDojang, PoolFactory, FeeRouter(owner = deployer, treasury = TREASURY), BuybackVault + BuybackExecutor
  (v2 배선), DojangEASAdapter, MapaeFactory ×2 (mock / EAS, `FeeRecipients.platform = treasury`, v2 Guide·MIN_RAISE),
  호가 등록(두 팩토리 모두 MockKRW `krwsVirtualQuote(decimals)` = 2,000,000e18, WETH `TESTNET_WETH_VIRTUAL_QUOTE` =
  0.002 ether, 결정 29), CurveFactory ×2 (짝 MapaeFactory + dojang, weth = GiwaSepolia.WETH, owner = deployer).
- **권한 배선:** CurveFactory/CurveSale 은 MapaeFactory 에 아무 권한도 필요 없다. 졸업 시 `PoolFactory.createPool` 은
  `msg.sender == token.offering()`(= CurveSale)만 요구하고, MapaeFactory 는 풀의 burner 레지스트리로 *조회*만 된다.
  CurveFactory 테스트 setUp 에도 `allowQuote` 외 배선은 없다.
- **라이브러리 주소 기록 방식:** `forge script` 가 MembershipTokenDeployer 를 broadcast 첫 tx 로 자동 배포·링크한다.
  스크립트는 `type(CurveSale).creationCode` 에서 PUSH20 대상 중 런타임이 `PUSH20 <자기 주소>`(solc 라이브러리 호출
  가드)로 시작하는 주소를 찾아(`linkedMembershipTokenDeployer()`) json 에 기록한다. 별도 사전 배포·`--libraries` 고정이
  필요 없고, 테스트(자동 링크)에서도 같은 함수로 확인된다.
- 산출물 `deployments/giwa-sepolia-v3.json`: chainId, deployBlock, deployer, treasury, 전 주소, weth,
  membershipTokenDeployer, krwsVirtualQuote, wethVirtualQuote. `giwa-sepolia.json` 은 건드리지 않는다.
- 시뮬레이션 가스: `deploy()` 단일 호출 기준 약 **30.1M** (실제 broadcast 는 tx 약 20건으로 나뉘며 건당 21k 기본 가스와
  라이브러리 배포가 더해진다).

### script/DemoCurve.s.sol (신규, mock 스택)

- 시나리오 A (KRWs): dev 가 dev 첫 매수와 함께 `createCurve` → 실명 지갑 12개가 나눠 매수해 졸업 → 졸업 풀에서
  `swapQuoteForToken`, `swapTokenForQuote` 각 1회 → `claimDevFees` → `sweepPlatformFees`.
- 시나리오 B (ETH): 지갑 하나가 `createCurveWithETH` 후 `buyWithETH` 로 셀프 졸업 (예산 ≈ 0.00606 ETH).
- `vm.warp` 없음. 지갑은 기존 DemoStage2a/2b 와 같은 공개 테스트 니모닉 상수 + `DEMO_MNEMONIC` env 오버라이드로
  파생(출력 없음), MockDojang `selfVerify`, MockKRW `faucet`. 인덱스는 `DEMO_CURVE_BASE_IDX`(기본 20) 부터
  (A dev = 20, A 매수자 21~32, B = 33). broadcast 송신자(deployer)가 가스(`DEMO_GAS_TOPUP`, 기본 0.0003 ETH)와 B 예산을 보낸다.
- 자가 검증(require): graduated, 풀 totalFeeBps == 100, 풀 가격 ≥ 커브 종가이고 차이 ≤ 0.2%, treasury 의 발행 토큰
  잔고 0, dev 수수료 수령 > 0, sweep > 0, A 는 verifiedBuyerCount == 12.
- 결과 `deployments/demo-curve-state.json` (커브·토큰·풀 주소, 졸업 블록). 시나리오 함수는 public 이라
  `test/DemoCurveSim.t.sol` 이 복사 없이 그대로 호출한다. 시뮬레이션 가스: 시나리오 A 약 8.7M.

### script/verify-children.js

- 생성자 시그니처를 `forge inspect <Contract> abi` 로 대조해 갱신: Offering 파라미터 25필드(platformTokenBps 제거,
  recipients 2-튜플), MembershipToken capExempt `[creatorVesting]`, MapaePool 끝에 dojang, CurveSale InitParams 9필드.
- `--libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:<addr>` 를 Offering, OfferingDeployer, CurveSale 에
  전달. 주소는 `--library` 또는 `deployments/giwa-sepolia-v3.json`.
- `--curve-factory <addr>`: CurveCreated 로 CurveSale 수집 → CurveSale, 토큰, 졸업한 경우 풀 verify.
- `--from-block` 필수(없으면 종료 코드 1). `--factory`/`--curve-factory` 중 하나 이상 필요. 요청한 경로의 이벤트가
  0건이면 hard-fail(기존 동작 유지). `node --check` 통과, 인코딩 4종 `cast abi-encode` 스모크 확인.

### 테스트

- 신규 `test/DeployV3.t.sol` (5: 배선·레지스트리·라이브러리 감지·잘못된 treasury·가스 측정),
  `test/DemoCurveSim.t.sol` (3: 시나리오 A, B, 연속). 합계 350 → **358 그린**.

### 범위 밖 발견

- `script/DemoOfferingC.s.sol` 은 L1 `swapRoyaltyBps = 100` 을 쓰는데 L1 상한은 80(T11 이후 합 90)이라 지금 실행하면 revert.
- `verify-children.js` 의 EAS 스택(`factoryDojang`/`curveFactoryDojang`)은 실제 개설 이력이 없으면 이벤트 0건으로 실패한다
  (의도된 hard-fail). EAS 스택은 개설 후에 돌린다.
- 기존 빌드 경고(컴파일러 2: `InvariantsV2.t.sol` shadowing, `DemoStage2aL0.s.sol` 미사용 변수 / lint 다수)는 T11·T12 신규 코드와 무관.

## T14 — v3.1 실명 우선 구간 (priority window), 풀 스왑 개방

오너 결정(2026-11-15): v3는 매수·매도·풀 스왑 모두 실명이라 사실상 한국 거주자만 거래할 수 있었다. v3.1에서 실명을
"개설 직후 일정 시간의 우선권"으로 바꾼다.

### 바뀐 규칙

| 경로 | v3 | v3.1 |
|---|---|---|
| 커브 개설 (`createCurve`, `createCurveWithETH`) | 실명 | 실명 (변경 없음, 7일 3개 제한 유지) |
| 커브 매수 (`buy`, `buyFor`, `buyWithETH`) | 실명 | 개설 후 `priorityWindow`(기본 600초) 동안만 실명, 그 뒤 누구나 |
| 커브 매도 (`sell`) | 실명 | 보유자 누구나 |
| 졸업 풀 / L1 풀 스왑 | 실명(호출자, 수령자) | 누구나 |
| L1 정가 공모 응모 (`Offering`) | 실명 | 실명 (변경 없음) |
| `verifiedBuyerCount` | 지갑의 첫 매수 | 지갑이 실명 상태로 한 첫 매수 (구간 뒤에도 실명 매수만) |

- 기준은 시간이다(판매 물량이 아니다). 경계 `block.timestamp == priorityUntil`은 열린 구간이다.
- `CurveFactory.priorityWindow`(uint32, 기본 600, 밴드 60~3600, owner 전용 `setPriorityWindow`)는 개설 시점 값이
  `CurveSale.priorityUntil`(immutable)로 고정된다. 바꿔도 이미 열린 커브는 그대로다.
- Dev 첫 매수(ERC-20, ETH 경로)는 Dev가 실명이고 구간 안이라 그대로 동작한다. Dev는 집계하지 않는다.
- 비실명으로 먼저 산 지갑이 나중에 실명이 되어 다시 사면 그때 한 번 센다. `hasBought`는 의미가 바뀌어
  `countedVerifiedBuyer`로 이름을 바꿨다.
- 커브 수식, 수수료, 졸업 로직, 수수료 청구·스윕, 졸업 전 토큰 전송 잠금, 풀 요율 하드캡, 소각 경로 권한, LP 영구
  락업은 바꾸지 않았다.

### 실명 조회 실패 처리

- 구간 안: fail-closed. `dojang.isVerified`가 revert하면 매수도 revert한다(try/catch 없음). 구간 안에서는 실명이 매수
  조건이라, 조회할 수 없으면 거래를 막는 쪽이 규칙과 맞다.
- 구간 뒤: `try dojang.isVerified`로 조회하고 revert하면 비실명으로 본다. 이때 실명 여부는 집계와 `Buy.verified`
  표시에만 쓰이므로, Dojang 장애가 누구나 가능한 매수를 막으면 안 된다. 장애 중 매수는 집계되지 않는 쪽으로만 틀린다.
- 한계: `try`는 호출 자체의 revert만 잡는다. Dojang 주소에 코드가 없거나 반환값을 디코드할 수 없으면 여전히 revert한다
  (dojang은 생성자에서 0 주소가 아님을 검사한다).

### ABI 변경 (웹, 인덱서가 맞출 것)

- 이벤트 `CurveSale.Buy(address indexed trader, bool isDev, bool verified, uint256 quoteSpent, uint256 tokensOut,
  uint256 platformFee, uint256 devFee, uint256 lpSeedFee, uint256 r, uint256 s)`: `verified` 추가로 topic0가 바뀐다.
- 이벤트 `CurveFactory.CurveCreated(..., string name, string symbol, uint64 priorityUntil)`: 끝에 추가, topic0 변경.
- 이벤트 `CurveFactory.PriorityWindowSet(uint32 oldWindow, uint32 newWindow)` 신규.
- `Sell`, `Graduated`, `Swapped` 이벤트는 그대로다.
- 함수: `CurveSale.priorityUntil()`, `CurveSale.inPriorityWindow()`, `CurveSale.countedVerifiedBuyer(address)` 추가,
  `CurveSale.hasBought(address)` 삭제. `CurveFactory.priorityWindow()`, `setPriorityWindow(uint32)`,
  `MIN_PRIORITY_WINDOW()`, `MAX_PRIORITY_WINDOW()` 추가.
- 에러: `CurveFactory.PriorityWindowOutOfBand(uint32)` 추가. `MapaePool.NotVerified`, `PoolFactory.ZeroDojang` 삭제.
  `CurveSale.NotVerified`는 구간 안 매수에서만 나온다(매도에서는 더 이상 나오지 않는다).
- 생성자: `CurveSale.InitParams` 끝에 `uint32 priorityWindow`. `MapaePool` 생성자와 `PoolFactory.createPool`에서
  마지막 `IDojang dojang` 인자 삭제, `MapaePool.dojang()` 삭제.

### 재배포 대상

- 재사용: MockKRW, MockDojang (`REUSE_MOCK_KRW`, `REUSE_MOCK_DOJANG`). 잔고와 실명 등록이 그대로 이어진다.
- 반드시 새로: PoolFactory(MapaePool 바이트코드 변경), MapaeFactory 2개(PoolFactory를 immutable로 참조하고, 내장한
  OfferingDeployer의 Offering 코드가 `createPool` 호출 변경으로 바뀜), CurveFactory 2개(CurveSale 코드 변경, PoolFactory와
  MapaeFactory를 immutable로 참조).
- 코드가 바뀌지 않아 기술적으로는 재사용할 수 있지만 새로 배포하는 것: FeeRouter, BuybackVault, BuybackExecutor,
  DojangEASAdapter, MembershipTokenDeployer(라이브러리, forge가 broadcast 중 배포). v3.1 스택을 v3와 설정(요율, owner
  배선)까지 분리해 두려는 것이다.
- 기존 `deployments/giwa-sepolia-v3.json`은 그대로 두고 v3.1은 `deployments/giwa-sepolia-v3_1.json`에 쓴다.
  `script/verify-children.js`는 `--deployment`(기본: v3_1 json이 있으면 그것)로 라이브러리 주소를 읽고, 새 생성자
  시그니처(MapaePool 8인자, CurveSale InitParams 10필드, priorityWindow = priorityUntil - 생성 블록 시각)를 쓴다.
- 배포 절차: `docs/DEPLOY_V3_1.md`.

### 테스트

- 신규 `test/CurvePriority.t.sol` (14, 이름에 priority): 구간 안 실명/비실명, 경계(`priorityUntil - 1` revert,
  `priorityUntil` 성공), 구간 안 Dojang revert 시 매수 revert, 구간 뒤 Dojang revert에도 매수 성공(verified false, 집계 불변),
  구간 뒤 실명만 집계, 늦은 실명 1회 집계, 매도 개방(비실명 보유자, 실명 취소 지갑), Dev 첫 매수(ERC-20, ETH),
  ETH 매수의 구간 적용, `setPriorityWindow` 권한·밴드·이벤트, 열린 커브 불변, `CurveCreated.priorityUntil`, 구간 안 졸업 후
  풀 개방, 퍼즈 "매수 성공 <=> 구간 뒤 또는 실명".
- `test/PoolDojangGate.t.sol` → `test/PoolOpenSwap.t.sol` (4): 누구나 양방향 스왑(퍼즈), 다른 수신자, 소각 경로 권한 유지,
  minOut 유지.
- `test/DeployV3.t.sol` (+3): v3.1 기본 구간 600, mock 재사용 배선, 코드 없는 재사용 주소 거부.
- 기존 테스트를 새 규칙에 맞춤(C1을 구간 테스트로, Buy 시그니처, `countedVerifiedBuyer`, createPool 인자).
- 합계 358 → **373 그린**. `forge fmt --check` 통과, BytecodeSize 통과.
- RPC 리허설(`forge script ... --rpc-url https://sepolia-rpc.giwa.io`)은 작업 세션의 네트워크 정책으로 GIWA RPC에 연결할
  수 없어 실행하지 못했다. 같은 `deploy()` 경로를 `DeployV3.t.sol`이 로컬에서 검증한다. 리허설은 `docs/DEPLOY_V3_1.md`
  1단계에서 오너가 한다.

## v3.2 (C-T1, 2026-11-16): 공식 도장 인식, 둘 다 인정, Dev 첫 매수 5% 상한

근거: STATUS 결정 46(공식 도장과 목 둘 다 인정, 테스트넷), 결정 49(발행 tx 안의 Dev 첫 매수는 총공급의 5%).

### 어댑터 버그와 수정

- 배포된 `DojangEASAdapter`(v3.1, 0x8Cad…b640)는 `DojangScroll.getVerifiedAddressAttestationUid(account, schemaUid)`를
  불렀다. 실제 두 번째 인자는 발행자 ID(attester ID)라서 스키마 UID를 넘기면 0x6e7910da로 revert하고, 어댑터는 catch에서
  false를 돌려줬다. 공식 도장 지갑도 실명이 아닌 것으로 판정됐다. 목 스크롤이 스키마로 키를 잡고 있어서 테스트는 통과했다.
- 생성자를 `(eas, scroll, attesterId, schemaUid)`로 바꿨다. 조회는 `attesterId`, 본문 검증(스키마, 수령인, 미취소, 미만료,
  data == 1)은 `schemaUid`. try/catch와 "실패하면 false"는 그대로.
- `Constants.sol`에 발행자 ID 두 개(UPBIT_KOREA, TESTNET_FAUCET)를 추가했다. `IDojangScroll`의 매개변수 이름을
  `attesterId`로 고쳤다. `MockDojangScroll`은 발행자 ID로 키를 잡는다.
- `Deploy.s.sol`(v2)과 `DeployV3.s.sol`(v3.1)의 어댑터 생성도 새 생성자로 맞췄다(TESTNET_FAUCET). 이미 배포된 것과는
  무관하다.

### DojangAnyOf (테스트넷 전용)

- `isVerified = a || b`. 각 호출은 try/catch, 실패는 false(한쪽이 죽어도 다른 쪽으로 판정). 0 주소 생성은 revert.
- 테스트넷 구성: a = 어댑터(TESTNET_FAUCET), b = MockDojang. 메인넷은 합성기 없이 어댑터(UPBIT_KOREA) 단독.

### Dev 첫 매수 상한

- `CurvePresets.DEV_FIRST_BUY_MAX_TOKENS = TOTAL_SUPPLY * 500 / 10_000` (5,000만 개).
- `createCurve`의 `_devFirstBuy`와 `createCurveWithETH`에서 Dev가 받은 토큰(tokensOut)이 상한을 넘으면
  `DevFirstBuyTooLarge(tokensOut, maxTokens)`로 발행 전체가 revert한다. 잘라서 사 주지 않는다. 상한과 정확히 같은 수량은
  허용. 발행 뒤의 buy, buyFor, buyWithETH는 그대로(결정 19).
- 5%를 사는 데 드는 금액(테스트에서 이분 탐색으로 계산, 상한 이하가 나오는 최대 금액):

  | 프리셋 | 매수 금액(수수료 포함) | 커브에 들어가는 순금액 |
  |---|---|---|
  | KRWs (Vq 200만) | 99,354.197714853 KRWs | 98,360.655737704 KRWs |
  | 메인넷 ETH (Vq 0.6) | 0.029806259314456035 ETH | 0.029508196721311475 ETH |
  | 테스트넷 ETH (Vq 0.002) | 0.000099354197714852 ETH | 0.000098360655737704 ETH |

  수수료는 매수 금액에서 뗀다(`net = quoteIn - quoteIn × 1.00%`). 웹의 기존 첫 매수 기본값 0.00005 ETH는 통과하고
  0.001 ETH는 막힌다(테스트넷).

### 배포 준비

- `script/DeployV3_2.s.sol`: v3.1 json에서 MockKRW, MockDojang, PoolFactory, FeeRouter, MapaeFactory(mock),
  MembershipTokenDeployer를 읽어 재사용하고, 어댑터, DojangAnyOf, CurveFactory를 새로 배포한다. 재사용 MapaeFactory의
  등록값(MockKRW, WETH 0.002 ETH)과 링크된 라이브러리 주소를 확인하고 다르면 멈춘다. 결과는
  `deployments/giwa-sepolia-v3_2.json`.
- 재사용 6개의 런타임 바이트코드는 main(v3.1)과 메타데이터까지 같다(`forge inspect ... deployedBytecode` 비교).
- `script/verify-children.js`: 이벤트를 9,000블록 단위로 나눠 읽는다(RPC 한도 10,000블록). 기본 json은 v3_2가 있으면 그것.
- 절차: `docs/DEPLOY_V3_2.md`.

### 테스트

- `DojangEASAdapter.t.sol` (+3): 스키마 UID를 발행자 ID 자리에 넣으면 false, 다른 발행자 false, 생성자 값 보관.
- 신규 `DojangAnyOf.t.sol` (7), `DojangFork.t.sol` (3, `GIWA_SEPOLIA_RPC_URL`이 없으면 건너뜀), `DeployV3_2.t.sol` (4).
- `CurveFactory.t.sol`: 상한 경계(3개 프리셋 각각), 발행 tx 안 졸업 불가, 발행 뒤 상한 넘는 매수 가능, 상한과 같은 수량
  허용(하네스).
- `CurveFactoryETH.t.sol`: 메인넷/테스트넷 프리셋 경계(ETH 전액 반환, 커브 미등록), 발행 뒤 상한 넘는 매수.
- 바꾼 기존 테스트: `test_K5_DevFirstBuy`(금액 1000 단위 → Vq/100), `test_K5_DevFirstBuyGraduatesInCreateTx`
  → `test_K5_DevFirstBuyCannotGraduateInCreateTx`(revert 확인으로 교체), `test_W8_CreateWithETH`(0.2 → 0.01 ETH, 졸업 부분은
  revert 확인으로), `CurvePriority.test_priority_DevFirstBuyErc20AndEth`(0.1 → 0.01 ETH), `DemoCurve.s.sol`의 시나리오 A
  (Dev 첫 매수 1/13 → 1/200로 발행하고 나머지는 발행 뒤 별도 buy).
- 합계 373 → **397 그린 + 포크 스위트 건너뜀(RPC 없음, setUp에서 skip되어 1건으로 집계)**. BytecodeSize 통과, CurveFactory 런타임 19,131 바이트(여유 5,445).
- 포크 테스트와 `cast call`은 작업 세션에서 GIWA RPC에 연결할 수 없어 실행하지 못했다. 오너가 `docs/DEPLOY_V3_2.md` 6단계에서
  확인한다.

## v3.5 (C-T5, 2026-11-18): 우선 구간 지갑당 보유 한도 2%

오너 결정(11-18): 우선 구간(개설 후 10분) 동안 발행자를 포함해 어떤 지갑도 총공급의 2%를 넘게 보유할 수 없다.
Dev 첫 매수 상한도 5%에서 2%로 맞춘다. 우선 구간이 끝나면 한도는 없다(결정 19 유지). 졸업 조건, 수수료, 커브 기하는 그대로.

### 바뀐 규칙

- `CurveFactory.priorityMaxHoldingBps`: 50~500(0.5%~5%), 기본 200. 생성자 인자(마지막)이고 범위 밖이면
  `PriorityMaxHoldingOutOfBand`. 우선 구간 길이와 같은 방식으로 owner 전용 setter(`setPriorityMaxHoldingBps`, 같은 범위)가 있고,
  바꾸면 그 뒤에 열리는 커브에만 적용된다(`PriorityMaxHoldingBpsSet`).
- 커브가 열릴 때 `TOTAL_SUPPLY × bps / 10000`을 `CurveSale.InitParams.priorityMaxHolding`으로 넘기고, 커브는 immutable
  `priorityMaxHolding()`(토큰 수량)으로 고정한다.
- 검사 위치: `CurveSale._buy`. 우선 구간 판정은 실명 게이트와 같은 `_inPriority()`(block.timestamp < priorityUntil) 하나를 쓴다.
  토큰을 보낸 뒤 받는 주소의 잔액이 한도를 넘으면 `PriorityHoldingExceeded(balanceAfter, maxHolding)`로 매수 전체를 되돌린다.
  `buy`, `buyFor`(받는 주소 기준), `buyWithETH`(팩토리의 buyFor 경유), 발행 tx 안의 Dev 첫 매수가 모두 이 경로다. 매도에는 검사가 없다.
- Dev 첫 매수: `CurvePresets.DEV_FIRST_BUY_MAX_TOKENS`를 없앴다. 팩토리가 매수 전에 견적(`quoteBuy`)으로
  `tokensOut > priorityMaxHolding`이면 `DevFirstBuyTooLarge(tokensOut, maxTokens)`로 발행 전체를 되돌린다(웹이 이 오류 이름에
  문구를 매핑하고 있어 이름 유지). 발행 직후 Dev의 추가 매수는 합산 보유량으로 `PriorityHoldingExceeded`.
- 2%를 사는 데 드는 금액(이분 탐색, 한도 이하가 나오는 최대 금액):

  | 프리셋 | 매수 금액(수수료 포함) | 커브에 들어가는 순금액 |
  |---|---|---|
  | KRWs (Vq 200만) | 38,602.586373287 KRWs | 38,216.560509554 KRWs |
  | 메인넷 ETH (Vq 0.6) | 0.011580775911986103 ETH | 0.011464968152866242 ETH |
  | 테스트넷 ETH (Vq 0.002) | 0.000038602586373286 ETH | 0.000038216560509554 ETH |

  웹의 현재 Dev 첫 매수 기본값 0.00005 ETH(테스트넷)는 약 2.58%라 이제 막힌다(W-T54에서 바꾼다).
- 반올림: 매수는 견적 금액 기준이고 토큰은 내림이라, 한 지갑이 한도 이하로 살 수 있는 최대치는 2천만 개보다 수백 wei 적다.
  그래서 지갑 40개가 각자 최대로 사면 곡선 물량 8억 개에서 약 4,300 wei가 남고, 41번째 지갑의 먼지 매수가 우선 구간 안에서
  졸업시킨다. 39개로는 2천만 개 넘게 남아 우선 구간 안에 졸업할 수 없다(PM 확인 11-18).

### 배포 준비

- `script/DeployV3_5.s.sol`: v3.2 json에서 DojangAnyOf, FeeRouter, PoolFactory, MapaeFactory(mock), MockKRW,
  MembershipTokenDeployer를 읽어 재사용하고 CurveFactory 하나만 새로 배포한다(priorityWindow 600, bps 200, owner = 배포자).
  결과는 `deployments/giwa-sepolia-v3_5.json`. 절차: `docs/DEPLOY_V3_5.md`.
- 재사용 컨트랙트(MockKRW, DojangAnyOf, PoolFactory, FeeRouter, MapaeFactory, MembershipTokenDeployer, DojangEASAdapter,
  MockDojang)의 런타임 바이트코드는 이번 변경 전후가 같다(빌드 산출물 해시 비교).
- `script/DemoCurve.s.sol`: 두 시나리오를 개설 단계(`scenarioAOpen`, `scenarioBOpen`)와 거래 단계(`scenarioATrade`,
  `scenarioBTrade`)로 나눴다. 규모와 금액은 그대로다. v3.5 팩토리에서는 거래 단계를 우선 구간 뒤에 실행해야 한다.

### 테스트

- 신규 `CurveHoldingCap.t.sol` (13): 기본값 2%, 팩토리 범위(49·501 revert, 50·500 통과), setter 권한·범위·기존 커브 불변,
  한도 바로 아래 성공·한 단계 위 revert, 두 번에 나눠 합이 넘으면 두 번째 revert, 사고 팔고 다시 사기(보유량 기준), buyFor는
  받는 주소 기준, buyWithETH revert 시 ETH 전액 반환, 우선 구간 마지막 초 revert·다음 초 통과, Dev 첫 매수 경계와 미등록,
  Dev 추가 매수 합산, 오류 인자가 커브 한도, 40개 지갑 + 먼지 매수 졸업, 39개 미졸업.
- 신규 `DeployV3_5.t.sol` (2): 로컬 v3.1 + v3.2 스택 위 배포, 새 팩토리 bps 200, 새 커브 한도 2천만 개, 라이브러리 확인.
- 바꾼 기존 테스트(한 지갑이 우선 구간 안에 2% 넘게 사던 것):
  - 우선 구간 뒤로 옮김: `CurveSale.t.sol` setUp(커브 메커니즘 테스트 전체, 우선 구간 안이어야 하는
    `testFuzz_C1_priority_UnverifiedCannotBuyInWindow`만 구간 안으로 되돌림), `test_C8_ZeroLpSeedPriceContinuity`,
    `CurveFactory.t.sol`의 `test_K2_QuoteWhitelist`, `test_K3_CurveEnabled`, `test_K5_DevBuysPastCapAfterCreation`,
    `test_K9_FullLifecycle`, `CurveFactoryETH.t.sol`의 `test_W1_BuyWithETH`, `test_W2_ClosingBuyRefundsAndGraduates`,
    `test_W6_ReentrancyOnRefundReverts`, `test_W7_RefundRejectedReverts`, `test_W_DevBuysPastCapAfterCreation`,
    `DemoCurveSim.t.sol`의 세 시나리오(개설과 거래 사이).
  - 금액을 줄임: `CurvePriority.testFuzz_priority_BuyIffOpenOrVerified`(상한 100,000 → 30,000 KRWs),
    `DeployV3_2.t.sol`의 `test_MockVerifiedWalletOpensAndFirstBuyIsCapped`(0.00005 → 0.00003 ETH),
    `CurveFactoryETH.test_W_DevFirstBuyCap_TestnetPreset`(통과 금액을 2% 최대치로, 0.00005 ETH는 이제 revert 확인).
  - 5% → 2%: `test_K5_DevFirstBuyCapBoundary`, `test_K5_DevFirstBuyCannotGraduateInCreateTx`, `DevFirstBuyCapExactTest`,
    `test_W_DevFirstBuyCap_MainnetPreset`.
  - 다시 씀: `CurvePriority.test_priority_GraduateInWindowPoolOpenToAnyone`(한 지갑 졸업 → 40개 지갑 + 먼지 매수 졸업).
- 합계 461 → **476 그린 + 포크 스위트 1건 건너뜀**. CurveFactory 런타임 20,327 바이트(여유 4,249), CurveSale 8,980 바이트(여유 15,596).

## v3.6 (C-T6, 2026-11-19): 예고 발행(startTime)과 실명 전용 토큰(verifiedOnly)

배경: v3.5는 커브가 열리는 순간 거래가 시작돼 10분 우선 구간을 발행자 주변만 알 수 있었고, 구간 뒤에도 실명 보유자로만 시작하고 싶은
발행자에게 선택지가 없었다. 발행자가 고르는 옵션 두 개를 넣었다. 둘 다 꺼짐이 기본이고, 끄면 v3.5와 같다.

### 바뀐 규칙

- `CurveFactory.LaunchOptions { uint64 startTime; bool verifiedOnly; }`(팩토리 안 구조체, ABI에서 튜플 한 인자)를 `createCurve`,
  `createCurveWithETH`의 마지막 인자로 받는다.
- 예고 범위 `MIN_START_DELAY = 10 minutes`, `MAX_START_DELAY = 7 days`(양끝 포함), 밖이면 `StartTimeOutOfBand`. 검사는 실명·호가 검사 뒤,
  발행 빈도 소모 전에 한다(범위 밖이면 빈도를 쓰지 않는다). 예고 + Dev 첫 매수는 `DevBuyNotAllowedWhenScheduled`(팩토리 첫 줄에서 검사).
- CurveSale: `startTime`, `verifiedOnly` immutable, `started()`. `_requireStarted()`를 `_buy`와 `sell`의 졸업 검사 바로 뒤에 둔다.
  `priorityUntil = startTime + priorityWindow`. 매수 실명 판정은 `_buyerVerified(trader, priority || verifiedOnly)`.
- `CurveCreated` 끝에 `startTime`, `verifiedOnly`. 이벤트 필드가 10개라 스택 깊이를 넘어서, 발행 이벤트를 별도 함수
  (`_emitCreated`)에서 내고 이름과 심볼은 토큰에서 다시 읽는다(같은 값).
- 전제 확인: `MembershipToken._update`는 전송 잠금 중 `from != offering && from != pool && to != offering`인 전송을 막는다. 커브 토큰은
  100년 잠금이고 졸업 때 `endTransferLock`으로 풀리므로, 졸업 전 보유자 간 전송은 불가하다. 실명 전용은 매수만 막으면 된다.

### 크기 (runtime / initcode, 바이트)

| 컨트랙트 | 변경 전 | 변경 뒤 | EIP-170 여유 |
|---|---|---|---|
| CurveFactory | 20,327 / 21,215 | 21,858 / 22,746 | 2,718 |
| CurveSale | 8,980 / 11,576 | 9,315 / 12,135 | 15,261 |

### 배포 준비

- `script/DeployV3_6.s.sol`: v3.5 json에서 재사용 주소를 읽어 기대 주소와 비교하고 CurveFactory 하나만 새로 배포한다(600초, 200 bps).
  v3.5 스크립트와 달리 broadcast(또는 resume)일 때만 `deployments/giwa-sepolia-v3_6.json`을 쓴다. 리허설이 시뮬레이션 주소로 기록을
  덮어쓰지 않게 하려는 것이다. 절차: `docs/DEPLOY_V3_6.md`.
- 작업 세션에서 GIWA RPC에 연결할 수 없어 RPC 리허설은 실행하지 못했다. 로컬 스택 리허설(`DeployV3_6.t.sol`)만 통과.
- 배포(11-19): CurveFactory `0xC872B81fBFE7853531970F1aFBC1ab6b47078Cc5`, 블록 41712578, tx `0x59bb79222d19c40b88e99b2e660ff15bb9b36ea146525cc3c5f36d59ee20f1ec`. 배포자는 테스트 지갑 0xE4D0…98C4, owner는 생성자 인자로 0x67a2…D00C.
  스크립트가 아니라 같은 빌드 산출물을 직접 배포했고 Blockscout 검증까지 끝났다. 기록은 `deployments/giwa-sepolia-v3_6.json`.

### 테스트

- 신규 `CurveScheduled.t.sol` (10): S1 즉시 발행, S2 범위(경계 포함), S3 시작 전 buy·buyFor·sell·buyWithETH revert와 view 동작,
  S4 시작 정각, S5 우선 구간이 시작부터, S6 예고 + Dev 첫 매수 revert(KRWs, ETH 반환), S7 시작 뒤 Dev 2% 한도, S8 발행 빈도 소모,
  S9 이벤트 값, S16 퍼즈(시작 전 어떤 매수도 실패, KRWs·ETH).
- 신규 `CurveVerifiedOnly.t.sol` (6): V10 구간 뒤 실명만(buyWithETH 포함), V11 구간 뒤 한도 없음, V12 fail-closed(실명 전용만),
  V13 인증 풀린 보유자 매도, V14 졸업 뒤 풀 개방, V15 두 옵션 함께.
- 신규 `DeployV3_6.t.sol` (2).
- 기존 테스트: 호출부에 `CurveFactory.LaunchOptions(0, false)` 인자 추가, `CurveSale.t.sol`의 `InitParams`에 `startTime: 0, verifiedOnly: false`
  추가. 기대값 변경은 `CurvePriority.t.sol`의 `CREATED_SIG`(이벤트 시그니처에 두 필드 추가) 하나다.

