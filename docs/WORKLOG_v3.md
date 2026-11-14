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
