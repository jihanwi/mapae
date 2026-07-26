import {NavLink, Outlet} from "react-router-dom";
import {useAccount, useConnect, useDisconnect, useSwitchChain, useWriteContract} from "wagmi";
import {giwaSepolia} from "./config/chain";
import {copy} from "./copy";
import {ADDR} from "./contracts/addresses";
import {MockKRWAbi, MockDojangAbi} from "./contracts/abis";
import {useOnboarding} from "./hooks";
import {useTx} from "./components/tx";
import {fmt, shortAddr} from "./lib/format";

function Nav() {
    const {address, isConnected, chainId} = useAccount();
    const {connect, connectors} = useConnect();
    const {disconnect} = useDisconnect();
    const {switchChain} = useSwitchChain();
    const {krwBalance} = useOnboarding();
    const wrongChain = isConnected && chainId !== giwaSepolia.id;

    const item = ({isActive}: {isActive: boolean}) =>
        `px-3.5 py-2 text-[15px] whitespace-nowrap border-b-2 ${isActive ? "font-semibold text-hanji-100 border-brass-400" : "text-hanji-400 border-transparent hover:text-hanji-100"}`;

    return (
        <div className="border-b border-ink-700 sticky top-0 z-10" style={{background: "rgba(26,21,16,.94)", backdropFilter: "blur(8px)"}}>
            <div className="max-w-page mx-auto px-4 sm:px-8 min-h-[64px] py-2 flex items-center gap-x-8 gap-y-3 flex-wrap">
                <NavLink to="/" className="flex items-center gap-2.5">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="MAPAE 로고" className="h-9 w-auto block" />
                    <span className="font-serif text-[17px] font-bold text-hanji-100" style={{letterSpacing: "0.16em"}}>MAPAE</span>
                </NavLink>
                <nav className="flex gap-1 items-center flex-1 min-w-0 overflow-x-auto">
                    <NavLink to="/" end className={item}>{copy.nav.home}</NavLink>
                    <NavLink to="/membership" className={item}>{copy.nav.membership}</NavLink>
                    <NavLink to="/redeem" className={item}>{copy.nav.redeem}</NavLink>
                    <NavLink to="/trade" className={item}>{copy.nav.trade}</NavLink>
                </nav>
                {wrongChain ? (
                    <button onClick={() => switchChain({chainId: giwaSepolia.id})}
                        className="px-5 py-2.5 bg-brass-400 text-ink-950 rounded-input text-[14px] font-bold hover:bg-brass-500">
                        {copy.wrongChain}
                    </button>
                ) : isConnected && address ? (
                    <button onClick={() => disconnect()} title="연결 해제"
                        className="flex items-center gap-2.5 px-4 py-2 border border-ink-700 rounded-full text-[13px] hover:border-brass-600">
                        <span className="w-[7px] h-[7px] rounded-full bg-success" />
                        <span className="text-hanji-100 tabular-nums">{shortAddr(address)}</span>
                        <span className="text-ink-700">|</span>
                        <span className="text-hanji-400 tabular-nums">{fmt(krwBalance, 0)} KRWs</span>
                    </button>
                ) : (
                    <button onClick={() => connect({connector: connectors[0]})}
                        className="px-5 py-2.5 bg-brass-400 text-ink-950 rounded-input text-[14px] font-bold hover:bg-brass-500">
                        {copy.connect}
                    </button>
                )}
            </div>
        </div>
    );
}

function OnboardingStrip() {
    const {isConnected, chainId} = useAccount();
    const {krwBalance, verified} = useOnboarding();
    const {writeContractAsync} = useWriteContract();
    const {run, busy} = useTx();
    if (!isConnected || chainId !== giwaSepolia.id || (krwBalance > 0n && verified)) return null;

    const step = (done: boolean, n: string, label: string, onClick: () => void) => (
        <button onClick={onClick} disabled={done || busy}
            className={`flex items-center gap-2 ${done ? "text-success cursor-default" : "text-brass-400 hover:text-brass-500"}`}>
            <span className="w-[18px] h-[18px] rounded-full border grid place-items-center text-[11px]"
                style={{borderColor: "currentColor"}}>{done ? "✓" : n}</span>
            {label}
        </button>
    );
    return (
        <div className="bg-ink-900 border-b border-ink-700">
            <div className="max-w-page mx-auto px-4 sm:px-8 py-3 flex items-center gap-5 flex-wrap text-[13px]">
                <span className="text-hanji-400 font-semibold">{copy.onboarding.title}</span>
                {step(krwBalance > 0n, "1", copy.onboarding.faucet, () =>
                    run("테스트 KRWs 받기", () =>
                        writeContractAsync({address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "faucet", args: [copy.onboarding.faucetAmount]})
                    )
                )}
                <span className="text-ink-700">→</span>
                {step(verified, "2", copy.onboarding.verify, () =>
                    run("실명 인증 (데모)", () =>
                        writeContractAsync({address: ADDR.mockDojang, abi: MockDojangAbi, functionName: "selfVerify"})
                    )
                )}
            </div>
        </div>
    );
}

export default function App() {
    return (
        <div className="min-h-screen bg-ink-950 text-hanji-100">
            <Nav />
            <OnboardingStrip />
            <Outlet />
        </div>
    );
}
