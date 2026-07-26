import {useMemo, useState} from "react";
import {useAccount, useReadContract, useReadContracts, useWriteContract} from "wagmi";
import {Abi, parseUnits} from "viem";
import {copy} from "../copy";
import {ADDR} from "../contracts/addresses";
import {MapaeFactoryAbi, MembershipTokenAbi, MockKRWAbi, RedeemManagerAbi, SponsorshipAbi} from "../contracts/abis";
import {useEventLogs, useOfferings, OfferingInfo} from "../hooks";
import {Medallion, Skeleton, TextSkeleton} from "../components/ui";
import {RunFn, TxButton} from "../components/tx";
import {fmt, shortAddr} from "../lib/format";
import {creatorOf} from "../lib/creators";

function usePeripherals(o: OfferingInfo | undefined) {
    const rm = useReadContract({
        address: ADDR.factory, abi: MapaeFactoryAbi, functionName: "redeemManagerOf",
        args: [o?.address ?? "0x0000000000000000000000000000000000000000"], query: {enabled: !!o},
    });
    const sp = useReadContract({
        address: ADDR.factory, abi: MapaeFactoryAbi, functionName: "sponsorshipOf",
        args: [o?.address ?? "0x0000000000000000000000000000000000000000"], query: {enabled: !!o},
    });
    return {redeemManager: rm.data as `0x${string}` | undefined, sponsorship: sp.data as `0x${string}` | undefined};
}

export default function Redeem() {
    const {offerings, isLoading} = useOfferings();
    const settled = offerings.filter((o) => o.settled);
    const [sel, setSel] = useState(0);
    const o = settled[sel];
    const {redeemManager, sponsorship} = usePeripherals(o);

    if (isLoading) return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={300} /></div>;

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-10 pb-20">
            <h1 className="m-0 mb-2 text-[28px] font-bold">{copy.redeem.title}</h1>
            <CreatorTabs list={settled} sel={sel} onSel={setSel} />
            {o && redeemManager && (
                <div className="flex flex-wrap gap-7 items-start mt-8">
                    <Catalog o={o} redeemManager={redeemManager} />
                    {sponsorship && <SponsorPanel o={o} sponsorship={sponsorship} />}
                </div>
            )}
        </div>
    );
}

function CreatorTabs({list, sel, onSel}: {list: OfferingInfo[]; sel: number; onSel: (i: number) => void}) {
    return (
        <div className="flex gap-2 mt-5 flex-wrap">
            {list.map((o, i) => {
                const c = creatorOf(o);
                return (
                    <button key={o.address} onClick={() => onSel(i)}
                        className={`px-4 py-2 rounded-full text-[13px] border ${i === sel ? "border-brass-400 text-brass-400 bg-ink-700" : "border-ink-700 text-hanji-400 hover:border-brass-600"}`}>
                        {c ? `${c.name} ${c.en}` : <TextSkeleton w={64} h={13} />}
                    </button>
                );
            })}
        </div>
    );
}

function Catalog({o, redeemManager}: {o: OfferingInfo; redeemManager: `0x${string}`}) {
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const created = useEventLogs(redeemManager,
        "event RedeemableCreated(uint256 indexed id, address indexed creator, uint256 burnAmount, uint256 maxClaims, uint256 deadline)");
    const ids = useMemo(() => {
        const seen = new Map<string, {id: bigint; burnAmount: bigint; maxClaims: bigint; deadline: bigint}>();
        for (const l of created.data ?? []) {
            const a = l.args as {id: bigint; burnAmount: bigint; maxClaims: bigint; deadline: bigint};
            seen.set(a.id.toString(), a);
        }
        return [...seen.values()];
    }, [created.data]);
    const states = useReadContracts({
        contracts: ids.map((r) => ({address: redeemManager, abi: RedeemManagerAbi as Abi, functionName: "redeemables", args: [r.id]})),
        query: {enabled: ids.length > 0, refetchInterval: 15_000},
    });
    const allowance = useReadContract({
        address: o.token, abi: MembershipTokenAbi, functionName: "allowance",
        args: [address ?? "0x0000000000000000000000000000000000000000", redeemManager],
        query: {enabled: !!address, refetchInterval: 15_000},
    });

    const doRedeem = (r: (typeof ids)[number]) => async (run: RunFn) => {
        if (((allowance.data as bigint) ?? 0n) < r.burnAmount) {
            const ok = await run("회원권 사용 승인", () =>
                writeContractAsync({address: o.token, abi: MembershipTokenAbi, functionName: "approve", args: [redeemManager, r.burnAmount]}));
            if (!ok) return;
        }
        await run("리딤", () =>
            writeContractAsync({address: redeemManager, abi: RedeemManagerAbi, functionName: "redeem", args: [r.id]}));
    };

    const now = Math.floor(Date.now() / 1000);
    return (
        <div className="flex-1" style={{minWidth: 340}}>
            <h2 className="m-0 mb-5 text-[21px] font-bold">{copy.redeem.catalog}</h2>
            {ids.length === 0 && <p className="text-[13px] text-hanji-400">아직 등록된 리딤이 없어요</p>}
            <div className="grid gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))"}}>
                {ids.map((r, i) => {
                    const s = states.data?.[i]?.result as [bigint, bigint, bigint, bigint, boolean] | undefined;
                    const claimCount = s?.[3] ?? 0n;
                    const soldOut = r.maxClaims > 0n && claimCount >= r.maxClaims;
                    const expired = r.deadline > 0n && Number(r.deadline) < now;
                    return (
                        <div key={r.id.toString()} className="bg-ink-800 border border-ink-700 rounded-card p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <Medallion char={fmt(r.burnAmount, 0)} sub="장 소각" size={64} />
                                <div className="flex-1">
                                    <div className="text-[17px] font-bold">리딤 #{r.id.toString()}</div>
                                    <div className="text-[12px] text-hanji-400 mt-1 tabular-nums">
                                        {r.maxClaims > 0n
                                            ? copy.redeem.claims(claimCount.toString(), r.maxClaims.toString())
                                            : `${claimCount.toString()}회 사용 · ${copy.redeem.unlimited}`}
                                    </div>
                                </div>
                            </div>
                            <TxButton className="w-full" disabled={soldOut || expired} action={doRedeem(r)}>
                                {expired ? copy.redeem.closed : soldOut ? copy.redeem.soldOut : `${copy.redeem.redeemCta} — ${copy.redeem.cost(fmt(r.burnAmount, 0))}`}
                            </TxButton>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SponsorPanel({o, sponsorship}: {o: OfferingInfo; sponsorship: `0x${string}`}) {
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const [amount, setAmount] = useState("");
    const [message, setMessage] = useState("");
    const burnBps = useReadContract({address: sponsorship, abi: SponsorshipAbi, functionName: "burnShareBps"});
    const feed = useEventLogs(sponsorship,
        "event Sponsored(address indexed sponsor, bool krwIn, uint256 amountIn, uint256 krwValue, uint256 tokensBurned, uint256 creatorAmount, bytes32 indexed messageHash, string message)");

    const amountWei = useMemo(() => {
        try { return parseUnits(amount.replace(/[^0-9.]/g, "") || "0", 18); } catch { return 0n; }
    }, [amount]);

    const sponsor = async (run: RunFn) => {
        if (amountWei === 0n || !address) return;
        const ok = await run("KRWs 사용 승인", () =>
            writeContractAsync({address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "approve", args: [sponsorship, amountWei]}));
        if (!ok) return;
        const done = await run("후원 보내기", () =>
            writeContractAsync({address: sponsorship, abi: SponsorshipAbi, functionName: "sponsorKRWs", args: [amountWei, message]}));
        if (done) { setAmount(""); setMessage(""); }
    };

    const events = [...(feed.data ?? [])].reverse().slice(0, 8);
    return (
        <div className="flex-1" style={{minWidth: 340}}>
            <div className="bg-ink-800 border border-ink-700 rounded-card p-7">
                <h2 className="m-0 mb-2 text-[21px] font-bold">{copy.redeem.sponsorTitle}</h2>
                <p className="m-0 mb-5 text-[13px] text-hanji-400">
                    {copy.redeem.sponsorNote(burnBps.data !== undefined ? String(Number(burnBps.data) / 100) : "10")}
                </p>
                <div className="flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400 mb-3">
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10,000" inputMode="decimal"
                        className="flex-1 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100 tabular-nums" />
                    <span className="text-hanji-400 text-[14px]">KRWs</span>
                </div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                    placeholder={copy.redeem.msgPlaceholder}
                    className="w-full box-border bg-ink-900 border border-ink-700 rounded-input px-4 py-3.5 text-[14px] text-hanji-100 outline-none focus:border-brass-400 resize-none mb-4" />
                <TxButton className="w-full" disabled={amountWei === 0n} action={sponsor}>{copy.redeem.sponsorCta}</TxButton>
            </div>
            <div className="mt-6">
                <h3 className="m-0 mb-4 text-[17px] font-bold">{copy.redeem.feed}</h3>
                {events.length === 0 && <p className="text-[13px] text-hanji-400">아직 후원이 없어요 — 첫 후원자가 되어 주세요</p>}
                {events.map((l, i) => {
                    const a = l.args as {sponsor: string; krwValue: bigint; tokensBurned: bigint; message: string};
                    return (
                        <div key={i} className="bg-ink-900 rounded-stat px-4 py-3.5 mb-2.5">
                            <div className="flex justify-between text-[13px] mb-1">
                                <span className="text-hanji-100 tabular-nums">{shortAddr(a.sponsor)}</span>
                                <span className="text-brass-400 font-semibold tabular-nums">{fmt(a.krwValue, 0)} KRWs</span>
                            </div>
                            {a.message && <div className="text-[14px] text-hanji-100 mb-1">“{a.message}”</div>}
                            <div className="text-[12px] text-hanji-400 tabular-nums">{copy.redeem.feedBurned(fmt(a.tokensBurned, 3))}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
