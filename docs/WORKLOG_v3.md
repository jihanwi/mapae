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
