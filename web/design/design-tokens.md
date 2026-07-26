# MAPAE 디자인 토큰 — "조선 마패 메달리온" (다크 온리)

개발 세션이 Tailwind config로 그대로 옮길 수 있도록 정리. 목업 5개(`mockup-01-home` ~ `mockup-05-trade`)가 이 규칙의 1:1 레퍼런스.

## 1. 컬러

```js
colors: {
  ink: {
    950: '#1A1510', // 페이지 배경
    900: '#221C15', // 섹션 배경 · 인풋 배경 · 통계 카드
    800: '#2A231A', // 카드 surface
    700: '#3A3126', // 보더 · 디바이더 · 게이지 트랙 · 세그먼트 활성 배경
  },
  brass: {
    400: '#C39A3B', // 액센트: CTA · 게이지 필 · 등급 · 포커스 · 링크
    500: '#D4AC4E', // CTA hover 전용
    600: '#8A6D2F', // 보조 액센트: 초과분 스트라이프 · 비활성 등급 링 · hover 보더
  },
  hanji: {
    100: '#F2EAD9', // 본문 텍스트
    400: '#A89880', // 뮤트 텍스트 · 캡션 · 라벨
  },
  success: '#7A9B6D', // 응모중 배지 · 연결 도트 · 매수 방향
  error:   '#B0604F', // 에러 · 매도 방향
  warning: '#C39A3B', // brass-400 겸용 (취소 프리즈 등)
}
```

- **brass 총량 규칙**: 화면 면적의 ~10% 이하. 한 화면에서 brass 배경(솔리드)은 primary CTA 1~2개까지. 나머지는 텍스트·보더·게이지로만.
- placeholder 텍스트: `#6B5F4E`
- 반투명 유틸: `rgba(195,154,59,.35)` 메달리온 내부 링 / `rgba(195,154,59,.08)` 경고 박스 배경 / `rgba(195,154,59,.3~.55)` 경고 보더·배지 / `rgba(122,155,109,.5)` 성공 배지 보더
- 네비 배경: `rgba(26,21,16,.94)` + `backdrop-filter: blur(8px)`

## 2. 타이포

```js
fontFamily: {
  sans:  ['"Pretendard Variable"', 'Pretendard', 'sans-serif'], // 본문 · UI 전체
  serif: ['"Noto Serif KR"', 'serif'],                          // 등급 한자 · 큰 숫자 · 로고 워드마크 전용
}
```

- CDN: Pretendard `cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/...variable...` · Noto Serif KR은 Google Fonts (400/600/700)
- 스케일: 페이지 타이틀 28~34/700 · 섹션 타이틀 21/700 · 카드 타이틀 17/700 · 본문 14~16/400 · 라벨·메타 13 · 캡션 12 · 배지 12
- 큰 숫자(잔고·배정 결과): serif 40~44/600, 단위(장/KRWs)는 19~20 hanji-400
- 숫자 전반에 `font-variant-numeric: tabular-nums`
- 로고 워드마크: serif 17/700, `letter-spacing: 0.16em`

## 3. 간격 · 라운딩 · 레이아웃

- 컨테이너: `max-width: 1240px`, 좌우 패딩 32px (모바일 그대로 유지 가능, 16~20px 축소 허용)
- 페이지 상단 패딩 40~64px, 하단 80px. 섹션 간격 48~72px (큰 전환부는 `border-top: 1px ink-700` + 40px 패딩)
- 카드 패딩: 24px (그리드 카드) / 28px (패널) / 32px (히어로 카드)
- 라운딩: 카드·패널 16px · 인풋·버튼·안내박스 10px · 통계 카드 12px · 배지·칩 999px(필) · 게이지 4~5px
- 그리드: `repeat(auto-fit, minmax(300~320px, 1fr))` + `gap: 20px` — 375에서 자동 1열. 2컬럼 상세는 `flex-wrap` + `min-width: 340px`
- 네비 높이 64px, sticky

## 4. 컴포넌트 규칙

### 버튼 3종
- **Primary**: bg brass-400, 텍스트 ink-950/700, radius 10, 패딩 15px(풀폭)·12×20(인라인), hover bg `#D4AC4E`
- **Secondary**: 투명 bg, 보더 1px ink-700, 텍스트 hanji-100(또는 hanji-400), hover 보더 brass-600 + 텍스트 hanji-100
- **Disabled**: Secondary에 `opacity: .4; cursor: not-allowed` — 색상 변경 없이 투명도만

### 카드
bg ink-800 · 보더 1px ink-700 · radius 16 · 패딩 24~28. 클릭 카드는 hover 시 보더 brass-600. 내부 구획은 배경 ink-900(radius 10~12) 또는 `border-top: 1px ink-700`.

### 배지 (필, 12px, 패딩 4×10)
- 응모중: 보더 `rgba(122,155,109,.5)` + 텍스트 success + 5px 도트
- 취소 프리즈: 보더 `rgba(195,154,59,.55)` + 텍스트 brass-400 + 도트
- 정산 완료/뉴트럴: 보더 ink-700 + 텍스트 hanji-400
- 부분 발행 모드: 보더 brass-600 + 텍스트 brass-400 (도트 없음)

### 게이지
트랙 ink-700, 높이 8px(카드)·10px(상세 패널), radius 절반. 필 brass-400.
**100% 초과**: 목표 지점에 2px hanji-100(80%) 세로 마커, 마커 오른쪽 초과분은 `repeating-linear-gradient(135deg, #8A6D2F 0 3px, #2A231A 3px 6px)` 스트라이프. 라벨에 "102% · 초과 응모" (brass-400).

### 메달리온 (유일 모티프 — 액센트 바·스트라이프 장식 금지)
이중 원 구조: 외곽 원(보더 1.5~2px brass-400, bg ink-900) + 내부 원(보더 1px `rgba(195,154,59,.35)`, 4~11px 여백) + 중앙 serif 글자.
- 아바타: 52px(카드) / 104px(상세) / 132px(멤버십 대형) — 중앙에 이름 첫 글자
- 등급 배지: 중앙에 一馬~五馬 한자. 현재 등급만 brass-400, 나머지 brass-600
- 리딤 비용: 56px, 중앙 "N + 장 소각"
- 빈 상태: `border: 2px dashed ink-700`, 중앙 馬, 전부 ink-700 톤
- 대형 메달리온에만 `box-shadow: 0 0 40px rgba(195,154,59,.12)` 허용

### 입력
bg ink-900 · 보더 1px ink-700 · radius 10 · 패딩 14×16 · 단위(KRWs/장)는 우측 hanji-400 13px. focus 보더 brass-400. textarea 동일.

### 토스트 (목업 미포함 — 규칙만)
bg ink-800 · 보더 1px ink-700 · radius 12 · 좌측에 상태색 도트(액센트 바 아님) · 텍스트 hanji-100 14px · 하단 중앙 고정.

## 5. 카피 가드레일 (UI 문자열 전면 적용)

- 금지: 오른다 · 수익 · 수익률 · 투자 · 배당 · 코인 · 세일 · IDO
- 사용: 회원권/멤버십 · 공모/응모 · 리딤 · 소각
- 소각·희소성은 사실 기술만: "지금까지 24.51장 소각" (○) / 가치 상승 암시 (×)
- 가격 병렬 표기: 현재가 vs 공모가 — 동일 톤, 등락 색·화살표 금지
