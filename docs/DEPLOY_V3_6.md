# v3.6 배포 절차 (GIWA Sepolia)

리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다(개인키를 명령이나 파일에 적지 않는다).
이 문서에는 환경변수의 이름만 적고 값은 적지 않는다. RPC와 Blockscout 주소는 공개 주소라 명령에 그대로 적었다.

v3.6에서 바뀌는 것 (C-T6):

- 예고 발행: `createCurve`와 `createCurveWithETH`의 마지막 인자 `LaunchOptions { uint64 startTime; bool verifiedOnly; }`.
  `startTime = 0`이면 지금처럼 바로 시작한다. 0이 아니면 `지금 + 10분` 이상 `지금 + 7일` 이하여야 한다
  (`MIN_START_DELAY`, `MAX_START_DELAY`, 밖이면 `StartTimeOutOfBand(startTime)`). 시작 전에는 `buy`, `buyFor`, `sell`이
  `NotStarted(startTime)`로 막히고(`buyWithETH`도 `buyFor`를 거쳐 같은 오류), `quoteBuy`, `quoteSell`, `spotPrice`는 동작한다.
  우선 구간과 지갑당 2% 한도는 시작 시각부터 센다(`priorityUntil = startTime + 600`). 예고 발행에서는 생성 tx 안의 Dev 첫 매수를
  할 수 없다(`DevBuyNotAllowedWhenScheduled`). 취소와 시각 변경은 없다. 7일 3개 발행 한도는 생성 시점에 쓴다.
- 실명 전용: `verifiedOnly = true`면 졸업 전까지 실명 지갑만 산다(우선 구간과 같은 fail-closed 판정). 매도는 누구나, 졸업 뒤 풀도
  누구나. 2% 한도는 우선 구간에만 있다.
- `CurveCreated` 끝에 `uint64 startTime, bool verifiedOnly`가 붙는다(앞 필드 순서는 그대로). 커브에 `startTime()`,
  `verifiedOnly()`, `started()`가 생긴다.
- 그 밖의 값(우선 구간 600초, 한도 200 bps, 수수료, 졸업 조건, 풀, L1)은 v3.5와 같다. v3.5 CurveFactory(0x741E…6783)와
  그 커브들은 v3.5 규칙 그대로 남는다.

| 구분 | 컨트랙트 | 비고 |
|---|---|---|
| 새로 배포 | CurveFactory (v3.6) | priorityWindow 600초, priorityMaxHoldingBps 200, owner = 배포자 |
| 재사용 | DojangAnyOf 0x8732…9f84 | 실명 판정 |
| 재사용 | FeeRouter 0xAB66…7bd6 | L0 커브 수수료(커브가 열릴 때 스냅샷) |
| 재사용 | PoolFactory 0xf4E7…e44F, MockKRW 0x74eC…86fD | |
| 재사용 | MapaeFactory(mock) 0xC0E2…45A9 | 호가 자산 등록부(MockKRW 200만 원, WETH 0.002 ETH) |
| 재사용 | MembershipTokenDeployer 0x9F01…5279 | `--libraries`로 링크 |

등록, 권한 부여, owner 트랜잭션은 필요 없다. 새 팩토리는 등록부와 FeeRouter의 커브 수수료를 읽기만 하고, PoolFactory는 호출자가
토큰의 offering(커브)인지만 본다. 배포 트랜잭션은 1개다.

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
| `DEPLOYER_ADDRESS` | keystore 계정 `deployer`의 주소 (`--sender`, 새 팩토리의 owner가 된다) |

재사용 주소는 스크립트가 `deployments/giwa-sepolia-v3_5.json`에서 읽고, 스크립트 안의 기대 주소와 다르면 멈춘다.
MapaeFactory(mock)의 등록값(MockKRW, WETH 0.002 ETH)과 링크된 라이브러리 주소도 확인한다. GIWA Sepolia가 아니면 멈춘다.

## 2. 리허설 (broadcast 없음)

```bash
forge script script/DeployV3_6.s.sol --rpc-url https://sepolia-rpc.giwa.io --sender $DEPLOYER_ADDRESS --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_5.json)
```

로그에서 `CurveFactory (v3.6)`, `priorityWindow: 600`, `priorityMaxHoldingBps: 200`, `owner`(= `$DEPLOYER_ADDRESS`),
`minStartDelay: 600`, `maxStartDelay: 604800`, `dry run: deployments/giwa-sepolia-v3_6.json not written`을 확인한다.
v3.5와 달리 리허설은 json을 쓰지 않으므로 지울 파일이 없다.

## 3. 배포

```bash
forge script script/DeployV3_6.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url https://sepolia-rpc.giwa.io --broadcast --slow --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_5.json)
```

트랜잭션은 1개다(CurveFactory). broadcast일 때만 `deployments/giwa-sepolia-v3_6.json`이 써진다.
v3.5처럼 owner를 0x67a2…D00C로 넘길지는 배포 전에 정한다(넘긴다면 별도 tx, 이 문서 범위 밖).

## 4. Blockscout 검증

```bash
forge script script/DeployV3_6.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url https://sepolia-rpc.giwa.io --broadcast --resume --verify --verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api/ --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_5.json)
```

`--resume`도 json을 다시 쓴다(같은 주소). 검증만 따로 할 때는 아래처럼 한다.

```bash
export BLOCKSCOUT_API_URL=https://sepolia-explorer.giwa.io/api/
```

```bash
forge verify-contract $(jq -r .curveFactory deployments/giwa-sepolia-v3_6.json) src/CurveFactory.sol:CurveFactory --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL --chain-id 91342 --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_5.json) --constructor-args $(cast abi-encode "constructor(address,address,address,address,address,address,uint16)" $(jq -r .dojangAnyOf deployments/giwa-sepolia-v3_6.json) $(jq -r .feeRouter deployments/giwa-sepolia-v3_6.json) $(jq -r .poolFactory deployments/giwa-sepolia-v3_6.json) $(jq -r .factoryMock deployments/giwa-sepolia-v3_6.json) $(jq -r .weth deployments/giwa-sepolia-v3_6.json) $(jq -r .owner deployments/giwa-sepolia-v3_6.json) 200)
```

새 커브(CurveSale)와 토큰은 열린 뒤 verify-children으로 검증한다.

## 5. 결과 json

`deployments/giwa-sepolia-v3_6.json` 키:

| 키 | 값 |
|---|---|
| version | "v3.6" |
| chainId, deployBlock | 체인 ID, 배포 블록(시뮬레이션 블록이므로 `broadcast/DeployV3_6.s.sol/91342/run-latest.json`의 영수증 블록으로 고쳐 쓴다) |
| deployer, owner | 배포자, 팩토리 owner |
| curveFactory | 새 CurveFactory |
| priorityWindow | 600 |
| priorityMaxHoldingBps | 200 |
| priorityMaxHoldingTokens | 20000000000000000000000000 (2천만 개, 18자리) |
| minStartDelay, maxStartDelay | 600, 604800 |
| dojangAnyOf, feeRouter, poolFactory, factoryMock, mockKRW, membershipTokenDeployer, weth | 재사용 주소 |
| wethVirtualQuote | 2000000000000000 (0.002 ETH) |
| previousCurveFactory | v3.5 CurveFactory |

배포 블록을 고친 뒤 json을 커밋한다(웹 전환 W-T61의 시작 조건).

## 6. 배포 뒤 확인 (읽기만)

```bash
export CF=$(jq -r .curveFactory deployments/giwa-sepolia-v3_6.json)
```

| 확인 | 명령 | 기대 |
|---|---|---|
| 예고 범위 | `cast call $CF "MIN_START_DELAY()(uint256)" --rpc-url https://sepolia-rpc.giwa.io`, `MAX_START_DELAY` | `600`, `604800` |
| 한도(bps) | `cast call $CF "priorityMaxHoldingBps()(uint16)" --rpc-url https://sepolia-rpc.giwa.io` | `200` |
| 우선 구간 | `cast call $CF "priorityWindow()(uint32)" --rpc-url https://sepolia-rpc.giwa.io` | `600` |
| 실명 판정 | `cast call $CF "dojang()(address)" --rpc-url https://sepolia-rpc.giwa.io` | 0x87326FbbF76e724bA2bA954dAc04c3B939999f84 |
| 등록부 | `cast call $CF "mapaeFactory()(address)" --rpc-url https://sepolia-rpc.giwa.io` | 0xC0E22127A44266cCC56B2503504373777d0645A9 |
| owner | `cast call $CF "owner()(address)" --rpc-url https://sepolia-rpc.giwa.io` | 배포자(또는 넘긴 주소) |
| 커브 0개 | `cast call $CF "allCurves()(address[])" --rpc-url https://sepolia-rpc.giwa.io` | `[]` |

새 커브가 하나 열린 뒤(`$C`는 그 커브 주소):

| 확인 | 명령 | 기대 |
|---|---|---|
| 시작 시각 | `cast call $C "startTime()(uint64)" --rpc-url https://sepolia-rpc.giwa.io` | 즉시 발행이면 개설 시각, 예고면 정한 시각 |
| 시작 여부 | `cast call $C "started()(bool)" --rpc-url https://sepolia-rpc.giwa.io` | 시작 전 `false` |
| 실명 전용 | `cast call $C "verifiedOnly()(bool)" --rpc-url https://sepolia-rpc.giwa.io` | 고른 값 |
| 우선 구간 끝 | `cast call $C "priorityUntil()(uint64)" --rpc-url https://sepolia-rpc.giwa.io` | startTime + 600 |
| 커브의 한도 | `cast call $C "priorityMaxHolding()(uint256)" --rpc-url https://sepolia-rpc.giwa.io` | `20000000000000000000000000` |

## 7. 마무리

- 웹 전환(발행 화면의 거래 시작·실명 전용, 시작 전 토큰 화면, 예정 탭, 인덱서 컬럼)은 W-T61에서 한다.
- `script/DemoCurve.s.sol`은 옵션을 끈 채(`LaunchOptions(0, false)`) v3.5와 같게 동작한다.
