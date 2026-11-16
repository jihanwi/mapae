# v3.3-L1 배포 절차 (GIWA Sepolia)

PM 이 리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다(개인키를 명령이나
파일에 적지 않는다). 이 문서에는 환경변수의 이름만 적고 값은 적지 않는다.

v3.3-L1 에서 바뀌는 것 (C-T3, 결정 59):

- L1/L2 공모 수수료(offeringFeeBps)의 허용 범위가 0~5%(0~500 bps)가 된다. 처음 값은 0%. 거래 수수료는 그대로다
  (플랫폼 0.40% · 발행자 0.60% · 소각 0.30% · 유동성 0.20%, 합 1.50%).
- 범위는 FeeRouter 의 상수라서 FeeRouter 를 새로 배포한다. FeeRouter 는 MapaeFactory 에 immutable 로 들어가므로
  L1 MapaeFactory 도 새로 배포한다(그 생성자가 OfferingDeployer 와 StackDeployer 를 새로 만든다).

| 구분 | 컨트랙트 | 이유 |
|---|---|---|
| 새로 배포 | FeeRouter | 범위가 상수. owner 와 platformTreasury 는 지금 FeeRouter(0xAB66…7bd6)와 같게 |
| 새로 배포 | MapaeFactory (L1) | FeeRouter 가 immutable |
| 새로 생김 | OfferingDeployer, StackDeployer | 팩토리 생성자가 만들고 그 팩토리에 묶여 있음 |
| 재사용 | ProceedsLockDeployer 0x7555…97C9 | 권한이 없고 상태가 없다(deploy 의 인자를 전부 호출자가 준다). 팩토리에 묶여 있지 않다 |
| 재사용 | DojangAnyOf, MockKRW, PoolFactory, BuybackVault, MembershipTokenDeployer | 바뀐 것 없음 |

바꾸지 않는 것: L0 CurveFactory(0x9b81…e652)와 그것이 쓰는 지금의 FeeRouter(0xAB66…7bd6), 지금의 L1 팩토리
(0xa9CA…bc71)와 그 공모들(옛 조건 그대로). 권한 등록은 필요 없다(PoolFactory 는 `token.offering()`만 확인,
BuybackVault 는 새 팩토리가 생성자에서 스스로 burner 로 등록).

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
| `DEPLOYER_ADDRESS` | keystore 계정 `deployer`의 주소 (`--sender`, 누구여도 된다) |

재사용 주소는 스크립트가 `deployments/giwa-sepolia-v3_2.json`과 `deployments/giwa-sepolia-v3_2_l1.json`에서 읽고,
스크립트 안의 기대 주소와 다르면 멈춘다. 팩토리 설정(Guide, ProceedsBand, minRaise, FeeRecipients)은 지금의 L1
팩토리에서 읽어 그대로 넣고, 배포 뒤 다시 대조한다. owner 와 platformOwner 는 생성자에서
0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C 로 정해진다(이전 트랜잭션 없음). 새 FeeRouter 의 owner 와 platformTreasury
는 지금 FeeRouter 에서 읽은 값이다. GIWA Sepolia 가 아니면 멈춘다.

## 2. 리허설 (broadcast 없음)

```bash
forge script script/DeployV3_3_L1.s.sol --rpc-url $GIWA_SEPOLIA_RPC_URL --sender $DEPLOYER_ADDRESS --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

로그에서 `FeeRouter (v3.3-L1)`, `MapaeFactory (v3.3-L1)`, `L1 offeringFeeBps: 0`, router owner / treasury 를 확인한다.
리허설도 `deployments/giwa-sepolia-v3_3_l1.json`을 시뮬레이션 주소로 쓰므로 확인 뒤 지운다.

```bash
rm deployments/giwa-sepolia-v3_3_l1.json
```

## 3. 배포

```bash
forge script script/DeployV3_3_L1.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

트랜잭션은 2개다(FeeRouter, MapaeFactory).

## 4. Blockscout 검증

최상위 배포 두 개(FeeRouter, MapaeFactory):

```bash
forge script script/DeployV3_3_L1.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --resume --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_2.json)
```

`--verify`는 최상위 배포 두 개만 검증한다. 팩토리 생성자가 만든 OfferingDeployer, StackDeployer 와
공모가 열린 뒤의 자식 컨트랙트(Offering, 토큰, RedeemManager, MapaeVesting, ProceedsLock, 풀)는 verify-children 으로:

```bash
node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL --deployment deployments/giwa-sepolia-v3_3_l1.json --from-block $(jq -r .deployBlock deployments/giwa-sepolia-v3_3_l1.json) --factory $(jq -r .mapaeFactory deployments/giwa-sepolia-v3_3_l1.json)
```

(3시간마다 도는 verify-children 워크플로는 아직 v3.2-L1 json 만 본다. 새 팩토리를 넣는 것은 웹 주소 전환 티켓에서 한다.)

## 5. 결과 json

```bash
cat deployments/giwa-sepolia-v3_3_l1.json
```

키: version("v3.3-L1"), chainId, deployBlock, deployer, platformOwner, feeRouter, mapaeFactory, offeringDeployer,
stackDeployer, proceedsLockDeployer(재사용), proceedsBand, dojangAnyOf, mockKRW, poolFactory, buybackVault,
membershipTokenDeployer, previousFeeRouter, previousMapaeFactory.

`deployBlock`은 고쳐 써야 한다. 스크립트는 시뮬레이션 시점의 블록을 기록한다.
`broadcast/DeployV3_3_L1.s.sol/91342/run-latest.json`의 첫 영수증 `blockNumber`(16진수)나 익스플로러에서 첫 배포
트랜잭션의 블록을 확인해 그 값으로 바꾼다.

## 6. 배포 뒤 확인 (읽기만)

```bash
export FR=$(jq -r .feeRouter deployments/giwa-sepolia-v3_3_l1.json)
```

```bash
export F=$(jq -r .mapaeFactory deployments/giwa-sepolia-v3_3_l1.json)
```

```bash
export OLD_FR=0xAB665B7867080cd62Aa316717400f3Cc094E7bd6
```

```bash
export OLD_F=0xa9CA0C10Cd6B6398679B578DCE192cb4cAA5bc71
```

| 확인 | 명령 | 기대 |
|---|---|---|
| L1 수수료 | `cast call $FR "getFees(uint8)((uint16,uint16,uint16,uint16,uint16,uint16))" 1 --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(0, 40, 60, 30, 20, 400)` |
| L2 수수료 | `cast call $FR "getFees(uint8)((uint16,uint16,uint16,uint16,uint16,uint16))" 2 --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(0, 40, 60, 30, 20, 300)` |
| L0 수수료(그대로) | `cast call $FR "getFees(uint8)((uint16,uint16,uint16,uint16,uint16,uint16))" 0 --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(500, 40, 30, 0, 30, 0)` |
| 거래 수수료 합 | `cast call $FR "swapTotalBps(uint8)(uint16)" 1 --rpc-url $GIWA_SEPOLIA_RPC_URL` | `150` |
| router owner | `cast call $FR "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 옛 router 의 `owner()`와 같음 |
| treasury | `cast call $FR "platformTreasury()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 옛 router 의 `platformTreasury()`와 같음 |
| 5% 허용 (시뮬레이션) | `cast call $FR "setFees(uint8,(uint16,uint16,uint16,uint16,uint16,uint16))" 1 "(500,40,60,30,20,400)" --from $(cast call $FR "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL) --rpc-url $GIWA_SEPOLIA_RPC_URL` | 성공(출력 없음) |
| 5.01% 거부 (시뮬레이션) | `cast call $FR "setFees(uint8,(uint16,uint16,uint16,uint16,uint16,uint16))" 1 "(501,40,60,30,20,400)" --from $(cast call $FR "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL) --rpc-url $GIWA_SEPOLIA_RPC_URL` | `OutOfBand()` 로 되돌려짐 |
| 팩토리의 router | `cast call $F "feeRouter()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$FR` |
| 실명 판정 | `cast call $F "dojang()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x87326FbbF76e724bA2bA954dAc04c3B939999f84 |
| owner | `cast call $F "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C |
| platformOwner | `cast call $F "platformOwner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 위와 같음 |
| 발행 0건 | `cast call $F "allOfferings()(address[])" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `[]` |
| 잠금 밴드 | `cast call $F "proceedsBand()((uint16,uint64,uint64,uint64))" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(3000, 3600, 94608000, 15552000)` |
| 잠금 배포기(재사용) | `cast call $F "proceedsLockDeployer()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9 |
| minRaise | `cast call $F "minRaise()(uint256)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_F` 로 바꾼 같은 명령의 값과 같음 |
| Guide | `cast call $F "guide()(uint256,uint256,uint256,uint256,uint16,uint16)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 1000e18, 100000e18, 5000000e18, 500000000e18, 10, 3000 |
| 수수료 수령자 | `cast call $F "feeRecipients()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_F` 로 바꾼 같은 명령의 값과 같음 |
| BuybackVault | `cast call $F "buybackVault()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c |
| burner 등록 | `cast call $F "isBurner(address)(bool)" 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c --rpc-url $GIWA_SEPOLIA_RPC_URL` | true |
| 옛 L1 팩토리 무변경 | `cast call $OLD_F "feeRouter()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_FR` |
| L0 무변경 | `cast call 0x9b8155C39cdB912557d8588157fC11e8D989e652 "feeRouter()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_FR` |
| 옛 router 의 L1 수수료(그대로) | `cast call $OLD_FR "getFees(uint8)((uint16,uint16,uint16,uint16,uint16,uint16))" 1 --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(750, 40, 60, 30, 20, 400)` |

옛 값과 비교하는 줄(router owner, treasury, minRaise, 수수료 수령자)은 같은 명령의 주소만 `$OLD_FR` 또는 `$OLD_F` 로
바꿔 실행한다.

## 7. 마무리

- 웹의 주소 전환(새 팩토리로 공모 열기, 인덱서 L1 커서, verify-children 워크플로)은 별도 티켓이다.
- 옛 L1 팩토리와 그 공모 두 건은 옛 조건(공모 수수료 7.5%) 그대로 체인에 남는다.
