// 모든 사용자 노출 문구 단일 파일 (C7) — 오너는 이 파일만 검수하면 된다.
// 금지: "수익 · 오른다 · 투자" 계열 표현.
export const copy = {
    appTitle: "MAPAE",
    heroTitle: "사고팔 수 있는 팬 멤버십",
    heroSub: "발행은 공모주처럼 · 유통은 시장처럼 · 소비는 정가처럼",
    nav: {
        home: "공모", membership: "내 멤버십", redeem: "리딤 & 후원", trade: "거래",
        faucet: "KRWs 받기", // 상시 재충전 버튼 (데스크톱)
        faucetShort: "+ KRWs", // 모바일 축약
        faucetTitle: "테스트 KRWs 받기 (100만 KRWs)",
        faucetTxLabel: "테스트 KRWs 받기", // 토스트 라벨
    },
    network: "GIWA Sepolia 테스트넷",
    connect: "지갑 연결",
    wrongChain: "GIWA Sepolia로 전환",
    addChain: "GIWA Sepolia 추가",
    onboarding: {
        title: "데모 시작하기",
        faucet: "① 테스트 KRWs 받기",
        verify: "② 실명 인증 (데모)",
        faucetAmount: 1_000_000n * 10n ** 18n,
        needGas: "가스비로 쓸 GIWA Sepolia ETH가 없어요 — 먼저 테스트 ETH를 받아 주세요",
        gasFaucet: "테스트 ETH 받기 ↗",
        gasFaucetUrl: "https://docs.giwa.io/get-started/faucets",
    },
    home: {
        section: "진행 중인 공모",
        loading: "온체인에서 불러오는 중…",
        netError: "네트워크 응답이 없어요 — 잠시 후 다시 시도해 주세요",
        retry: "다시 시도",
        verifiedCreator: "실명 인증 크리에이터",
        over: "초과 응모",
        price: "정가",
        perUnit: "/장",
        participants: (n: number) => `참여 ${n}명`,
        offerPrice: "공모가",
        spotPrice: "현재가",
        burned: (n: string) => `지금까지 ${n}장 소각됨`,
        goTrade: "거래하기 →",
        footnote: "초과 응모 시 전원에게 최소 수량을 먼저 배정하고, 나머지는 추첨으로 보충합니다 · 배정 계산은 누구나 재검증할 수 있습니다",
    },
    badge: {
        open: "응모중",
        frozen: "취소 잠김", // C3
        ended: "마감 · 정산 대기", // P0: 마감 후 정산 전
        settled: "정산 완료 · 거래중",
        refunding: "환불 진행중",
        partialMode: "부분 발행 모드",
    },
    offering: {
        saleQty: "공모 수량", // C1: 총공급과 분리 표기
        totalSupplyLine: (s: string) => `총공급 ${s}장 — 개설 시점 확정, 추가 발행 불가`,
        target: "모금 목표",
        committedTotal: "현재 모금액",
        myCommit: "내 응모액",
        commitCta: "응모하기",
        commitMore: "증액하기",
        cancelCta: "응모 취소",
        cancelFrozenNote: "마감 2시간 전부터는 취소할 수 없어요", // C3
        commitStillOpenNote: "신규 응모와 증액은 마감까지 가능해요",
        approveThen: "먼저 KRWs 사용 승인이 필요해요",
        claimCta: "배정 받기",
        claimed: "배정 수령 완료",
        myAllocation: "내 배정",
        myRefund: "환불",
        notInAllocation: "이 지갑으로 응모한 내역이 없어요",
        allocNote: "초과 응모 시 전원 최소 배정 + 추첨 보충 · 배정은 누구나 재검증 가능",
        deadline: "마감",
        minCommit: "최소 응모",
        walletLimit: "1인당 한도",
        amountPlaceholder: "응모할 KRWs 수량",
        endedTitle: "응모 마감 · 정산 대기", // P0 2-b
        endedNote: "이 공모는 응모가 마감됐어요. 정산이 완료되면 배정 결과가 여기에 표시돼요.",
        notFoundTitle: "공모를 찾을 수 없어요", // P1 6-a
        notFoundNote: "주소가 올바르지 않거나 존재하지 않는 공모예요",
        backToList: "공모 목록으로",
        connectForAllocation: "지갑을 연결하면 배정 결과를 확인할 수 있어요", // 9-d
    },
    membership: {
        title: "내 멤버십",
        empty: "아직 보유한 멤버십이 없어요",
        emptyCta: "진행 중인 공모 보러 가기",
        holding: "보유",
        share: (p: string) => `총공급의 ${p}%`,
        nextTier: (t: string, n: string) => `${t}까지 ${n}장 더 필요해요`,
        maxTier: "최고 등급이에요",
        ladder: "등급 사다리",
        unit: "장",
    },
    redeem: {
        title: "리딤 & 후원",
        catalog: "리딤 카탈로그",
        cost: (n: string) => `${n}장 소각`,
        claims: (used: string, max: string) => `${used} / ${max} 사용됨`,
        unlimited: "무제한",
        redeemCta: "리딤하기", // C7
        closed: "기한 마감",
        soldOut: "소진됨",
        sponsorTitle: "후원하기",
        sponsorNote: (pct: string) =>
            `후원액의 ${pct}%로 시장에서 멤버십을 매수해 소각하고, 나머지는 크리에이터에게 전달돼요`,
        msgPlaceholder: "응원 메시지를 남겨 주세요 (온체인에 기록됩니다)",
        sponsorCta: "후원 보내기",
        feed: "후원 피드",
        feedBurned: (n: string) => `${n}장 소각`,
        names: {} as Record<string, string>, // 1-6: 리딤 id → 표시명, 미등록은 "리딤 #N" 폴백
    },
    trade: {
        title: "거래",
        spot: "현재가",
        offer: "공모가",
        burnedTotal: "누적 소각",
        circulating: "유통 공급",
        buy: "매수",
        sell: "매도",
        buyLabel: "KRWs → 멤버십",
        sellLabel: "멤버십 → KRWs",
        quote: "예상 수령",
        priceImpact: "가격 영향", // 1-3a
        shallowPool: "테스트넷 얕은 풀이라 소액 체결에도 가격이 크게 움직여요", // 1-3b
        buyPlaceholder: "10,000", // 1-2: 매수 소액 예시
        feeNote: "수수료 2% = 크리에이터 1% + 소각 0.5% + 유동성 0.5%",
        history: "거래 히스토리",
        lpTrust: "유동성은 영구 잠금 — LP 지분 전량이 0xdEaD 주소에 있어 누구도 회수할 수 없습니다", // C5
        swapCta: "스왑",
        amountIn: "수량",
        myStrip: (n: string, m: string) => `보유 ${n}장 · KRWs 잔고 ${m}`,
        maxBtn: "최대",
        afterSwap: (n: string) => `스왑 후 약 ${n}장`,
        noHoldings: "보유한 회원권이 없어요",
        chartTitle: "체결가",
        chartEmpty: "체결이 쌓이면 차트가 그려져요",
        chartOfferLabel: (p: string) => `공모가 ${p}`,
        meBadge: "나",
        netError: "네트워크 응답이 없어요 — 잠시 후 다시 시도해 주세요",
    },
    // 클릭 전 disabled 사유 힌트 (과거형 에러와 구분되는 현재형 안내)
    hints: {
        connectWallet: "지갑을 연결해 주세요",
        switchChain: "GIWA Sepolia로 전환해 주세요",
        needVerify: "먼저 상단에서 실명 인증을 해주세요",
        belowMinCommit: (n: string) => `최소 응모 금액은 ${n} KRWs예요`,
        overWalletLimit: "1인당 한도를 초과해요",
        overKrwBalance: "KRWs 잔고보다 많아요 — 상단 ‘KRWs 받기’로 더 받을 수 있어요",
        overTokenBalance: "보유 장수보다 많아요",
        quoteUnavailable: "견적을 불러오지 못했어요",
        needTokenToRedeem: "보유 장수가 부족해요",
    },
    route404: {
        title: "페이지를 찾을 수 없어요",
        note: "주소가 올바르지 않아요",
        cta: "홈으로 돌아가기",
    },
    tx: {
        pendingWallet: "지갑에서 확인해 주세요…", // H2: 서명 팝업 대기
        pendingTx: "체결을 기다리는 중…", // H2: 컨펌 대기
        success: "완료됐어요",
        failed: "실패했어요",
        notReady: "지갑 연결을 확인하고 다시 시도해 주세요",
        viewOnChain: "온체인에서 확인 ↗", // C4
    },
    errors: {
        NotVerified: "실명 인증이 필요해요 — 상단 ‘실명 인증 (데모)’를 먼저 눌러 주세요",
        NotVerifiedCreator: "실명 인증이 필요해요",
        OverWalletLimit: "1인당 한도를 초과했어요",
        CommitFrozen: "마감 2시간 전부터는 취소할 수 없어요",
        BelowMinCommit: "최소 응모 금액보다 적어요",
        ResidualBelowMinCommit: "취소 후 남는 금액이 최소 응모 금액보다 적을 수 없어요",
        DeadlinePassed: "이 공모는 마감됐어요",
        RedeemClosed: "리딤 기한이 지났어요",
        MaxClaimsReached: "준비된 수량이 모두 소진됐어요",
        InsufficientOutput: "가격 변동이 커서 실행하지 않았어요 — 수량을 줄이거나 다시 시도해 주세요",
        AlreadyClaimed: "이미 배정을 받았어요",
        InvalidProof: "배정 정보가 일치하지 않아요",
        ERC20InsufficientBalance: "잔액이 부족해요",
        ERC20InsufficientAllowance: "먼저 사용 승인이 필요해요",
        PoolNotListed: "아직 상장 전이에요 — 공모 정산 후 거래할 수 있어요",
        FaucetCapExceeded: "한 번에 받을 수 있는 한도를 넘었어요",
        ChainMismatchError: "GIWA Sepolia 네트워크로 전환한 뒤 다시 시도해 주세요", // P0 #7
        "insufficient funds": "가스비가 부족해요 — GIWA Sepolia 테스트 ETH를 먼저 받아 주세요", // P0 #3
        noWallet: "연결할 지갑을 찾지 못했어요 — 메타마스크 같은 지갑 확장을 설치한 뒤 다시 시도해 주세요", // P0 4-a
        userRejected: "지갑에서 요청을 취소했어요",
        default: "트랜잭션이 실패했어요 — 잠시 후 다시 시도해 주세요",
    },
    creators: {
        // 데모 크리에이터 표시명 (offering 주소 → 이름) — 미등록 주소는 토큰명 사용
        byOffering: {} as Record<string, {name: string; en: string}>,
    },
} as const;
