# MAPAE (마패)

GIWA 체인(업비트/두나무의 이더리움 L2) 위의 크리에이터 온체인 회원권 플랫폼 — 검증된 크리에이터가 실명 지갑으로 발행하는 고정 공급 양도가능 회원권 ERC-20. 발행은 정가 공모, 유통은 AMM, 소비(리딤)는 원화 고정가.

## 🏛 GASOK 1기 제출물 (GIWA Sepolia)

- **배포 주소·verify 상태·데모 히스토리**: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)
- **GIWA-Native**: [`DojangEASAdapter`](src/DojangEASAdapter.sol)가 실 DojangScroll + EAS predeploy를 조회 — Verified Address(업비트 KYC 증명) 지갑이 곧 크리에이터 온보딩 ([`docs/DOJANG.md`](docs/DOJANG.md))
- **데모**: Offering A(초과 응모·추첨 배정) / Offering B(미달·미판매분 소각) 2단계 시나리오 — 아래 "데모 실행 절차"
- **재현**: 배정은 결정론적 — `Settled` 이벤트의 시드로 누구나 재계산 검증 가능 ([`script/allocation/`](script/allocation/README.md))

### 데모 실행 절차 (오너 런북)

```sh
source .env
# 0) 최초 1회: 배포 + 직접 배포분 verify (keystore 패스워드 입력 필요)
forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
  --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL

# 1) Stage 1: 데모 지갑 세팅 + Offering A/B 개설 + 응모 (12h 카운트다운 시작)
forge script script/DemoStage1.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast

# 1.5) Factory 내부 생성분(Offering/Token/RedeemManager) verify
FACTORY=$(python3 -c "import json;print(json.load(open('deployments/giwa-sepolia.json'))['factoryMock'])")
node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL --factory $FACTORY

# ---- 12시간 후 (deployments/demo-state.json의 deadlineA/B 경과 확인) ----

# 2) 스냅샷 → 배정 (Offering A, B 각각)
OFF_A=$(python3 -c "import json;print(json.load(open('deployments/demo-state.json'))['offeringA'])")
OFF_B=$(python3 -c "import json;print(json.load(open('deployments/demo-state.json'))['offeringB'])")
cd script/allocation
node snapshot.js --rpc $GIWA_SEPOLIA_RPC_URL --offering $OFF_A --out ../../deployments/snapshot-a.json
node allocate.js --snapshot ../../deployments/snapshot-a.json \
  --seed $(python3 -c "import json;print(json.load(open('../../deployments/snapshot-a.json'))['suggestedSeed'])") \
  --out ../../deployments/allocations-a.json --foundry-out ../../deployments/alloc-a.json
node snapshot.js --rpc $GIWA_SEPOLIA_RPC_URL --offering $OFF_B --out ../../deployments/snapshot-b.json
node allocate.js --snapshot ../../deployments/snapshot-b.json \
  --seed $(python3 -c "import json;print(json.load(open('../../deployments/snapshot-b.json'))['suggestedSeed'])") \
  --out ../../deployments/allocations-b.json --foundry-out ../../deployments/alloc-b.json
cd ../..

# 3) Stage 2: settle → 전원 claim → 리딤(소각) → B 미판매분 소각
forge script script/DemoStage2.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast
```

스펙 단일 기준(SSOT): [`docs/SPEC.md`](docs/SPEC.md) · 신뢰 모델: [`docs/TRUST.md`](docs/TRUST.md) · Dojang 연동: [`docs/DOJANG.md`](docs/DOJANG.md) · 배정 스크립트: [`script/allocation/`](script/allocation/README.md)

## 모듈 구성

| # | 모듈 | 역할 | 범위 |
|---|---|---|---|
| 1 | MapaeFactory | 크리에이터별 토큰+공모 배포 (Dojang Verified 필수) | ✅ 제출 범위 |
| 2 | MembershipToken | 고정 공급 회원권 ERC-20 (1회 민트 후 민트 권한 소각) | ✅ 제출 범위 |
| 3 | Offering | 정가 단일 공모 (균등+추첨 배정, 머클 클레임) | ✅ 제출 범위 |
| 4 | RedeemManager | 회원권 소각형 리딤 (장수 고정 교환비) | ✅ 제출 범위 |
| 5 | Vesting | 크리에이터 배분 베스팅 (36mo linear + 6mo cliff) | 확장 |
| 6 | Sponsorship | 후원 (일부 스왑→소각, 나머지 크리에이터 이체) | 확장 |
| 7 | LP | AMM 풀 시딩 + LP 토큰 영구 락업 | 확장 |
| 8 | BuybackVault | 매출 환원분 TWAP 매수 후 전량 소각 | 확장 |

## 마일스톤

| 단계 | 내용 | 상태 |
|---|---|---|
| M0 | 리포 스캐폴드 — 인터페이스·목업·체인 설정·CI | ✅ 완료 |
| M1 | Offering + MembershipToken 구현, 배정 스크립트, invariant 테스트 | ✅ 완료 |
| M2 | Factory + RedeemManager 구현, invariant 테스트 | 예정 |
| M3 | Dojang EAS 어댑터 실 연동 | 예정 |
| M4 | GIWA Sepolia verified 배포 (제출: ~2026-07-31, GASOK 1기) | 예정 |

## 개발

[Foundry](https://getfoundry.sh/) 기반. OpenZeppelin Contracts v5 외 외부 의존성 없음. 전 모듈 논업그레이더블.

```sh
# 환경 설정
cp .env.example .env

# 빌드 / 테스트 / 포맷
forge build
forge test -vvv
forge fmt --check
```

## 배포 (GIWA Sepolia)

체인 정보: chain ID `91342` · RPC `https://sepolia-rpc.giwa.io` · Explorer [Blockscout](https://sepolia-explorer.giwa.io)

**프라이빗 키는 절대 `.env`에 저장하지 않는다.** 암호화 키스토어를 사용한다:

```sh
cast wallet import deployer --interactive
```

배포 + verify (Blockscout, API key 불필요):

```sh
source .env
forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
  --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
```
