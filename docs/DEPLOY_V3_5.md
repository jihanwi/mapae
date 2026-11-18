# v3.5 배포 절차 (GIWA Sepolia)

리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다(개인키를 명령이나 파일에 적지 않는다).
이 문서에는 환경변수의 이름만 적고 값은 적지 않는다.

v3.5에서 바뀌는 것 (C-T5, 오너 결정 2026-11-18):

- 우선 구간(개설 후 `priorityWindow`, 기본 600초) 동안은 어떤 지갑도, 발행자(Dev)도, 매수 뒤 보유량이 총공급의 2%
  (20,000,000개)를 넘을 수 없다. 넘는 매수는 전체가 되돌아간다(`PriorityHoldingExceeded(balanceAfter, maxHolding)`).
  잘라서 사 주지 않는다. 면제 지갑은 없다. 우선 구간이 끝나면 한도는 없다. 매도에는 언제도 적용되지 않는다.
- `buy`, `buyFor`(받는 주소 기준), `buyWithETH`, 발행 tx 안의 Dev 첫 매수가 모두 같은 검사를 받는다.
- Dev 첫 매수 상한이 5%에서 2%로 바뀌고 위 한도와 하나가 된다. 오류 이름은 그대로 `DevFirstBuyTooLarge(tokensOut, maxTokens)`이고
  `maxTokens`가 커브의 `priorityMaxHolding`이다.
- 한도는 `CurveFactory.priorityMaxHoldingBps`(50~500, 기본 200)로 정하고, 커브가 열릴 때 토큰 수량으로 고정된다
  (`CurveSale.priorityMaxHolding()`). 바꾸면 그 뒤에 열리는 커브에만 적용된다(`setPriorityMaxHoldingBps`, owner 전용).
- 졸업 조건, 수수료, 커브 기하, 실명 판정은 그대로다. v3.2 CurveFactory(0x9b81…e652)와 그 커브들은 옛 규칙 그대로 남는다.

| 구분 | 컨트랙트 | 비고 |
|---|---|---|
| 새로 배포 | CurveFactory (v3.5) | priorityWindow 600초, priorityMaxHoldingBps 200, owner = 배포자 |
| 재사용 | DojangAnyOf 0x8732…9f84 | 실명 판정 |
| 재사용 | FeeRouter 0xAB66…7bd6 | L0 커브 수수료(커브가 열릴 때 스냅샷) |
| 재사용 | PoolFactory 0xf4E7…e44F, MockKRW 0x74eC…86fD | |
| 재사용 | MapaeFactory(mock) 0xC0E2…45A9 | 호가 자산 등록부(MockKRW 200만 원, WETH 0.002 ETH) |
| 재사용 | MembershipTokenDeployer 0x9F01…5279 | `--libraries`로 링크 |

등록이나 권한 이전은 필요 없다. 새 팩토리가 등록부와 수수료를 읽기만 하고, PoolFactory는 호출자가 토큰의 offering인지만 본다.
재사용 컨트랙트의 바이트코드는 이번 변경으로 바뀌지 않았다(빌드 산출물 비교).

## 0. 준비

```bash
git checkout main && git pull --ff-only
```

```bash
forge build && forge test
```

## 1. 환경변수

| 이름 | 용도 |
|---|---|
| `GIWA_SEPOLIA_RPC_URL` | GIWA Sepolia RPC |
| `BLOCKSCOUT_API_URL` | Blockscout verify API |
| `DEPLOYER_ADDRESS` | keystore 계정 `deployer`의 주소 (`--sender`, 새 팩토리의 owner가 된다) |

재사용 주소는 스크립트가 `deployments/giwa-sepolia-v3_2.json`에서 읽고, 스크립트 안의 기대 주소와 다르면 멈춘다.
MapaeFactory(mock)의 등록값(MockKRW, WETH 0.002 ETH)과 링크된 라이브러리 주소도 확인한다. GIWA Sepolia가 아니면 멈춘다.

## 2. 리허설 (broadcast 없음)

```bash
forge script script/DeployV3_5.s.sol --rpc-url $GIWA_SEPOLIA_RPC_URL --sender $DEPLOYER_ADDRESS --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

로그에서 `CurveFactory (v3.5)`, `priorityWindow: 600`, `priorityMaxHoldingBps: 200`, owner를 확인한다.
리허설도 `deployments/giwa-sepolia-v3_5.json`을 시뮬레이션 주소로 쓰므로 확인 뒤 지운다.

```bash
rm deployments/giwa-sepolia-v3_5.json
```

## 3. 배포

```bash
forge script script/DeployV3_5.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

트랜잭션은 1개다(CurveFactory). v3.2처럼 owner를 0x67a2…D00C로 넘길지는 배포 전에 정한다(넘긴다면 별도 tx).

## 4. Blockscout 검증

```bash
forge script script/DeployV3_5.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --resume --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

새 커브(CurveSale)와 토큰은 열린 뒤 verify-children으로 검증한다.

## 5. 결과 json

`deployments/giwa-sepolia-v3_5.json` 키:

| 키 | 값 |
|---|---|
| version | "v3.5" |
| chainId, deployBlock | 체인 ID, 배포 블록(시뮬레이션 블록이므로 `broadcast/DeployV3_5.s.sol/91342/run-latest.json`의 영수증 블록으로 고쳐 쓴다) |
| deployer, owner | 배포자, 팩토리 owner |
| curveFactory | 새 CurveFactory |
| priorityWindow | 600 |
| priorityMaxHoldingBps | 200 |
| priorityMaxHoldingTokens | 20000000000000000000000000 (2천만 개, 18자리) |
| dojangAnyOf, feeRouter, poolFactory, factoryMock, mockKRW, membershipTokenDeployer, weth | 재사용 주소 |
| wethVirtualQuote | 2000000000000000 (0.002 ETH) |
| previousCurveFactory | v3.2 CurveFactory |

## 6. 배포 뒤 확인 (읽기만)

```bash
export CF=$(jq -r .curveFactory deployments/giwa-sepolia-v3_5.json)
```

| 확인 | 명령 | 기대 |
|---|---|---|
| 한도(bps) | `cast call $CF "priorityMaxHoldingBps()(uint16)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `200` |
| 한도 범위 | `cast call $CF "MIN_PRIORITY_MAX_HOLDING_BPS()(uint16)" --rpc-url $GIWA_SEPOLIA_RPC_URL`, `MAX_...` | `50`, `500` |
| 우선 구간 | `cast call $CF "priorityWindow()(uint32)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `600` |
| 실명 판정 | `cast call $CF "dojang()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x87326FbbF76e724bA2bA954dAc04c3B939999f84 |
| 등록부 | `cast call $CF "mapaeFactory()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0xC0E22127A44266cCC56B2503504373777d0645A9 |
| owner | `cast call $CF "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 배포자(또는 넘긴 주소) |
| 커브 0개 | `cast call $CF "allCurves()(address[])" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `[]` |

새 커브가 하나 열린 뒤(`$C`는 그 커브 주소):

| 확인 | 명령 | 기대 |
|---|---|---|
| 커브의 한도 | `cast call $C "priorityMaxHolding()(uint256)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `20000000000000000000000000` |
| 우선 구간 끝 | `cast call $C "priorityUntil()(uint64)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 개설 시각 + 600 |

## 7. 마무리

- 웹 전환(새 팩토리, 매수 칸의 "지금 더 살 수 있는 수량", `PriorityHoldingExceeded` 문구, Dev 첫 매수 안내 2%)은 W-T54에서 한다.
- 테스트넷 프리셋(0.002 ETH)에서 웹의 현재 Dev 첫 매수 기본값 0.00005 ETH는 약 2.58%라 새 한도를 넘는다.
  2% 이하 최대치는 약 0.0000386 ETH(수수료 포함)다. W-T54에서 기본값을 바꿔야 한다.
