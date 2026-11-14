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
