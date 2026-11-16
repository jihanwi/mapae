# MAPAE 오프체인 배정 스크립트

정가 공모의 배정(균등 + 미충족 신청량 가중 추첨)을 **결정론적으로** 계산하고,
`Offering.settle()`에 커밋할 머클루트와 참여자별 claim proof를 생성한다.

같은 입력 + 같은 시드 → 항상 같은 출력. 시드는 `Settled` 이벤트에 공개되므로
**누구나 재계산으로 플랫폼의 배정을 검증할 수 있다** (아래 절차).

## 사용법

```sh
npm install

# 1) 응모 스냅샷: Committed/Cancelled 이벤트를 --from-block 부터 최신 블록까지 다시 읽고
#    지갑마다 committed(address) 와 대조한다. --from-block 은 필수다(공모의 개설 블록,
#    또는 deployments/*.json 의 팩토리 deployBlock).
node snapshot.js --rpc https://sepolia-rpc.giwa.io --offering <offering> --from-block <block> --out snapshot.json

# 2) snapshot.json + 시드 → allocations.json (루트·배정·proof)
node allocate.js --snapshot snapshot.json --seed 0x<bytes32> --out allocations.json

# 스냅샷/회귀 테스트
npm test
```

GIWA RPC 는 `eth_getLogs` 범위가 10,000블록을 넘으면 거부한다(`block range greater than 10000 max`).
`snapshot.js` 는 9,000블록 단위로 나눠 읽는다(`ranges.js`). `--from-block` 이 없으면 사용법을 출력하고
멈춘다. 최근 구간만 읽으면 그보다 앞선 응모가 빠지기 때문이다.

`snapshot.json` 형식:

```json
{
  "price": "10000000000000000000000",
  "raiseTarget": "1000000000000000000000000",
  "participants": [
    {"address": "0x...", "committed": "300000000000000000000000"}
  ]
}
```

## 커밋 스냅샷 얻기 (이벤트 리플레이)

마감 시점 최종 커밋은 온체인 이벤트로 재구성한다. `snapshot.js` 가 이 일을 한다(위 사용법).
직접 확인하려면 예 (cast, 한 번에 10,000블록 이하로 나눠서):

```sh
# Committed(participant, amount, cumulative) — cumulative의 마지막 값이 최종 커밋
cast logs --rpc-url $GIWA_SEPOLIA_RPC_URL \
  --from-block <deploy-block> --to-block <deadline-block> \
  --address <offering> "Committed(address,uint256,uint256)"
# Cancelled 이벤트도 동일하게 리플레이하거나, 간단히는 주소별로
cast call <offering> "committed(address)(uint256)" <participant> --rpc-url $GIWA_SEPOLIA_RPC_URL
```

## 알고리즘 (결정론적)

1. `requested_i = floor(committed_i × 1e18 / P)` — 커밋이 감당하는 토큰 수량
2. `Σ requested ≤ qSale`이면 전원 전량 배정
3. 초과 시:
   - 균등: `equal = floor(qSale / n)`, `base_i = min(requested_i, equal)`
   - 추첨: 잔여분 `qSale − Σ base`를 미충족 신청량(deficit) 가중으로 배분.
     라운드 k마다 `r = keccak256(seed ‖ k) mod Σ deficit`로 승자를 뽑고
     (주소 오름차순 누적 워크), 승자에게 `min(deficit, 잔여)`를 전량 지급
4. `cost_i = floor(allocation_i × P / 1e18)`, `refund_i = committed_i − cost_i`
   — **나눗셈 잔여(dust)는 전부 팬에게 환불** (D1)

머클 리프는 `keccak256(bytes.concat(keccak256(abi.encode(address, allocation, refund))))`
(OZ StandardMerkleTree 이중 해시)로 `Offering.claim()`과 정확히 일치한다.

## 제3자 검증 절차

1. `Settled` 이벤트에서 `allocationRoot`, `totalSold`, `totalRaised`, `seed`를 읽는다
2. 이벤트 리플레이로 마감 시점 커밋 스냅샷을 재구성한다
3. `node allocate.js --snapshot <재구성> --seed <이벤트의 seed>` 실행
4. 출력 루트·totalSold·totalRaised가 온체인 값과 일치하는지 비교 — 일치하지 않으면
   플랫폼이 배정을 조작한 것이다 (조작해도 자금 초과 인출은 온체인 상한으로 불가능,
   `docs/TRUST.md` 참조)

## 픽스처

`genfixtures.js`가 Foundry E2E 테스트용 픽스처(`test/fixtures/*.json`)를 생성한다.
Solidity 테스트와 이 스크립트가 같은 루트를 봐야 E2E가 통과한다 — 알고리즘·인코딩이
바뀌면 `test.js`의 고정 루트 값과 픽스처를 함께 재생성할 것.
