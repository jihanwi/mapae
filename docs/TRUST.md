# 신뢰 모델 (v3, GIWA Sepolia 테스트넷)

v3(실명 본딩커브 레일 + 정가 공모)의 신뢰 구조와 한계를 적는다. 아래 "정가 공모 정산" 절은 v2부터
바뀌지 않은 내용이고, "v2 기록" 절의 수치는 v2 배포 기준이다. 상충하면 이 v3 절이 우선한다.

## v3 핵심 보장

### 플랫폼은 발행 토큰을 받지 않는다 (결정 21)

- 정가 공모: 플랫폼 토큰 배분이 없다. 정산 tx에서 잔여 물량(공급 − 판매분 − 크리에이터 몫 − LP 몫)과
  LP 시딩 잉여를 소각한다(`RemainderBurned`). 리저브 수령처도 없다.
- `recipients.platform`은 공모 대금의 플랫폼 몫(호가 자산)만 받고, 토큰 보유 상한 면제 목록에서도 빠졌다(T11).
- 커브: 수수료는 전부 호가 자산(KRWs 또는 WETH)으로만 쌓이고 `sweepPlatformFees()`가 treasury로 보낸다.
  발행 토큰이 수수료로 나가는 경로가 없다.
- 확인: `test/NoPlatformTokens.t.sol`(정가 공모 3등급), `test/CurveSale.t.sol` C5(커브), v3 데모의 두 졸업 풀에서
  treasury의 발행 토큰 잔고 0.

### 졸업 전 전송은 커브와의 왕복만

- CurveSale이 만드는 토큰은 전송 잠금 100년(`CURVE_LOCK_DURATION = 100 * 365 days`)으로 시작한다.
- 잠금 중에는 커브에서 받는 전송(`from == offering`)과 커브로 되파는 전송(`to == offering`)만 통과하고,
  보유자 간 전송은 revert한다.
- 졸업 tx에서 커브가 `endTransferLock()`을 호출해 잠금을 즉시 끝낸다.
- 졸업 전에는 제3자가 풀을 만들 수 없다: `PoolFactory.createPool`은 토큰의 offering(= CurveSale)만 호출할 수 있다.

### 커브 LP는 졸업 시 0xdEaD로 간다

- 커브 판매 물량 `CURVE_SUPPLY` 800,000,000개가 다 팔리는 매수와 같은 tx에서 졸업한다.
- 졸업 시 풀에 `DEX_SUPPLY` 200,000,000개와 호가 자산(졸업 준비금 r + 적립된 LP 시드 수수료)을 넣고,
  LP 지분은 전량 `0x000000000000000000000000000000000000dEaD`로 민트한다.
- 풀 시딩가는 준비금 기준 커브 종가와 같고, LP 시드 수수료가 합류한 만큼만 위로 간다(불변식 23).

### 실명(Dojang) 게이트

| 경로 | 게이트 |
|---|---|
| `CurveFactory.createCurve` / `createCurveWithETH` | 개설자 `isVerified` |
| `CurveSale.buy` / `buyFor` (v3.1) | 실명 우선 구간(`block.timestamp < priorityUntil`, 기본 10분) 안에서만 매수자 `isVerified`. 구간 뒤에는 누구나 |
| `CurveSale.sell` (v3.1) | 게이트 없음. 보유자 누구나 |
| `MapaePool.swapQuoteForToken` / `swapTokenForQuote` (v3.1, 전 등급) | 게이트 없음. 누구나 |
| `Offering` 응모 (L1 정가 공모) | 응모자 `isVerified` (변경 없음) |
| `MapaePool.swapForBurn` | 게이트 없음. MapaeFactory 등록 burner(Sponsorship, BuybackVault)만 호출 가능 |
| `MapaePool.convertAndBurn` | 게이트 없음. 출력 전량 소각 |

Dojang 조회가 revert하면 해당 호출도 revert한다(fail-closed, try/catch 없음). 예외는 실명 우선 구간이 끝난 뒤의 커브
매수다(v3.1): 이때 실명 여부는 집계(`verifiedBuyerCount`)와 `Buy.verified` 표시에만 쓰이므로, 조회가 revert해도 매수는
진행하고 비실명으로 기록한다. 구간 안에서는 실명이 매수 조건이라 fail-closed를 유지한다.

### 풀 총 스왑 요율 하드캡 (결정 28)

풀 총 요율 = 라우터 몫(FeeRouter `swapPlatformBps + swapLpBps`, 실시간 조회) + 풀 몫(`royaltyBps + burnBps`, 풀 생성 시 고정).

| 등급 | 라우터 몫 상한 | 풀 몫 상한 | 풀 총 요율 상한 |
|---|---|---|---|
| L0 | 70 bps (`L0_ROUTER_SHARE_MAX`) | royalty 30, burn 0 (`MAX_POOL_SHARE_BPS_L0`) | 100 bps (1.00%) |
| L1 / L2 | 60 bps (`PREMIUM_ROUTER_SHARE_MAX`) | royalty + burn 90 (`MAX_POOL_SHARE_BPS_PREMIUM`) | 150 bps (1.50%) |

집행 지점:

- `FeeRouter._validate`: 라우터 몫이 상한을 넘는 `setFees`는 revert.
- `MapaePool` 생성자: 풀 몫이 상한을 넘으면 `PoolShareOutOfBand`로 revert. 어떤 경로로 만든 풀이든 적용된다.
- `Offering` 생성자: 같은 조건을 미리 검사해 `InvalidConfig`로 revert(조기 차단용).
- 커브 졸업 풀은 royalty 30(`SWAP_FEE_DEV_BPS`), burn 0으로 만들어지고, 프리셋에서 총 100 bps다.

## 주소와 권한 (v3 배포)

- owner(모든 Ownable 컨트랙트, 정가 공모 settle 권한): 배포자 `0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C`
- treasury(`FeeRouter.platformTreasury`, `MapaeFactory.feeRecipients.platform`): `0x3ada0Cb1fbb700AC4B41f5D7A9dbE2BC47b9FAaa`

### owner가 할 수 있는 것

| 컨트랙트 | 함수 | 범위 |
|---|---|---|
| FeeRouter | `setFees` | 등급별 하드 밴드와 라우터 몫 상한 안에서만 |
| FeeRouter | `setCurveFees` | platform 40~60, dev 20~40, lpSeed 0~20, 합 80~100. 새로 여는 커브에만 적용 |
| FeeRouter | `setPlatformTreasury` | treasury 주소 교체 |
| MapaeFactory | `allowQuote` | 호가 자산을 한 번만 등록. 등록한 가상 준비금과 decimals는 이후 바꿀 수 없다 |
| MapaeFactory | `setQuoteEnabled` | 새 커브 개설 허용 여부만. 이미 열린 커브와 풀은 영향 없음 |
| MapaeFactory | `setGuide` | L1/L2 정가 공모 가이드 밴드 |
| CurveFactory | `setCurveEnabled` | 새 커브 개설만 막는다. 기존 커브의 거래와 졸업은 영향 없음 |
| BuybackVault / BuybackExecutor | `setExecutor`, `setParams`, `run` | 바이백 실행. 볼트 자금은 소각 매수 외 경로로 나갈 수 없다 |
| Offering | `settle` | 정가 공모 정산(아래 "정가 공모 정산" 절의 온체인 방어선 적용) |
| MockDojang (테스트넷) | `setVerified`, `setVerifiedBatch` | mock 스택의 실명 상태 |

### owner가 할 수 없는 것

- 밴드와 하드캡 밖의 요율 설정.
- 이미 열린 커브의 수수료 변경: CurveSale은 생성 시 FeeRouter 커브 요율을 immutable로 스냅샷한다.
- 커브 가격 경로 변경: 가상 준비금은 등록 시 한 번 정해지고, 커브 기하는 `CurvePresets` 상수다.
- 풀의 royalty·burn 몫 변경(풀 생성 시 immutable). 기존 풀의 platform·lp 몫은 실시간 조회라 밴드와 하드캡 안에서만 바뀐다.
- 토큰 추가 발행: 민트는 1회뿐이고 그 뒤 민트 권한은 영구히 없어진다.
- 커브 준비금 r 인출, 커브 거래 중단: CurveSale에는 owner가 없다.
- LP 회수: LP 지분은 0xdEaD에 있다.

## 테스트넷 한계

- owner는 단일 키 EOA(배포자)다. 멀티시그나 타임락이 없다.
- MockKRW는 누구나 faucet으로 받을 수 있다.
- mock 스택(MapaeFactory(mock), CurveFactory(mock))의 실명 게이트는 MockDojang이고, `selfVerify()`로 누구나 스스로
  등록할 수 있다. 실제 Dojang(EAS) 검증은 EAS 스택(DojangEASAdapter와 짝인 팩토리)에서만 적용된다.
- WETH 커브 가상 준비금은 테스트넷 값 0.002 ETH다(메인넷 프리셋 0.6 ETH).
- 외부 감사를 받지 않았다.
- 졸업 뒤에는 토큰 전송이 자유라서, 제3자가 외부 DEX에 풀을 만드는 것은 막지 않는다.
- 풀 주소는 PoolFactory nonce로 예측할 수 있어, 졸업 전 그 주소로 호가 자산을 보내면 졸업 시 시딩에 포함된다.
  가격이 위로만 움직이고 손실은 보낸 사람에게만 있어 대응하지 않는다.
- ETH 경로는 커브 매수와 개설뿐이다. 커브 매도 대금과 졸업 풀 스왑 출력은 WETH로 나온다.

## 정가 공모 정산 (v2부터 동일)

### 배정 계산과 검증

- 배정(균등 + 미충족 신청량 가중 추첨)은 **오프체인에서 결정론적으로 계산**된다
  (`script/allocation/` — 같은 커밋 스냅샷 + 같은 시드 → 항상 같은 결과).
- 온체인에는 배정 머클루트만 커밋된다. **시드는 `Settled` 이벤트에 공개**되므로,
  누구든 커밋 스냅샷(온체인 이벤트 리플레이)과 시드로 전체 배정을 재계산해
  루트 일치 여부를 검증할 수 있다. 절차: `script/allocation/README.md`.
- 랜덤니스: 테스트넷은 지연 블록해시. VRF 가용 시 교체 예정.

### 루트 커밋 권한과 온체인 방어선

- `settle()`은 플랫폼 오너 전용(`Ownable`)이다. **챌린지 기간은 M1 범위에서 제외**
  (로드맵 항목) — 즉 오너가 잘못된 루트를 커밋하는 것 자체는 온체인에서 막지 않는다.
- 대신 조작된 루트가 있어도 **초과 인출은 온체인에서 불가능**하다:
  - settle sanity check: `totalSold ≤ qSale`, `totalRaised ≤ totalCommitted`,
    `totalRaised ≤ totalSold × P`, deadline 이후 · 1회만, 모드 A는 목표 달성 시에만
  - claim 회계 상한: 누적 클레임 토큰 ≤ `totalSold`,
    누적 환불 ≤ `totalCommitted − totalRaised`
- 결론: 오너가 조작할 수 있는 최대치는 "배정을 다르게 나누는 것"이며, 그 사실은
  공개 재계산으로 즉시 탐지된다. 자금 총량을 부풀리거나 빼돌리는 것은 불가능하다.

### 자금 잠김 방지 (D3)

- 모드 A 목표 미달: deadline 이후 `totalCommitted < R`은 온체인에서 판정 가능한
  사실이므로 **누구나** `enableRefunds()` 호출 → 전원 `refund()`로 전액 회수.
- settle 지연: deadline + **7일**까지 정산이 없으면 **누구나** `emergencyRefund()`
  호출 → Refunding 전환. 오너가 사라져도 예치금은 잠기지 않는다.

### cancel 정책 (D5)

- commit은 deadline까지, cancel은 deadline − 2h까지만 허용된다 (프리즈는 cancel 전용).
- 배정은 프리즈 이후 확정되는 **마감 시점 최종 스냅샷**만 사용하므로, 취소·재응모를
  반복해도 배정 결과에 영향을 줄 수 없다 (막판 일괄취소 어뷰징 무의미).

### Dojang 검증

- commit 시점 스냅샷 (fail-closed). 이후 KYC 만료·철회는 기배정에 소급 적용하지 않는다.
- M1은 MockDojang, M3에서 EAS 어댑터로 교체 (`docs/DOJANG.md`).

### 알려진 한계 (M5 — 의도된 트레이드오프)

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

## v2 기록

아래 수치(요율, 밴드, 배분)는 v2 배포 기준이다. v3 값은 맨 위 v3 절을 따른다.

### v5.2 신뢰 모델 — 수수료·등급제·바이백

### 스왑 수수료 방향별 수취 (R1) — treasury·royalty는 KRWs만

L0에서는 플랫폼이 크리에이터 토큰을 보유하지 않는다(트레저리가 유저에게 되파는 이해충돌 차단).
L1은 v2 설계상 5%를 수취했다(MAPL1 12.5e18, settle tx
[`0x443a4b77…`](https://sepolia-explorer.giwa.io/tx/0x443a4b775b981713b51a452ce9b0fd08cb9f4d870380a0c5f1f4a4268f0c6519)).
v3에서 전 트랙 0으로 바뀌었다(결정 21, 위 v3 절).
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

### v2.0.1 데모 배포 — 이탈 기록 (2026-10-11)

1. **수령 주소 겸용** — v2.0.1 데모 배포는 `feeRecipients.platform` = `feeRecipients.reserve`
   = `FeeRouter.platformTreasury` = deployer(`Deploy.s.sol:62`). 그 결과 deployer(treasury)
   주소에 발행 토큰이 남아 있다: MAPL0 5.357e18(L0 reserve 7.5%), MAPL1 12.5e18(L1 platform
   토큰 배분 5%, `PREMIUM_PLATFORM_TOKEN_BPS`) + 2.5e18(L1 reserve 1%).
   - 불변식 17("treasury 토큰 잔고 0")은 **스왑·수수료 경로**에 대한 것이며 성립한다(스왑·
     드랍·바이백 tx에서 treasury는 KRWs만 수취). L0 플랫폼 토큰 배분 = 0 강제도 온체인에서
     작동했다(L0 settle의 platform 민트 = 0).
   - reserve는 커뮤니티 리저브(배분 잔여 흡수, 활동 증명 기반 에어드랍·이벤트·신규 팬
     온보딩 용도 — `docs/SPEC.md` 배분표·`product_spec.md` v5.2)로 별개 회계 항목이다.
   - **v3 배포에서 reserve 수령처는 없어졌고(잔여 소각), treasury는 배포자와 다른 주소로 분리됐다(위 v3 절).**
2. **고정 seed** — 8/30 L0 settle은 seed `0x50` 고정값을 썼다(단일 leaf, 배정 결과에
   영향 없음). 10/11 L1 settle은 원칙대로 지연 블록해시(블록 38350312)를 썼다.
3. **L1 settle 지연** — L1 데모 오퍼링은 deadline(2026-08-31) 후 41일 만에 settle됐다.
   그동안 `SETTLE_TIMEOUT`(7일) 경과로 누구나 `emergencyRefund()`를 호출할 수 있는
   상태였고, 호출이 없었으므로 정상 settle 경로로 마감했다.
4. **팩토리 자식 verify 누락** — 8/30 데모로 생성된 자식 컨트랙트 12개가 10/11까지
   Blockscout 미검증 상태였다. 10/11 `verify-children.js --from-block 34757177`로 전량
   verified. 이후 자식 생성 시점에 즉시 실행한다.
