# MAPAE 오프체인 배정 스크립트

정가 공모의 배정(균등 + 미충족 신청량 가중 추첨)을 **결정론적으로** 계산하고,
`Offering.settle()`에 커밋할 머클루트와 참여자별 claim proof를 생성한다.

같은 입력 + 같은 시드 → 항상 같은 출력. 시드는 `Settled` 이벤트에 공개되므로
**누구나 재계산으로 플랫폼의 배정을 검증할 수 있다** (아래 절차).

## 사용법

```sh
npm install

# snapshot.json + 시드 → allocations.json (루트·배정·proof)
node allocate.js --snapshot snapshot.json --seed 0x<bytes32> --out allocations.json

# 스냅샷/회귀 테스트
npm test
```

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

마감 시점 최종 커밋은 온체인 이벤트로 재구성한다. 예 (cast):

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
