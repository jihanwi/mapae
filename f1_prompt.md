# [Claude Code 프롬프트] MAPAE 프론트엔드 — F1: 팬 플로우 MVP

새 워크스트림이다. 목표: **심사위원이 자기 지갑으로 직접 체험하는 팬 플로우 웹앱** — 7/29까지 배포 가능 품질이면 제출물에 링크 추가, 아니면 제외 (옵션 플레이 — 품질 우선, 완성도 낮으면 빼는 게 낫다). `docs/SPEC.md` §2(세 개의 시장)·§5(카피 가드레일) 선독.

## 선행: MockDojang 프리즈 예외 (컨트랙트 — 이것만 허용)

- `MockDojang`에 `selfVerify()` 추가: 누구나 자기 주소를 verified로 등록 (테스트넷 데모 전용, NatSpec에 명시). 심사위원이 지갑 연결 → "실명 인증 (데모)" 원클릭 체험의 핵심
- 테스트 추가. **Offering 등 코어 모듈은 계속 프리즈** (EIP-170 마진). 이 변경은 최종 재배포(M5 Part B)에 자연 포함됨 — 재배포 전에 이 변경을 먼저 커밋할 것

## 구조·스택

- 위치: 리포 내 `web/` (제출 = 단일 리포. `web/node_modules` .gitignore)
- 스택: **Vite + React + TypeScript + wagmi v2 + viem + TanStack Query + Tailwind**. Next.js 불필요 (정적 SPA)
- 체인: GIWA Sepolia (91342, RPC https://sepolia-rpc.giwa.io, explorer https://sepolia-explorer.giwa.io)
- 주소·ABI: `deployments/giwa-sepolia.json`을 빌드 타임 import + `out/` 아티팩트에서 ABI 추출 (스크립트로 web/src/contracts/에 생성 — 재배포 시 한 명령으로 갱신)
- 지갑: injected 커넥터(메타마스크) 기본. WalletConnect는 프로젝트 ID 필요하므로 생략
- 배포: 정적 빌드 (`vite build`) — Vercel 배포는 오너가 실행 (README에 절차)

## 디자인 시스템 (스펙 — 코드에 tailwind config로 박을 것)

**"조선 마패 메달리온" — 다크 온리**
- 컬러 토큰: `ink-950 #1A1510`(페이지 bg) · `ink-900 #221C15`(섹션) · `ink-800 #2A231A`(카드 surface) · `brass-400 #C39A3B`(액센트·CTA·게이지) · `brass-600 #8A6D2F`(보조) · `hanji-100 #F2EAD9`(본문 텍스트) · `hanji-400 #A89880`(뮤트) · 에러/성공은 채도 낮게
- 타이포: 본문 **Pretendard**(CDN), 등급 배지·한자(一馬~五馬)는 **Noto Serif KR**
- 모티프: **원형 메달리온** 하나로 통일 — 등급 배지(말 개수), 토큰 아바타, 빈 상태 일러스트. 골드는 CTA·게이지·등급에만 (전체 면적의 ~10%, 과용 금지). 장식용 액센트 바·스트라이프 금지
- 레이아웃 원칙 (스펙 §2-③ 준수): **1차 화면은 "내 회원권과 권리"** — 공모·멤버십이 메인, 스왑은 보조 탭. 실시간 캔들 없음 — 체결가 히스토리 리스트만
- **카피 가드레일 (스펙 §5 — UI 문구 전체 적용)**: "오른다·수익·투자·배당" 계열 표현 금지. 소각·희소성은 사실 기술만 ("누적 소각 N장"). 용어: "회원권"/"멤버십" (코인 지양), "공모"(세일 금지), "응모", "리딤"

## 페이지 (팬 플로우 5개)

1. **홈 = 공모 목록**: Factory `allOfferings()` → 카드 (크리에이터명·상태 배지[응모중/프리즈/정산완료/환불]·진행 게이지·마감 카운트다운). 상단에 지갑 연결 + 온보딩 스트립: ① KRWs 받기(MockKRW.faucet) ② 실명 인증 데모(MockDojang.selfVerify) — 각각 완료 상태 표시
2. **공모 상세**: 게이지(totalCommitted/R, 실시간), 파라미터 표(정가 P·1인 한도·미달 처리 모드), 카운트다운 (마감 2시간 전부터 "취소 프리즈" 배지), commit 플로우 (approve→commit, 누적/한도 표시), cancel (프리즈 전만 활성), 정산 후엔 claim 섹션 (allocations.json의 proof 로드 — `web/public/allocations/<offering>.json` 정적 서빙)
3. **마이 멤버십**: 보유 토큰별 카드 — 잔고, **등급 메달리온** (총공급 대비 % → 임계값 매핑, 一馬~五馬), 누적 소각(내 리딤 이력), explorer 링크
4. **리딤 + 후원**: 리딤 카탈로그 (RedeemableCreated 이벤트 → 카드: 소각 장수·잔여 수량·기한, redeem 버튼 — permit 경로 우선, 실패 시 approve 폴백), 후원 폼 (KRW 금액 + 메시지 → sponsorKRWs, "이 중 10%가 회원권을 시장에서 사서 소각합니다" 사실 기술), 최근 후원 피드 (Sponsored 이벤트, 메시지 표시)
5. **거래 (보조 탭)**: 스팟가 vs 공모가 P 비교 표시, 매수/매도 (quote → minOut 슬리피지 1% 기본), 누적 소각 카운터 (스왑 소각 + convertAndBurn), 체결 히스토리 리스트 (Swapped 이벤트). **캔들 차트 만들지 말 것**

## 상태·품질 기준

- 모든 트랜잭션: 진행중/성공/실패 토스트 + explorer 링크. 실패 시 커스텀 에러 디코딩해 한국어 안내 (NotVerified → "실명 인증이 필요해요", OverWalletLimit → "1인당 한도 초과" 등 — 주요 에러 전부 매핑)
- 반응형 (데스크톱 우선, 모바일 동작). 로딩 스켈레톤. 빈 상태 디자인 (메달리온 모티프)
- README에 로컬 실행·주소 갱신·배포 절차. anvil 대상 로컬 E2E 확인 (데모 지갑으로 5개 페이지 전 플로우)

## 마일스톤 (일정 — 컷 기준 포함)

- F1 (7/24~25): 스캐폴드 + 디자인 시스템 + 읽기 전용 전 페이지 (anvil 대상)
- F2 (7/26~27): 쓰기 플로우 전체 (commit/cancel/claim/redeem/sponsor/swap) + 에러 매핑
- F3 (7/28~29): 최종 재배포 주소 반영 → Vercel 배포 → 실기기 QA. **7/29 저녁 기준 미달 시 제출에서 제외** (링크만 빼면 됨 — 다운사이드 없음)
- 컷 우선순위 (시간 부족 시): 거래 탭 → 후원 피드 → claim UI 순으로 컷. 홈·공모 상세·마이 멤버십이 코어

## 완료 보고 (F1 시점)

① 파일 트리 ② 스크린샷 (5페이지 — 다크 메달리온 무드 확인용) ③ 디자인 시스템 이탈 부분 ④ F2 리스크
