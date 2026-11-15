# v3.2 배포 절차 (GIWA Sepolia)

오너가 Mac의 리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다
(개인키를 명령이나 파일에 적지 않는다). 이 문서에는 환경변수의 이름만 적고 값은 적지 않는다.

v3.2에서 바뀌는 것 (STATUS 결정 46, 49):

- `DojangEASAdapter`가 DojangScroll을 발행자 ID(TESTNET_FAUCET)로 조회한다. v3.1 어댑터
  (0x8Cad…b640)는 스키마 UID를 넘겨 공식 도장 지갑에도 false를 돌려줬다.
- `DojangAnyOf`가 공식 도장(어댑터)과 MockDojang 중 하나라도 true면 실명으로 본다(테스트넷 전용, 메인넷은 어댑터 단독).
- `CurveFactory`가 발행 tx 안의 Dev 첫 매수를 총공급의 5%(5,000만 개)로 막는다. 넘으면 발행 전체가 되돌아간다.

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
| `DEPLOYMENT_IN` | (선택) 재사용할 v3.1 주소를 읽을 json. 비우면 `deployments/giwa-sepolia-v3_1.json` |

재사용하는 컨트랙트 주소(MockKRW, MockDojang, PoolFactory, FeeRouter, MapaeFactory(mock),
MembershipTokenDeployer)는 스크립트가 v3.1 json에서 읽는다. 이 여섯 개는 v3.2에서 바이트코드가 바뀌지 않았다
(메타데이터 포함 동일). MapaeFactory(mock)에는 MockKRW(200만 원)와 WETH(0.002 ETH, 결정 29)가 이미 등록돼 있어
새로 등록하지 않는다. 스크립트가 등록값을 확인하고, 다르면 멈춘다.

## 2. 리허설 (broadcast 없음)

라이브러리(MembershipTokenDeployer)를 v3.1 것으로 링크해야 forge가 새 라이브러리를 배포하지 않는다.
스크립트는 링크된 주소가 json의 값과 다르면 멈춘다.

```bash
forge script script/DeployV3_2.s.sol --rpc-url $GIWA_SEPOLIA_RPC_URL --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_1.json)
```

로그에서 `DojangEASAdapter (TESTNET_FAUCET)`, `DojangAnyOf`, `CurveFactory (v3.2)` 주소와 재사용 MapaeFactory를
확인한다. 리허설도 `deployments/giwa-sepolia-v3_2.json`을 시뮬레이션 주소로 쓰므로 확인 뒤 지운다.

```bash
rm deployments/giwa-sepolia-v3_2.json
```

## 3. 배포

```bash
forge script script/DeployV3_2.s.sol --account deployer --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_1.json)
```

트랜잭션은 3개다(어댑터, DojangAnyOf, CurveFactory). 우선 구간은 CurveFactory 기본값 600초 그대로다.

## 4. verify

```bash
forge script script/DeployV3_2.s.sol --account deployer --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --resume --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:$(jq -r .membershipTokenDeployer deployments/giwa-sepolia-v3_1.json)
```

세 컨트랙트 모두 최상위 배포라 `--verify`로 검증된다. 재사용 컨트랙트는 v3.1 때 이미 verify돼 있다.

## 5. 결과 json

```bash
cat deployments/giwa-sepolia-v3_2.json
```

형식(키 이름, 값은 예시가 아니라 설명):

```json
{
  "version": "v3.2",
  "chainId": 91342,
  "deployBlock": "첫 배포 트랜잭션의 블록 (아래 참고)",
  "deployer": "배포 계정",
  "mockKRW": "재사용 (v3.1)",
  "mockDojang": "재사용 (v3.1)",
  "poolFactory": "재사용 (v3.1)",
  "feeRouter": "재사용 (v3.1)",
  "factoryMock": "재사용 MapaeFactory (v3.1)",
  "membershipTokenDeployer": "재사용 라이브러리 (v3.1)",
  "dojangEASAdapter": "새 어댑터 (TESTNET_FAUCET)",
  "dojangAnyOf": "새 합성기",
  "curveFactory": "새 CurveFactory",
  "weth": "0x4200000000000000000000000000000000000006",
  "attesterId": "TESTNET_FAUCET 발행자 ID",
  "schemaUid": "Verified Address 스키마 UID",
  "devFirstBuyMaxTokens": "50000000000000000000000000",
  "priorityWindow": 600,
  "wethVirtualQuote": 2000000000000000
}
```

`deployBlock`은 고쳐 써야 한다. 스크립트는 시뮬레이션 시점의 블록을 기록한다. 배포 로그
(`broadcast/DeployV3_2.s.sol/91342/run-latest.json`의 첫 영수증 `blockNumber`, 16진수)나 익스플로러에서 첫 배포
트랜잭션의 블록을 확인해 그 값으로 바꾼다. 인덱서와 verify-children이 이 값부터 이벤트를 읽는다.

## 6. 배포 뒤 확인 (읽기만)

공식 도장 지갑 하나를 찾는다. 테스트넷 도장은 발급 30일 뒤 만료되므로 그때그때 찾는다. 최근 9,000블록(RPC 한도
10,000) 안에서 Verified Address 스키마로 발급된 Attested 로그의 recipient 중 마지막 것:

```bash
export DOJANG_VERIFIED_WALLET=$(cast logs --rpc-url $GIWA_SEPOLIA_RPC_URL --from-block $(( $(cast block-number --rpc-url $GIWA_SEPOLIA_RPC_URL) - 9000 )) --address 0x4200000000000000000000000000000000000021 "Attested(address,address,bytes32,bytes32)" --json | jq -r '[.[] | select(.topics[3] == "0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08")] | last | "0x" + .topics[1][26:]')
```

결과가 `0x`나 `null`이면 그 9,000블록 안에 발급이 없는 것이다. `--from-block`/`--to-block`을 더 이전 구간으로
옮겨 다시 찾는다. 찾은 지갑이 TESTNET_FAUCET 도장인지 DojangScroll로 확인한다(기대: true).

```bash
cast call 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9 "isVerified(address,bytes32)(bool)" $DOJANG_VERIFIED_WALLET 0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678 --rpc-url $GIWA_SEPOLIA_RPC_URL
```

DojangAnyOf 세 줄(공식 도장 지갑, 목 인증 지갑, 아무 지갑):

```bash
cast call $(jq -r .dojangAnyOf deployments/giwa-sepolia-v3_2.json) "isVerified(address)(bool)" $DOJANG_VERIFIED_WALLET --rpc-url $GIWA_SEPOLIA_RPC_URL
```

```bash
cast call $(jq -r .dojangAnyOf deployments/giwa-sepolia-v3_2.json) "isVerified(address)(bool)" <MockDojang 으로 인증한 테스트 지갑> --rpc-url $GIWA_SEPOLIA_RPC_URL
```

```bash
cast call $(jq -r .dojangAnyOf deployments/giwa-sepolia-v3_2.json) "isVerified(address)(bool)" 0x000000000000000000000000000000000000dEaD --rpc-url $GIWA_SEPOLIA_RPC_URL
```

기대: true, true, false.

포크 테스트로 같은 내용을 확인할 수도 있다(위에서 찾은 지갑 사용):

```bash
forge test --match-contract DojangForkTest -vv
```

## 7. 팩토리 자식 verify (첫 커브를 연 뒤)

```bash
node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL --deployment deployments/giwa-sepolia-v3_2.json --from-block $(jq -r .deployBlock deployments/giwa-sepolia-v3_2.json) --curve-factory $(jq -r .curveFactory deployments/giwa-sepolia-v3_2.json)
```

이벤트는 9,000블록 단위로 나눠 읽는다. 이벤트가 0건이면 스크립트는 일부러 실패한다.

## 8. 마무리

- 태그 `v3.2-curve`는 배포 확인 뒤 오너가 단다.
- 웹을 v3.2 CurveFactory로 바꾸는 것은 별도 티켓이다(주소 codegen, 발행 화면의 Dev 첫 매수 상한 안내, 공식 도장 배지).
- v3.1 CurveFactory와 그 커브는 체인에 그대로 남는다. 웹 전환 전까지 프로덕션은 v3.1을 본다.
