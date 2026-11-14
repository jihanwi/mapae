# v3.1 배포 절차 (GIWA Sepolia)

오너가 Mac의 리포 루트에서 순서대로 실행한다. 배포 키는 foundry keystore 계정 `deployer`만 쓴다
(개인키를 명령이나 파일에 적지 않는다). 트레저리는 배포자와 다른 주소여야 한다.

## 0. 준비

```bash
git checkout main && git pull --ff-only
```

```bash
forge build && forge test
```

## 1. 환경변수

```bash
export GIWA_SEPOLIA_RPC_URL=https://sepolia-rpc.giwa.io
export BLOCKSCOUT_API_URL=https://sepolia-explorer.giwa.io/api/
export REUSE_MOCK_KRW=0x74eC9141afAd51F346BA5B841Ba93D573e8786fD
export REUSE_MOCK_DOJANG=0xaf80C431813EC4d2Cb34B3EC5b064095256871f8
export TREASURY_ADDRESS=0x3ada0Cb1fbb700AC4B41f5D7A9dbE2BC47b9FAaa
```

`TREASURY_ADDRESS`는 v3와 같은 트레저리다. 다른 주소를 쓰려면 바꾼다. `REUSE_*`를 비우면 mock을 새로 배포한다.

## 2. 리허설 (broadcast 없음)

```bash
forge script script/DeployV3.s.sol --rpc-url $GIWA_SEPOLIA_RPC_URL --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C
```

로그에서 `MockKRW ... (reused)`, `MockDojang ... (reused)`와 나머지 주소를 확인한다. 리허설도
`deployments/giwa-sepolia-v3_1.json`을 시뮬레이션 주소로 쓰므로, 확인 뒤 지운다.

```bash
rm deployments/giwa-sepolia-v3_1.json
```

## 3. 배포

```bash
forge script script/DeployV3.s.sol --account deployer --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow
```

## 4. 직접 배포한 컨트랙트 verify

```bash
forge script script/DeployV3.s.sol --account deployer --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C --rpc-url $GIWA_SEPOLIA_RPC_URL --resume --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
```

재사용한 MockKRW, MockDojang은 v3 때 이미 verify돼 있다.

## 5. 결과 json 확인

```bash
cat deployments/giwa-sepolia-v3_1.json
```

`version` "v3.1", `reusedMockKRW` true, `reusedMockDojang` true, `mockKRW`와 `mockDojang`이 위 재사용 주소,
`priorityWindow` 600, `deployBlock`, `curveFactoryMock`, `factoryMock`, `membershipTokenDeployer`가 있어야 한다.

## 6. 팩토리 자식 verify (커브나 공모가 생긴 뒤)

자식 컨트랙트(CurveSale, 토큰, 풀, 공모 스택)는 개설된 뒤에야 생긴다. 첫 커브를 연 뒤 실행한다. 이벤트가 0건이면 이
스크립트는 일부러 실패한다.

```bash
node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL --deployment deployments/giwa-sepolia-v3_1.json --from-block $(jq -r .deployBlock deployments/giwa-sepolia-v3_1.json) --curve-factory $(jq -r .curveFactoryMock deployments/giwa-sepolia-v3_1.json)
```

공모(MapaeFactory) 쪽은 공모가 생긴 뒤 `--factory $(jq -r .factoryMock deployments/giwa-sepolia-v3_1.json)`를 더한다.

## 7. 기록

`deployments/giwa-sepolia-v3_1.json`을 커밋하고, `docs/DEPLOYMENTS.md`의 v3.1 표에 주소와 배포 블록을 채운다.
웹은 다음 티켓에서 `npm run codegen`으로 v3.1 주소와 ABI를 반영한다.
