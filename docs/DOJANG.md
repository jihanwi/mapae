# Dojang 실 연동 가이드 (M3 예정)

Dojang은 GIWA의 어테스테이션 서비스로, **Verified Address**(업비트 KYC 증명)를
EAS(Ethereum Attestation Service) 어테스테이션으로 발급한다.

> **현재 상태 (M0):** 온체인 검증은 `MockDojang`(owner가 `setVerified`로 설정)으로 대체한다.
> 실 연동은 **M3에서 EAS 어댑터 컨트랙트**(`IDojang`을 구현하고 내부적으로 EAS/DojangScroll을
> 조회)로 붙인다. **M3 전까지 어댑터 코드를 작성하지 않는다.**

## GIWA Sepolia 실 주소

| 컨트랙트 | 주소 |
|---|---|
| EAS | `0x4200000000000000000000000000000000000021` |
| SchemaRegistry | `0x4200000000000000000000000000000000000020` |
| DojangScroll (간편 조회) | `0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9` |
| AttestationIndexer | `0x9C9Bf29880448aB39795a11b669e22A0f1d790ec` |

- **Verified Address Schema UID:** `0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08`
- 스키마 데이터: `bool isVerified`

이 값들은 `src/Constants.sol`의 `GiwaSepolia` 라이브러리에 상수로 정리되어 있다.

## 조회 방식 (M3 어댑터가 구현할 내용)

두 가지 경로가 있으며, 어댑터는 둘 중 하나(또는 병행)를 사용한다:

### 1. DojangScroll 간편 조회

DojangScroll은 Verified Address 여부를 단일 호출로 반환하는 편의 컨트랙트다.
어댑터는 DojangScroll을 호출해 `msg.sender`의 검증 여부를 확인한다.

### 2. EAS `getAttestation` 직접 조회

1. AttestationIndexer에서 (recipient, schema UID)로 어테스테이션 UID를 조회
2. EAS의 `getAttestation(bytes32 uid)`로 어테스테이션 본문을 가져옴
3. 다음을 모두 검증:
   - `schema == VERIFIED_ADDRESS_SCHEMA_UID`
   - `recipient == 조회 대상 주소`
   - `revocationTime == 0` (미철회)
   - `expirationTime == 0 || expirationTime > block.timestamp` (미만료)
   - `data`를 `bool isVerified`로 디코드하여 `true`

## 설계 원칙 (SPEC.md와 동일)

- **Fail-closed:** 조회 실패·리버트·디코드 실패는 전부 "미검증"으로 처리한다.
- **Commit 시점 스냅샷:** Dojang 검증은 `commit()` 시점에만 확인하며,
  이후 KYC 만료·철회는 기배정 물량에 소급 적용하지 않는다.
- 어댑터는 `IDojang` 인터페이스(`isVerified(address) → bool`)를 구현하므로,
  MockDojang → 실 어댑터 교체는 배포 파라미터 변경만으로 이루어진다.
