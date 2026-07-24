# [PM 리뷰 + Claude Code 프롬프트] MAPAE 웹 — 목업 승인 & F2 구현

## Part 1 — 목업 PM 리뷰 결과 (2026-07-23)

**판정: 승인.** 디자인 시스템(ink/brass/hanji·메달리온·다크 온리) 정확 구현, 캔들 없음, "수익" 계열 카피 없음, 등급 사다리(一馬~五馬)와 온보딩 스트립 우수. 아래 수정만 구현 단계에서 반영한다 — **디자인 재작업 불필요, 목업 1:1 구현 + 수정 목록 적용.**

### 카피·정합 수정 목록 (구현 시 적용)

**C1. [정합 오류] 공모 상세 — "공모 수량 500장 (고정 공급)"**: 공모 수량(Q_sale=500)과 총공급(S=833.33)은 다른 값 — "(고정 공급)" 라벨이 오해 유발. → `공모 수량 500장` / 그 아래 줄 `총공급 833.33장 — 개설 시점 확정, 추가 발행 불가`로 분리

**C2. [데이터 정합] 내 멤버십 — 등급 수치 모순**: 샘플이 "83.33장 = 총공급의 2.1% = 二馬, 다음 등급 五馬까지 65.6장"인데 ① 83.33/833.33 = 10%라 2.1%와 모순 ② 二馬 다음은 三馬지 五馬가 아님. **구현은 반드시 실계산**: 등급 = balance/totalSupply()를 임계값 매핑, "다음 등급까지"는 바로 다음 티어 기준. (목업 숫자를 하드코딩하지 말 것)

**C3. [카피] "취소 프리즈" → 팬 언어로**: 내부 용어 노출. 상태 배지 `취소 잠김`, 비활성 버튼 캡션 `마감 2시간 전부터는 취소할 수 없어요` (신규 응모·증액 가능 안내 유지)

**C4. [카피 통일] explorer 표기**: "explorer에서 보기" / "온체인에서 확인" 혼재 → 전부 **"온체인에서 확인 ↗"**로 통일

**C5. [카피] 거래 탭 "LP 토큰은 0xdEaD 주소로 소각되어"** → `유동성은 영구 잠금 — LP 지분 전량이 0xdEaD 주소에 있어 누구도 회수할 수 없습니다` (소각이 아니라 영구 보관이 정확)

**C6. [톤] 거래 히스토리 매도 색상**: 매도가 적색 계열 — 등락·매매 강조색 지양 원칙에 걸침. 방향 라벨은 뮤트(hanji-400) 통일, 방향은 텍스트로만 구분

**C7. [한국어 다듬기]**: "리딤하러 가기" → `리딤하기` / "응원 메시지를 남겨 주세요 (온체인에 기록됩니다)" 유지 ✓ / 전반적으로 조사·어미 재점검 — 구현 시 모든 사용자 노출 문구를 한 파일(`web/src/copy.ts`)로 모아 관리 (오너가 한 파일만 검수하면 되게)

## Part 2 — [Claude Code 프롬프트] F2: 목업 기반 구현

`docs/SPEC.md` §2·§5 선독. 디자인 목업은 리포의 `Six deliverables completed — awaiting review/` 폴더 (mockup-01~05 HTML + design-tokens.md). **목업을 1:1로 구현하되 위 C1~C7 수정을 적용한다.**

### 구조

1. 목업 폴더를 `web/design/`으로 이동 (이름 정리), 리포에 커밋
2. `web/` 스캐폴드: Vite + React + TS + wagmi v2 + viem + TanStack Query + Tailwind. design-tokens.md의 토큰을 tailwind config로 이식
3. 체인: GIWA Sepolia 91342. 주소는 `deployments/giwa-sepolia.json` 빌드 타임 import (최신 재배포 주소 — MockKRW 0x44FA…5d04, MockDojang 0x850E…87aB, MapaeFactory 0xb5b8…75A7 등), ABI는 out/ 아티팩트에서 생성 스크립트로 `web/src/contracts/`에
4. 모든 사용자 노출 문구는 `web/src/copy.ts` 단일 파일 (C7)

### 페이지 (목업 대응, 실데이터 연결)

- **공모 목록**: Factory `allOfferings()` → 카드. 온보딩 스트립: MockKRW.faucet + **MockDojang.selfVerify** (완료 상태 반영)
- **공모 상세**: 실시간 게이지·카운트다운·상태 3변형(응모중/취소 잠김/정산 완료 — 목업 B·C 섹션 그대로), commit(approve→commit)/cancel, claim(배정·proof는 `web/public/allocations/<offering주소>.json` 로드 — Stage 2 후 배정 파이프라인 출력 복사)
- **내 멤버십**: 실계산 등급(C2), 등급 사다리, 빈 상태
- **리딤 & 후원**: RedeemableCreated 이벤트 → 카탈로그 (Stage 2에서 생성된 리딤 사용), redeem(permit 우선·approve 폴백), sponsorKRWs + Sponsored 이벤트 피드
- **거래**: 스팟가/공모가/누적소각/유통공급 스탯, 매수·매도(quote→minOut 1%), Swapped 이벤트 히스토리 리스트, 하단 LP 잠금 신뢰 스트립(C5 문구 + dEaD 잔고 온체인 링크)

### 품질 기준

- 트랜잭션 토스트(진행/성공/실패 + explorer 링크), 커스텀 에러 → 한국어 매핑 (NotVerified "실명 인증이 필요해요", OverWalletLimit "1인당 한도 초과", CommitFrozen "마감 2시간 전부터는 취소할 수 없어요", BelowMinCommit "최소 응모 금액 미만", RedeemClosed·MaxClaimsReached 등 주요 에러 전부)
- 지갑 미연결·잘못된 체인 상태 처리 (체인 추가/전환 버튼), 로딩 스켈레톤, 반응형(모바일 375 동작)
- 금지: 캔들 차트, "수익·오른다·투자" 계열 문구, 라이트 모드

### 완료 기준·보고

1. anvil 풀 파이프라인 대비 로컬 E2E (faucet→selfVerify→응모→취소→[워프 후]claim→리딤→후원→스왑 전 플로우 수동 확인)
2. GIWA Sepolia 실주소로 빌드 → 5페이지 스크린샷 첨부 보고
3. `vite build` 성공 + README에 로컬 실행·주소 갱신·Vercel 배포 절차
4. 커밋: `F2: web app — fan flow MVP from design mockups`
5. 보고: ① 스크린샷 ② C1~C7 반영 내역 ③ 목업과 달리 구현한 부분 ④ 배포(F3) 전 남은 것

**주의**: 컨트랙트 코드 프리즈 유효 — `web/` 밖은 건드리지 않는다 (deployments/allocations 산출물 복사 제외). Stage 2·3가 아직 안 돌았으면 정산 전 상태로 개발하고, 완료 후 claim·리딤·거래 페이지를 실데이터로 재검증.
