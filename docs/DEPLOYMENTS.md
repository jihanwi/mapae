# GIWA Sepolia 배포 (GASOK 1기 제출)

체인: GIWA Sepolia (chain ID `91342`) · Explorer: https://sepolia-explorer.giwa.io

> **상태: 배포 대기.** 아래 표는 `forge script script/Deploy.s.sol ... --broadcast --verify` 실행 후
> `deployments/giwa-sepolia.json` 기준으로 갱신된다. (keystore 패스워드는 오너 보유 — README 배포 절차 참조)

## 컨트랙트 주소

| 컨트랙트 | 주소 | Explorer | Verify |
|---|---|---|---|
| MockKRW (KRWs) | _배포 대기_ | — | — |
| MockDojang | _배포 대기_ | — | — |
| MapaeFactory (데모, MockDojang) | _배포 대기_ | — | — |
| DojangEASAdapter | _배포 대기_ | — | — |
| MapaeFactory (실 Dojang 연동) | _배포 대기_ | — | — |
| Offering A + Token + RedeemManager | _Stage 1 후_ | — | verify-children.js |
| Offering B + Token + RedeemManager | _Stage 1 후_ | — | verify-children.js |

배포 후 각 주소는 `https://sepolia-explorer.giwa.io/address/<주소>` 형식으로 링크한다.

## 이원 구성 (심사위원용)

- **메인 데모 스택** — `MapaeFactory(MockDojang)`: 데모 시나리오 전체가 여기서 실행된다.
  검증 플래그를 우리가 통제하므로 시연이 항상 재현 가능하다.
- **GIWA-Native 쇼케이스** — `DojangEASAdapter` + `MapaeFactory(어댑터)`: 어댑터는 **실제
  GIWA Sepolia의 DojangScroll(`0xd507...17B9`, 라이브 ABI 검증 완료)과 EAS predeploy
  (`0x4200...0021`)를 조회**한다. 실 Verified Address(업비트 KYC 증명) 지갑은 코드 변경
  없이 이 팩토리에서 공모를 개설할 수 있다 — Dojang 어테스테이션이 곧 크리에이터 온보딩.

## 데모 시나리오가 증명하는 것

| | Offering A (모드 A) | Offering B (모드 B) |
|---|---|---|
| 시나리오 | **초과 응모** — 6개 지갑이 R=5백만 KRWs 대비 5.1M 응모 (부분 취소 1건 포함) | **미달** — 3개 지갑이 목표의 60%만 응모 |
| 증명 1 | 균등+가중추첨 배정: 오프체인 결정론 계산 → 머클루트 커밋 → 시드 공개 (제3자 재계산 검증 가능) | 실판매분만 발행: S' = 판매량/f 재산정 |
| 증명 2 | 지갑당 한도 L·실명 검증(Dojang)·발행자 자기응모 차단 | **UnsoldBurned** — 미판매 40% 즉시 소각 (`Transfer → 0x0`이 explorer에 영구 증빙: "더 희소하게 태어난다") |
| 증명 3 | 클레임 풀 방식 + 환불 dust 팬 귀속 | 리딤(소각형 소비) — 회원권의 실사용 경로 |

## 아키텍처

```mermaid
flowchart TB
    subgraph 온체인["GIWA Sepolia 온체인"]
        F[MapaeFactory] -->|createOffering<br/>Dojang 검증 + 밴드 검증| O[Offering]
        O -->|constructor에서 배포<br/>1회 민트 후 권한 소각| T[MembershipToken<br/>ERC-20 + Permit]
        F -->|배포·와이어링| RM[RedeemManager]
        RM -->|burnFrom 소각| T
        DA[DojangEASAdapter] -->|getVerifiedAddressAttestationUid| DS[DojangScroll<br/>0xd507...17B9]
        DA -->|getAttestation 검증| EAS[EAS predeploy<br/>0x4200...0021]
        F -.->|isVerified| DA
    end
    subgraph 오프체인["오프체인 배정 파이프라인 (결정론적·공개 검증 가능)"]
        S[snapshot.js<br/>이벤트 리플레이 + view 대조] --> AL[allocate.js<br/>균등+가중추첨, 시드 기반]
        AL -->|머클루트 + proofs| ST[settle + claim]
    end
    O -->|Committed/Cancelled 이벤트| S
    ST -->|settle root, seed| O
```

## 재현 (제3자 검증)

1. `Settled` 이벤트에서 `allocationRoot`·`totalSold`·`totalRaised`·`seed` 확인
2. `node script/allocation/snapshot.js --rpc https://sepolia-rpc.giwa.io --offering <주소> --out snap.json`
3. `node script/allocation/allocate.js --snapshot snap.json --seed <이벤트 seed>`
4. 출력 루트가 온체인 값과 일치하면 배정이 조작되지 않았음이 증명된다
   (조작되었어도 온체인 회계 상한이 초과 인출을 차단 — `docs/TRUST.md`)
