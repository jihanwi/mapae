# v3.4-L1 배포 절차 (GIWA Sepolia)

PM 이 리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다(개인키를 명령이나
파일에 적지 않는다). 이 문서에는 환경변수의 이름만 적고 값은 적지 않는다.

v3.4-L1 에서 바뀌는 것 (C-T4, 결정 62 · 63):

- 정산 전용 주소(settler). `Offering.settle` 은 owner 이거나, 그 시점에 팩토리의 `settler()` 인 주소만 호출할 수 있다.
  settler 는 settle 말고는 아무 권한이 없다. 팩토리 owner 가 `setSettler(address)` 로 바꾸거나 `address(0)` 으로
  비우며(그러면 owner 만 정산), 바꾸면 이미 열린 공모에도 바로 적용된다. 그 밖의 호출자는 `NotSettleAuthority(address)`.
- 응모가 한 건도 없는 공모는 부분 환불 모드(Partial)여도 deadline 뒤 누구나 `enableRefunds()` 를 호출해 바로
  Refunding 으로 끝낼 수 있다(전에는 Partial 이면 deadline + 7일의 `emergencyRefund` 를 기다려야 했다).
  응모가 있는 Partial 공모는 전과 같이 `RefundNotAvailable`.
- 라이브 캡: L1/L2 버킷은 Open 이나 Frozen 인 공모만 센다. 정산을 마친 공모(Settled)와 환불 중인 공모(Refunding)는
  다음 L1/L2 공모를 막지 않는다. L0 버킷(실패하지 않은 L0 3개)은 그대로다.

| 구분 | 컨트랙트 | 이유 |
|---|---|---|
| 새로 배포 | MapaeFactory (L1) | settler, 라이브 캡, Offering 바이트코드 변경 |
| 새로 생김 | OfferingDeployer, StackDeployer | 팩토리 생성자가 만들고 그 팩토리에 묶여 있음 |
| 재사용 | FeeRouter 0xC8EF…5a70 (v3.3-L1) | 수수료와 범위가 바뀌지 않았다 |
| 재사용 | ProceedsLockDeployer 0x7555…97C9 | 권한과 상태가 없고 팩토리에 묶여 있지 않다 |
| 재사용 | DojangAnyOf, MockKRW, PoolFactory, BuybackVault, MembershipTokenDeployer | 바뀐 것 없음 |

바꾸지 않는 것: v3.3-L1 팩토리(0x3b1D…767f)와 그 공모들(옛 규칙 그대로, owner 만 정산, 정산 뒤에도 캡 유지),
L0 CurveFactory 와 그 FeeRouter. 권한 등록은 필요 없다(PoolFactory 는 `token.offering()`만 확인, BuybackVault 는
새 팩토리가 생성자에서 스스로 burner 로 등록, FeeRouter 에는 팩토리 등록이 없다).

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
| `PLATFORM_OWNER` | 새 팩토리의 owner 겸 platformOwner(모든 공모의 owner). 0 이면 멈춘다 |
| `SETTLER` | 정산 전용 주소. 반드시 지정한다. 비워 두려면 `0x0000000000000000000000000000000000000000` |

재사용 주소는 스크립트가 `deployments/giwa-sepolia-v3_3_l1.json`에서 읽고, 스크립트 안의 기대 주소와 다르면 멈춘다.
팩토리 설정(Guide, ProceedsBand, minRaise, FeeRecipients)은 v3.3-L1 팩토리에서 읽어 그대로 넣고, 배포 뒤 다시
대조한다. GIWA Sepolia 가 아니면 멈춘다.

## 2. 리허설 (broadcast 없음)

```bash
forge script script/DeployV3_4_L1.s.sol --rpc-url $GIWA_SEPOLIA_RPC_URL --sender $DEPLOYER_ADDRESS --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_3_l1.json)
```

로그에서 `MapaeFactory (v3.4-L1)`, `FeeRouter (reused)`(0xC8EF…5a70), owner / platformOwner, settler 를 확인한다.
리허설도 `deployments/giwa-sepolia-v3_4_l1.json`을 시뮬레이션 주소로 쓰므로 확인 뒤 지운다.

```bash
rm deployments/giwa-sepolia-v3_4_l1.json
```

## 3. 배포

```bash
forge script script/DeployV3_4_L1.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_3_l1.json)
```

트랜잭션은 1개다(MapaeFactory).

## 4. Blockscout 검증

```bash
forge script script/DeployV3_4_L1.s.sol --account deployer --sender $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --resume --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_3_l1.json)
```

팩토리 생성자가 만든 OfferingDeployer, StackDeployer 와 공모가 열린 뒤의 자식 컨트랙트는 verify-children 으로:

```bash
node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL --deployment deployments/giwa-sepolia-v3_4_l1.json --from-block $(jq -r .deployBlock deployments/giwa-sepolia-v3_4_l1.json) --factory $(jq -r .mapaeFactory deployments/giwa-sepolia-v3_4_l1.json)
```

## 5. 결과 json

```bash
cat deployments/giwa-sepolia-v3_4_l1.json
```

키: version("v3.4-L1"), chainId, deployBlock, deployer, platformOwner, settler, feeRouter(재사용), mapaeFactory,
offeringDeployer, stackDeployer, proceedsLockDeployer(재사용), proceedsBand, dojangAnyOf, mockKRW, poolFactory,
buybackVault, membershipTokenDeployer, previousMapaeFactory.

`deployBlock`은 고쳐 써야 한다. 스크립트는 시뮬레이션 시점의 블록을 기록한다.
`broadcast/DeployV3_4_L1.s.sol/91342/run-latest.json`의 영수증 `blockNumber`(16진수)나 익스플로러에서 배포
트랜잭션의 블록을 확인해 그 값으로 바꾼다.

## 6. 배포 뒤 확인 (읽기만)

```bash
export F=$(jq -r .mapaeFactory deployments/giwa-sepolia-v3_4_l1.json)
```

```bash
export OLD_F=0x3b1D679d6CFA5f2e92832aFfBf516319204D767f
```

| 확인 | 명령 | 기대 |
|---|---|---|
| settler | `cast call $F "settler()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `SETTLER` 값 |
| owner | `cast call $F "owner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `PLATFORM_OWNER` 값 |
| platformOwner | `cast call $F "platformOwner()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 위와 같음 |
| router(재사용) | `cast call $F "feeRouter()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0xC8EF125aa945aF92144ECadc39CeE1a0b7415a70 |
| 실명 판정 | `cast call $F "dojang()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x87326FbbF76e724bA2bA954dAc04c3B939999f84 |
| 발행 0건 | `cast call $F "allOfferings()(address[])" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `[]` |
| 잠금 밴드 | `cast call $F "proceedsBand()((uint16,uint64,uint64,uint64))" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `(3000, 3600, 94608000, 15552000)` |
| 잠금 배포기(재사용) | `cast call $F "proceedsLockDeployer()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9 |
| Guide | `cast call $F "guide()(uint256,uint256,uint256,uint256,uint16,uint16)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_F` 로 바꾼 같은 명령의 값과 같음 |
| minRaise | `cast call $F "minRaise()(uint256)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_F` 와 같음 |
| 수수료 수령자 | `cast call $F "feeRecipients()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | `$OLD_F` 와 같음 |
| burner 등록 | `cast call $F "isBurner(address)(bool)" 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c --rpc-url $GIWA_SEPOLIA_RPC_URL` | true |
| setSettler 는 owner 만 (시뮬레이션) | `cast call $F "setSettler(address)" 0x000000000000000000000000000000000000dEaD --from $DEPLOYER_ADDRESS --rpc-url $GIWA_SEPOLIA_RPC_URL` | 배포자가 owner 가 아니면 `OwnableUnauthorizedAccount` 로 되돌려짐 |
| 옛 팩토리 무변경 | `cast call $OLD_F "feeRouter()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL` | 0xC8EF125aa945aF92144ECadc39CeE1a0b7415a70 |

## 7. settler 리허설

새 팩토리로 공모가 하나 열리고 deadline 이 지난 뒤, 실제 정산 전에 시뮬레이션으로 권한을 확인한다
(`$O` 는 그 공모 주소, 인자는 정산 스크립트가 낸 값).

```bash
cast call $O "settlerRegistry()(address)" --rpc-url $GIWA_SEPOLIA_RPC_URL
```

기대: `$F`.

```bash
cast call $O "settle(bytes32,uint256,uint256,bytes32)" <root> <totalSold> <totalRaised> <seed> --from $SETTLER --rpc-url $GIWA_SEPOLIA_RPC_URL
```

기대: 성공(출력 없음).

```bash
cast call $O "settle(bytes32,uint256,uint256,bytes32)" <root> <totalSold> <totalRaised> <seed> --from 0x000000000000000000000000000000000000dEaD --rpc-url $GIWA_SEPOLIA_RPC_URL
```

기대: `NotSettleAuthority(0x…dEaD)` 로 되돌려짐. 확인 뒤 settler 키로 실제 정산을 보낸다.

## 8. 마무리

- 웹의 주소 전환(새 팩토리로 공모 열기, 인덱서 L1 커서, verify-children 워크플로)은 별도 티켓이다.
- 메인넷 settler 를 누가 갖는지는 아직 정해지지 않았다(오너 결정 대기).
