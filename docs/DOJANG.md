# Dojang 실 연동 (M3 완료)

Dojang은 GIWA의 어테스테이션 서비스로, **Verified Address**(업비트 KYC 증명)를
EAS(Ethereum Attestation Service) 어테스테이션으로 발급한다.

> **현재 상태 (M3):** `src/DojangEASAdapter.sol`이 실 Dojang 스택을 조회하는
> `IDojang` 구현체로 완성되었다. 배포는 이원 구성 — 데모 팩토리는 MockDojang,
> 쇼케이스 팩토리는 이 어댑터를 사용한다 (`docs/DEPLOYMENTS.md`).

## GIWA Sepolia 실 주소 (라이브 검증 완료)

| 컨트랙트 | 주소 | 비고 |
|---|---|---|
| EAS | `0x4200000000000000000000000000000000000021` | predeploy |
| SchemaRegistry | `0x4200000000000000000000000000000000000020` | predeploy |
| DojangScroll (간편 조회) | `0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9` | ERC-1967 프록시, impl v0.5.1 |
| AttestationIndexer | `0x9C9Bf29880448aB39795a11b669e22A0f1d790ec` | ERC-1967 프록시 |

- **Verified Address Schema UID:** `0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08`
- 스키마 데이터: `bool isVerified`
- 상수: `src/Constants.sol`의 `GiwaSepolia` 라이브러리

## 실 ABI (M3에서 Blockscout로 확인 — 초기 가정과 다름에 주의)

```solidity
// DojangScroll (우리가 사용하는 표면)
function isVerified(address account, bytes32 schemaUid) external view returns (bool);
function getVerifiedAddressAttestationUid(address account, bytes32 schemaUid) external view returns (bytes32);
// ⚠ 어테스테이션 부재 시 bytes32(0)이 아니라 custom error로 REVERT한다 (라이브 확인)

// AttestationIndexer — attester 주소를 요구하므로 어댑터는 Scroll 경유를 택했다
function getAttestationUid(bytes32 schemaUid, address recipient, address attester) external view returns (bytes32);
```

라이브 확인 결과 (2026-07-22):
- `DojangScroll.isVerified(0xdEaD, schemaUid)` → `false` 정상 반환
- `DojangScroll.getVerifiedAddressAttestationUid(0xdEaD, schemaUid)` → custom error revert (`0x6e7910da`)
- `version()` → `"0.5.1"`

## 어댑터 판정 로직 (`DojangEASAdapter.isVerified`)

1. `DojangScroll.getVerifiedAddressAttestationUid(account, schemaUid)` → UID (try/catch — 부재 시 revert가 정상 경로)
2. `EAS.getAttestation(uid)` → 어테스테이션 본문 (try/catch)
3. 전부 검증: 스키마 일치 · recipient 일치 · `revocationTime == 0` ·
   `expirationTime == 0 || > now` · data 첫 워드 == 1 (`bool isVerified`, 수동 디코드)

## Liveness 방어 (설계 원칙)

- **모든 외부 호출은 try/catch, 모든 실패 경로는 `false`.** fail-closed는 유지된다
  (false = 거부)  — 그러나 Dojang 스택 장애·업그레이드로 인한 revert가
  `Offering.commit()`을 영구 마비시키는 경로는 차단된다. 전 모듈 논업그레이더블이므로
  이 방어가 유일한 안전망이다.
- data 디코드도 `abi.decode` 대신 수동 워드 검사(엄격히 `== 1`) — 오염 데이터는 미검증 처리.
- Dojang 스택(Scroll/Indexer)은 **UUPS 프록시로 업그레이드 가능**하다: ABI가 바뀌면
  어댑터는 조용히 전원 거부 상태가 된다 (안전하지만 서비스 중단). 운영 시 모니터링 필요.

## 검증 스냅샷 정책 (SPEC과 동일)

- Dojang 검증은 `commit()` 시점 스냅샷 — 이후 KYC 만료·철회는 기배정에 소급하지 않는다.
- MockDojang → DojangEASAdapter 교체는 Factory constructor 파라미터 하나로 끝난다
  (`IDojang` 주입 설계).
