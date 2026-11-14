import {Link, NavLink, Outlet, useLocation} from "react-router-dom";
import {useAccount, useDisconnect, useReadContract, useWriteContract} from "wagmi";
import {useWalletConnect} from "./hooks/useWalletConnect";
import {useSwitchToGiwa} from "./hooks/useSwitchToGiwa";
import {WalletPicker} from "./components/WalletPicker";
import {giwaSepolia} from "./config/chain";
import {useCopy, useLang, copy} from "./copy";
import {ADDR} from "./contracts/addresses";
import {MockKRWAbi, MockDojangAbi} from "./contracts/abis";
import {ADDR_V3} from "./contracts/addressesV3";
import {MockKRWV3Abi} from "./contracts/abisV3";
import {useOnboarding} from "./hooks";
import {useTx, useGlobalTxBusy} from "./components/tx";
import {fmt, shortAddr} from "./lib/format";
import {OnboardingProvider} from "./components/OnboardingModal";

/** Fixed-price offering section (v1/v2 contracts): /offerings and the legacy pages under it. */
export function isOfferingSection(pathname: string): boolean {
    return ["/offerings", "/offering/", "/membership", "/redeem", "/trade"].some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/** KO / EN text toggle: current language in brass-400, the other in hanji-400, no solid background. */
function LangToggle() {
    const tr = useCopy();
    const {lang, setLang} = useLang();
    const item = (l: "ko" | "en") => (
        <button
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={`min-h-[44px] px-1 text-[13px] ${lang === l ? "text-brass-400 font-semibold" : "text-hanji-400 hover:text-hanji-100"}`}
        >
            {l === "ko" ? tr.lang.ko : tr.lang.en}
        </button>
    );
    return (
        <div className="flex items-center flex-none" role="group" aria-label={tr.lang.label}>
            {item("ko")}
            <span className="text-ink-700 text-[13px] px-0.5">/</span>
            {item("en")}
        </div>
    );
}

function Nav() {
    const tr = useCopy();
    const {address, isConnected, chainId} = useAccount();
    const {pathname} = useLocation();
    const legacy = isOfferingSection(pathname);
    const wc = useWalletConnect();
    const {disconnect} = useDisconnect();
    const {switchToGiwa} = useSwitchToGiwa();
    const {krwBalance, ethBalance} = useOnboarding(); // legacy (ADDR) balances
    // v3 screens show the v3 MockKRW balance (ADDR_V3); the two deployments are never mixed.
    const krwV3 = useReadContract({
        address: ADDR_V3.mockKRW,
        abi: MockKRWV3Abi,
        functionName: "balanceOf",
        args: [address ?? "0x0000000000000000000000000000000000000000"],
        chainId: giwaSepolia.id,
        query: {enabled: !!address && !legacy, refetchInterval: 15_000},
    });
    const {writeContractAsync} = useWriteContract();
    const {run, busy} = useTx();
    const globalBusy = useGlobalTxBusy();
    const wrongChain = isConnected && chainId !== giwaSepolia.id;

    // 상시 KRWs 재충전 (v1/v2 ADDR 기반) — 공모 섹션에서만 노출
    const faucetBtn = legacy && isConnected && !wrongChain ? (
        <button
            onClick={() => void run(tr.nav.faucetTxLabel, () =>
                writeContractAsync({address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "faucet", args: [tr.onboarding.faucetAmount], chainId: giwaSepolia.id}))}
            disabled={busy || globalBusy || ethBalance === 0n}
            aria-label={tr.nav.faucetTitle}
            title={ethBalance === 0n ? tr.onboarding.needGas : tr.nav.faucetTitle}
            className="flex-none whitespace-nowrap min-h-[44px] px-3.5 border border-ink-700 rounded-full text-[13px] text-hanji-100 hover:border-brass-600 active:border-brass-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-ink-700">
            <span className="hidden sm:inline">{tr.nav.faucet}</span>
            <span className="sm:hidden">{tr.nav.faucetShort}</span>
        </button>
    ) : null;

    // Top tabs: 커브 / 발행 / 공모. 공모 is active across the whole offering section.
    const tabs = [
        {to: "/", label: tr.nav.curves, active: pathname === "/" || pathname.startsWith("/t/")},
        {to: "/create", label: tr.nav.create, active: pathname.startsWith("/create")},
        {to: "/offerings", label: tr.nav.home, active: legacy},
    ];
    // Offering-section sub tabs (routes unchanged)
    const subTabs = [
        {to: "/offerings", end: false, label: tr.nav.offeringList},
        {to: "/membership", end: false, label: tr.nav.membership},
        {to: "/redeem", end: false, label: tr.nav.redeem},
        {to: "/trade", end: false, label: tr.nav.trade},
    ];
    const inlineCls = (active: boolean) =>
        `px-3.5 min-h-[44px] flex items-center text-[15px] whitespace-nowrap border-b-2 ${active ? "font-semibold text-hanji-100 border-brass-400" : "text-hanji-400 border-transparent hover:text-hanji-100"}`;
    const gridCls = (active: boolean) =>
        `flex items-center justify-center min-h-[44px] text-[14px] whitespace-nowrap border-b-2 ${active ? "font-semibold text-hanji-100 border-brass-400" : "text-hanji-400 border-transparent"}`;
    const subCls = ({isActive}: {isActive: boolean}) =>
        `flex items-center justify-center sm:justify-start sm:px-3 min-h-[40px] text-[13px] whitespace-nowrap ${isActive ? "font-semibold text-brass-400" : "text-hanji-400 hover:text-hanji-100"}`;
    const shownKrw = legacy ? krwBalance : ((krwV3.data as bigint | undefined) ?? 0n);

    const wallet = wrongChain ? (
        <button onClick={switchToGiwa}
            className="min-h-[44px] px-5 py-2.5 bg-brass-400 text-ink-950 rounded-input text-[14px] font-bold hover:bg-brass-500 active:bg-brass-600">
            {tr.wrongChain}
        </button>
    ) : isConnected && address ? (
        <button onClick={() => disconnect()} title={tr.nav.disconnect}
            className="flex items-center gap-2.5 min-h-[44px] px-4 py-2 border border-ink-700 rounded-full text-[13px] hover:border-brass-600 active:border-brass-400">
            <span className="w-[7px] h-[7px] rounded-full bg-success" />
            <span className="text-hanji-100 tabular-nums">{shortAddr(address)}</span>
            <span className="hidden sm:flex items-center gap-2.5">
                <span className="text-ink-700">|</span>
                <span className="text-hanji-400 tabular-nums">{fmt(shownKrw, 0, tr.locale)} KRWs</span>
            </span>
        </button>
    ) : (
        <button onClick={wc.connectWallet} disabled={wc.isPending}
            className="min-h-[44px] px-5 py-2.5 bg-brass-400 text-ink-950 rounded-input text-[14px] font-bold hover:bg-brass-500 active:bg-brass-600 disabled:opacity-40">
            {tr.connect}
        </button>
    );

    return (
        <div className="border-b border-ink-700 sticky top-0 z-10" style={{background: "rgba(26,21,16,.94)", backdropFilter: "blur(8px)"}}>
            {/* 1줄: 로고 + (데스크톱 인라인 탭) + [faucet + 지갑] */}
            <div className="max-w-page mx-auto px-4 sm:px-8 min-h-[60px] sm:min-h-[64px] py-2 flex items-center gap-x-3 sm:gap-x-8">
                <NavLink to="/" className="flex items-center gap-2.5 flex-none">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt={tr.nav.logoAlt} className="h-9 w-auto block" />
                    {/* wordmark hidden below sm so logo + KO/EN + faucet + wallet chip fit in 390px */}
                    <span className="hidden sm:inline font-serif text-[17px] font-bold text-hanji-100" style={{letterSpacing: "0.16em"}}>MAPAE</span>
                </NavLink>
                <nav className="hidden sm:flex gap-1 items-center flex-1 min-w-0">
                    {tabs.map((t) => (
                        <Link key={t.to} to={t.to} className={inlineCls(t.active)}>{t.label}</Link>
                    ))}
                </nav>
                <div className="flex-1 sm:flex-none" />
                <div className="flex items-center gap-2 flex-none">
                    <LangToggle />
                    {faucetBtn}
                    {wallet}
                </div>
            </div>
            {/* 2줄(모바일 전용): 상단 탭 3등분 풀폭 */}
            <nav className="grid grid-cols-3 sm:hidden border-t border-ink-700">
                {tabs.map((t) => (
                    <Link key={t.to} to={t.to} className={gridCls(t.active)}>{t.label}</Link>
                ))}
            </nav>
            {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}
            {/* 공모 섹션 하위 탭 */}
            {legacy && (
                <nav className="border-t border-ink-700">
                    <div className="max-w-page mx-auto px-4 sm:px-8 grid grid-cols-4 sm:flex sm:gap-2">
                        {subTabs.map((t) => (
                            <NavLink key={t.to} to={t.to} end={t.end} className={subCls}>{t.label}</NavLink>
                        ))}
                    </div>
                </nav>
            )}
        </div>
    );
}

function OnboardingStep({done, n, label, txLabel, tx, blocked}: {
    done: boolean; n: string; label: string; txLabel: string; tx: () => Promise<`0x${string}`>; blocked?: boolean;
}) {
    const tr = copy; // legacy v2 section, Korean only
    const {run, busy, phase} = useTx();
    const globalBusy = useGlobalTxBusy();
    const text = phase === "wallet" ? tr.tx.pendingWallet : phase === "confirming" ? tr.tx.pendingTx : label;
    return (
        <button onClick={() => void run(txLabel, tx)} disabled={done || busy || globalBusy || blocked}
            className={`flex items-center gap-2 min-h-[44px] py-1.5 ${done ? "text-success cursor-default" : "text-brass-400 hover:text-brass-500 active:text-brass-600 disabled:opacity-60"}`}>
            <span className="w-[18px] h-[18px] rounded-full border grid place-items-center text-[11px] flex-none"
                style={{borderColor: "currentColor"}}>{done ? "✓" : n}</span>
            {done ? `${label} 완료` : text}
        </button>
    );
}

function OnboardingStrip() {
    const tr = copy; // legacy v2 section, Korean only
    const {isConnected, chainId} = useAccount();
    const {krwBalance, verified, ethBalance, isError} = useOnboarding();
    const {writeContractAsync} = useWriteContract();
    // #8: 읽기 실패 시엔 스트립 자체를 숨긴다 (완료한 사용자에게 재등장 방지)
    if (!isConnected || chainId !== giwaSepolia.id || isError || (krwBalance > 0n && verified)) return null;
    const noGas = ethBalance === 0n; // #3-a: 가스 없으면 온보딩부터 막힘
    return (
        <div className="bg-ink-900 border-b border-ink-700">
            <div className="max-w-page mx-auto px-4 sm:px-8 py-1.5 sm:py-3">
                {noGas && (
                    <div className="rounded-input px-4 py-2.5 mb-2 text-[13px] text-brass-400"
                        style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
                        {tr.onboarding.needGas}{" "}
                        <a href={tr.onboarding.gasFaucetUrl} target="_blank" rel="noreferrer">{tr.onboarding.gasFaucet}</a>
                    </div>
                )}
                <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-[13px]">
                    <span className="text-hanji-400 font-semibold">{tr.onboarding.title}</span>
                    <OnboardingStep done={krwBalance > 0n} blocked={noGas} n="1" label={tr.onboarding.faucet} txLabel="테스트 KRWs 받기"
                        tx={() => writeContractAsync({address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "faucet", args: [tr.onboarding.faucetAmount], chainId: giwaSepolia.id})} />
                    <span className="text-ink-700 hidden sm:inline">→</span>
                    <OnboardingStep done={verified} blocked={noGas} n="2" label={tr.onboarding.verify} txLabel="실명 인증 (데모)"
                        tx={() => writeContractAsync({address: ADDR.mockDojang, abi: MockDojangAbi, functionName: "selfVerify", chainId: giwaSepolia.id})} />
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const tr = useCopy();
    const {pathname} = useLocation();
    return (
        <div className="min-h-[100dvh] bg-ink-950 text-hanji-100">
            <Nav />
            {/* legacy v2 section: Korean-only notice in other languages, ADDR-based strip */}
            {isOfferingSection(pathname) && tr.legacyNotice && (
                <div className="bg-ink-900 border-b border-ink-700">
                    <div className="max-w-page mx-auto px-4 sm:px-8 py-2 text-[13px] text-hanji-400">{tr.legacyNotice}</div>
                </div>
            )}
            {isOfferingSection(pathname) && <OnboardingStrip />}
            <OnboardingProvider>
                <Outlet />
            </OnboardingProvider>
        </div>
    );
}
