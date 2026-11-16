# v3.2-L1 배포 절차 (GIWA Sepolia)

오너가 Mac의 리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다
(개인키를 명령이나 파일에 적지 않는다). 이 문서에는 환경변수의 이름만 적고 값은 적지 않는다.

v3.2-L1에서 바뀌는 것 (C-T2, 결정 56):

- 새 L1 `MapaeFactory` 하나를 배포한다. 실명 판정은 MockDojang 대신 `DojangAnyOf`(0x8732…9f84)를 쓴다.
- 후원(Sponsorship)은 발행 시 선택한다(`CreateParams.withSponsorship`). 끄면 Sponsorship을 만들지 않는다.
- L1/L2 발행자 몫은 `ProceedsLock`(VestingWalletCliff 기반)에 잠긴다. 시작은 모금 마감, 기간과 클리프는 발행 때
  정하고 팩토리의 `ProceedsBand`(생성자에서 고정, setter 없음) 안이어야 한다. 테스트넷 밴드:
  선지급 최대 30%, 잠금 기간 1시간~1,095일, 클리프 최대 180일.
- `ProceedsLockDeployer`를 따로 배포해 팩토리 생성자에 넘긴다(팩토리 initcode 여유 4 KiB 규칙 때문).

바꾸지 않는 것: CurveFactory, CurveSale, 기존 MapaeFactory(0xC0E2…45A9, L0 견적 토큰 등록부 겸용). L0은 영향이 없다.
PoolFactory, FeeRouter, BuybackVault에 권한 등록은 필요 없다(PoolFactory는 `token.offering()`만 확인,
BuybackVault는 새 팩토리가 생성자에서 스스로 burner로 등록).

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
| `DEPLOYER_ADDRESS` | keystore 계정 `deployer`의 주소 (`--sender`) |

재사용 주소(기존 MapaeFactory, DojangAnyOf, MockKRW, PoolFactory, FeeRouter, MembershipTokenDeployer)는
스크립트가 `deployments/giwa-sepolia-v3_2.json`에서 읽고, BuybackVault는 기존 MapaeFactory에서 읽는다.
스크립트에 기대 주소가 상수로 들어 있어 하나라도 다르면 멈춘다. minRaise, Guide, FeeRecipients는 기존
MapaeFactory 값을 그대로 복사하고, Guide가 티켓 값(minPrice 1000e18, maxPrice 100000e18, minRaise 5000000e18,
maxRaise 500000000e18, 지갑 한도 10~3000 bps)과 다르면 멈춘다. GIWA Sepolia가 아니면 멈춘다.
platformOwner는 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C로 고정이다.

## 2. 리허설 (broadcast 없음)

라이브러리(MembershipTokenDeployer)를 v3.2 것으로 링크해야 forge가 새 라이브러리를 배포하지 않는다.
스크립트는 링크된 주소가 json 값과 다르면 멈춘다.

```bash
forge script script/DeployV3_2_L1.s.sol --rpc-url $GIWA_SEPOLIA_RPC_URL --sender $DEPLOYER_ADDRESS --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

로그에서 `ProceedsLockDeployer`, `MapaeFactory (v3.2-L1)`, `OfferingDeployer`, `StackDeployer` 주소와
dojang, owner, band 값을 확인한다. 리허설도 `deployments/giwa-sepolia-v3_2_l1.json`을 시뮬레이션 주소로 쓴다.
이 파일이 있으면 verify-children 워크플로가 새 팩토리를 찾으므로 확인 뒤 반드시 지운다.

```bash
rm deployments/giwa-sepolia-v3_2_l1.json
```

## 3. 배포

```bash
forge script script/DeployV3_2_L1.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

트랜잭션은 2개다(ProceedsLockDeployer, MapaeFactory). OfferingDeployer와 StackDeployer는 MapaeFactory
생성자 안에서 만들어진다.

## 4. verify

```bash
forge script script/DeployV3_2_L1.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --resume --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

`--verify`는 최상위 배포 두 개(ProceedsLockDeployer, MapaeFactory)만 검증한다. 생성자 안에서 만든
OfferingDeployer, StackDeployer는 7절의 verify-children이 검증한다.

## 5. 결과 json

```bash
cat deployments/giwa-sepolia-v3_2_l1.json
```

형식(키 이름, 값은 예시가 아니라 설명):

```json
{
  "version": "v3.2-L1",
  "chainId": 91342,
  "deployBlock": "첫 배포 트랜잭션의 블록 (아래 참고)",
  "deployer": "배포 계정",
  "platformOwner": "0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C",
  "mapaeFactory": "새 MapaeFactory",
  "offeringDeployer": "새 팩토리 생성자가 만든 OfferingDeployer",
  "stackDeployer": "새 팩토리 생성자가 만든 StackDeployer",
  "proceedsLockDeployer": "새 ProceedsLockDeployer",
  "proceedsBand": {"maxUpfrontBps": 3000, "minLockDuration": 3600, "maxLockDuration": 94608000, "maxLockCliff": 15552000},
  "dojangAnyOf": "재사용 (v3.2)",
  "mockKRW": "재사용",
  "poolFactory": "재사용",
  "feeRouter": "재사용",
  "buybackVault": "재사용",
  "membershipTokenDeployer": "재사용 라이브러리",
  "previousMapaeFactory": "0xC0E22127A44266cCC56B2503504373777d0645A9"
}
```

`deployBlock`은 고쳐 써야 한다. 스크립트는 시뮬레이션 시점의 블록을 기록한다. 배포 로그
(`broadcast/DeployV3_2_L1.s.sol/91342/run-latest.json`의 첫 영수증 `blockNumber`, 16진수)나 익스플로러에서 첫 배포
트랜잭션의 블록을 확인해 그 값으로 바꾼다. 인덱서와 verify-children이 이 값부터 이벤트를 읽는다.

## 6. 배포 뒤 확인 (읽기만)

```bash
export L1_FACTORY=$(jq -r .mapaeFactory deployments/giwa-sepolia-v3_2_l1.json)
```

| 확인 | 명령 | 기대 |
|---|---|---|
| 실명 판정 | `cast call $L1_FACTORY "dojang()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x87326FbbF76e724bA2bA954dAc04c3B939999f84 |
| owner | `cast call $L1_FACTORY "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C |
| platformOwner | `cast call $L1_FACTORY "platformOwner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 위와 같음 |
| 발행 0건 | `cast call $L1_FACTORY "allOfferings()(address[])" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `[]` |
| 잠금 밴드 | `cast call $L1_FACTORY "proceedsBand()((uint16,uint64,uint64,uint64))" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(3000, 3600, 94608000, 15552000)` |
| 잠금 배포기 | `cast call $L1_FACTORY "proceedsLockDeployer()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | json의 proceedsLockDeployer |
| minRaise | `cast call $L1_FACTORY "minRaise()(uint256)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 기존 팩토리와 같음 |
| Guide | `cast call $L1_FACTORY "guide()(uint256,uint256,uint256,uint256,uint16,uint16)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 1000e18, 100000e18, 5000000e18, 500000000e18, 10, 3000 |
| 수수료 수령자 | `cast call $L1_FACTORY "feeRecipients()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 기존 팩토리와 같음 |
| BuybackVault | `cast call $L1_FACTORY "buybackVault()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c |
| burner 등록 | `cast call $L1_FACTORY "isBurner(address)(bool)" 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c --rpc-url $GIWA_SEPOLIA_RPC_URL` | true |
| 기존 팩토리 무변경 | `cast call 0xC0E22127A44266cCC56B2503504373777d0645A9 "isQuoteAllowed(address)(bool)" 0x74eC9141afAd51F346BA5B841Ba93D573e8786fD --rpc-url $GIWA_SEPOLIA_RPC_URL` | true |

기존 팩토리 값과 비교할 때는 같은 명령의 주소만 0xC0E22127A44266cCC56B2503504373777d0645A9로 바꿔 실행한다.

## 7. 팩토리 자식 verify (첫 발행을 연 뒤)

```bash
node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL --deployment deployments/giwa-sepolia-v3_2_l1.json --from-block $(jq -r .deployBlock deployments/giwa-sepolia-v3_2_l1.json) --factory $(jq -r .mapaeFactory deployments/giwa-sepolia-v3_2_l1.json)
```

스크립트는 팩토리에 `proceedsLockDeployer()`가 있으면 v3.2-L1 형식으로 읽는다: OfferingDeployer, StackDeployer,
ProceedsLockDeployer, 그리고 발행마다 Offering, MembershipToken, RedeemManager, MapaeVesting, Sponsorship(있을 때만),
ProceedsLock(L1/L2), 정산 뒤 MapaePool. 이벤트가 0건이면 일부러 실패한다(발행 전이면 `--allow-empty 1`).
`deployments/giwa-sepolia-v3_2_l1.json`이 main에 올라가면 3시간마다 도는 verify-children 워크플로도 같은 경로를 실행한다.

## 8. 마무리

- 웹을 새 팩토리로 바꾸는 것은 별도 티켓이다(주소 codegen, 발행 화면의 후원 선택과 잠금 입력, 잠금 해제 화면).
  ABI는 `web/src/contracts/abisV3L1.ts`에 미리 내보내 두었다.
- 기존 MapaeFactory(0xC0E2…45A9)는 그대로 남는다. 발행 0건이고 L0 견적 토큰 등록부로 계속 쓰인다.
