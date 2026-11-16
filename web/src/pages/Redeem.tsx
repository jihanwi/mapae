import {useMemo, useState} from "react";
import {useAccount, useReadContract, useReadContracts, useWriteContract} from "wagmi";
import {Abi, parseUnits} from "viem";
import {copy} from "../copy";
import {ADDR_L1} from "../contracts/addressesV3L1";
import {RedeemManagerL1Abi, SponsorshipL1Abi} from "../contracts/abisV3L1";
import {MembershipTokenV3Abi, MockKRWV3Abi} from "../contracts/abisV3";
import {ApiFeedRow, EventLog, labelOf, RedeemItemInfo, useOfferingHistory, useOfferings, useOnboarding, useRedeemItems, OfferingInfo} from "../hooks";
import {LogState, ScanWindow} from "../lib/logRange";
import {LogStateNote} from "../components/LogStateNote";
import {redeemSections} from "../lib/redeemTab";
import {Medallion, NetError, Skeleton, TextSkeleton} from "../components/ui";
import {RunFn, TxButton} from "../components/tx";
import {fmt, sanitizeAmountInput, shortAddr} from "../lib/format";
import {giwaSepolia} from "../config/chain";
import {DEFAULT_TITLE, useTitle} from "../lib/title";

export default function Redeem() {
    useTitle(DEFAULT_TITLE);
    const {offerings, isLoading, isError, refetch} = useOfferings();
    const settled = offerings.filter((o) => o.settled);
    const [sel, setSel] = useState(0);
    const o = settled[sel];
    // manager and sponsorship come with the offering list (factory redeemManagerOf / sponsorshipOf)
    const redeemManager = o?.redeemManager;
    const sponsorship = o?.sponsorship;
    // decision 55: the catalog only with redeem items, the sponsor panel only with a sponsorship.
    // RedeemManager ids are issuer-chosen with no count view, so items come from RedeemableCreated:
    // the indexer's list plus the browser's read after it (W-T33)
    const created = useRedeemItems(o?.address, redeemManager);
    const ids = created.items ?? [];
    // a failed or partial-and-empty read is "unknown": the catalog shows that state instead of hiding
    const unknown = !!redeemManager && (created.state === "error" || (created.state === "partial" && ids.length === 0));
    const items = !o ? undefined : !redeemManager ? 0 : created.state === "complete" || ids.length > 0 ? ids.length : undefined;
    const show = redeemSections({items, sponsorship: !!sponsorship});
    const showCatalog = show.catalog || unknown;

    if (isLoading) return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={300} /></div>;
    if (isError && offerings.length === 0) return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><NetError onRetry={refetch} /></div>;

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">
            <h1 className="m-0 mb-2 text-[24px] sm:text-[28px] font-bold">{copy.redeem.title}</h1>
            <OfferingTabs list={settled} sel={sel} onSel={setSel} />
            {o && (showCatalog || show.sponsor) && (
                <div className="flex flex-col sm:flex-row flex-wrap gap-6 sm:gap-7 items-start mt-6 sm:mt-8">
                    {showCatalog && redeemManager && <Catalog o={o} redeemManager={redeemManager} ids={ids} scan={created} />}
                    {show.sponsor && sponsorship && <SponsorPanel o={o} sponsorship={sponsorship} />}
                </div>
            )}
            {o && show.empty && <p className="mt-6 text-[14px] text-hanji-400">{copy.redeem.noItems}</p>}
        </div>
    );
}


function OfferingTabs({list, sel, onSel}: {list: OfferingInfo[]; sel: number; onSel: (i: number) => void}) {
    return (
        <div className="flex gap-2 mt-5 flex-wrap">
            {list.map((o, i) => {
                const c = labelOf(o);
                return (
                    <button key={o.address} onClick={() => onSel(i)}
                        className={`px-4 min-h-[44px] rounded-full text-[13px] border ${i === sel ? "border-brass-400 text-brass-400 bg-ink-700" : "border-ink-700 text-hanji-400 hover:border-brass-600 active:border-brass-400"}`}>
                        {c ? `${c.name} ${c.symbol}` : <TextSkeleton w={64} h={13} />}
                    </button>
                );
            })}
        </div>
    );
}

function Catalog({o, redeemManager, ids, scan}: {o: OfferingInfo; redeemManager: `0x${string}`; ids: RedeemItemInfo[]; scan: {state: LogState; window: ScanWindow | undefined; refetch: () => void}}) {
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const states = useReadContracts({
        contracts: ids.map((r) => ({address: redeemManager, abi: RedeemManagerL1Abi as Abi, functionName: "redeemables", args: [r.id], chainId: giwaSepolia.id})),
        query: {enabled: ids.length > 0, refetchInterval: 15_000},
    });
    const zero = "0x0000000000000000000000000000000000000000" as const;
    const allowance = useReadContract({
        address: o.token, abi: MembershipTokenV3Abi, functionName: "allowance",
        args: [address ?? zero, redeemManager], query: {enabled: !!address, refetchInterval: 15_000},
    });
    const balance = useReadContract({
        address: o.token, abi: MembershipTokenV3Abi, functionName: "balanceOf",
        args: [address ?? zero], query: {enabled: !!address, refetchInterval: 15_000},
    });
    const tokenBal = balance.data as bigint | undefined;

    const doRedeem = (r: (typeof ids)[number]) => async (run: RunFn) => {
        if (((allowance.data as bigint) ?? 0n) < r.burnAmount) {
            const ok = await run(copy.redeem.approveLabel, () =>
                writeContractAsync({address: o.token, abi: MembershipTokenV3Abi, functionName: "approve", args: [redeemManager, r.burnAmount], chainId: giwaSepolia.id}));
            if (!ok) return;
        }
        await run("리딤", () =>
            writeContractAsync({address: redeemManager, abi: RedeemManagerL1Abi, functionName: "redeem", args: [r.id], chainId: giwaSepolia.id}));
    };

    const now = Math.floor(Date.now() / 1000);
    return (
        <div className="w-full sm:flex-1" style={{minWidth: 0}}>
            <h2 className="m-0 mb-5 text-[21px] font-bold">{copy.redeem.catalog}</h2>
            <LogStateNote scan={scan} count={ids.length} recent={copy.logs.noItemsRecent} none={copy.logs.noItems} />
            <div className="grid gap-4 sm:gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))"}}>
                {ids.map((r, i) => {
                    const s = states.data?.[i]?.result as [bigint, bigint, bigint, bigint, boolean] | undefined;
                    const claimCount = s?.[3] ?? 0n;
                    const soldOut = r.maxClaims > 0n && claimCount >= r.maxClaims;
                    // deadline from the item's on-chain state (redeemables(id): burnAmount, maxClaims, deadline, claimCount, exists)
                    const deadline = s?.[2] ?? 0n;
                    const expired = deadline > 0n && Number(deadline) < now;
                    // 9-a: 미연결·보유 부족 사전 차단
                    const reason = !address ? copy.hints.connectWallet
                        : (tokenBal !== undefined && tokenBal < r.burnAmount) ? copy.hints.needTokenToRedeem
                        : "";
                    return (
                        <div key={r.id.toString()} className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <Medallion char={fmt(r.burnAmount, 0)} sub={copy.redeem.burnUnit} size={64} />
                                <div className="flex-1">
                                    <div className="text-[17px] font-bold">{copy.redeem.itemName(r.id.toString())}</div>
                                    <div className="text-[12px] text-hanji-400 mt-1 tabular-nums">
                                        {r.maxClaims > 0n
                                            ? copy.redeem.claims(claimCount.toString(), r.maxClaims.toString())
                                            : `${claimCount.toString()}회 사용 · ${copy.redeem.unlimited}`}
                                    </div>
                                </div>
                            </div>
                            <TxButton className="w-full" disabled={soldOut || expired || reason !== ""} action={doRedeem(r)}>
                                {expired ? copy.redeem.closed : soldOut ? copy.redeem.soldOut : `${copy.redeem.redeemCta} — ${copy.redeem.cost(fmt(r.burnAmount, 0))}`}
                            </TxButton>
                            {reason && !soldOut && !expired && <p className="text-[12px] text-brass-400 mt-2 mb-0">{reason}</p>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SponsorPanel({o, sponsorship}: {o: OfferingInfo; sponsorship: `0x${string}`}) {
    const {address} = useAccount();
    const {krwBalance} = useOnboarding();
    const {writeContractAsync} = useWriteContract();
    const [amount, setAmount] = useState("");
    const [message, setMessage] = useState("");
    const burnBps = useReadContract({address: sponsorship, abi: SponsorshipL1Abi, functionName: "burnShareBps", chainId: giwaSepolia.id});
    // W-T33: the indexer's feed, the browser reads only the blocks after it
    const feed = useOfferingHistory<SponsorItem>({
        offering: o.address, feed: "sponsors", address: sponsorship, eventSig: SPONSORED, fromApi: sponsorFromApi, fromLog: sponsorFromLog,
    });

    const amountWei = useMemo(() => {
        try { return parseUnits(amount || "0", 18); } catch { return 0n; }
    }, [amount]);

    // 4-c / 9-a: 미연결·잔고 초과 사전 차단
    const sponsorReason =
        !address ? copy.hints.connectWallet
        : amountWei === 0n ? ""
        : amountWei > krwBalance ? copy.hints.overKrwBalance
        : "";
    const sponsorDisabled = amountWei === 0n || sponsorReason !== "";

    const sponsor = async (run: RunFn) => {
        if (amountWei === 0n || !address) return;
        const ok = await run("KRWs 사용 승인", () =>
            writeContractAsync({address: ADDR_L1.mockKRW, abi: MockKRWV3Abi, functionName: "approve", args: [sponsorship, amountWei], chainId: giwaSepolia.id}));
        if (!ok) return;
        const done = await run("후원 보내기", () =>
            writeContractAsync({address: sponsorship, abi: SponsorshipL1Abi, functionName: "sponsorKRWs", args: [amountWei, message], chainId: giwaSepolia.id}));
        if (done) { setAmount(""); setMessage(""); }
    };

    const events = (feed.items ?? []).slice(0, 8);
    return (
        <div className="w-full sm:flex-1" style={{minWidth: 0}}>
            <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-7">
                <h2 className="m-0 mb-2 text-[21px] font-bold">{copy.redeem.sponsorTitle}</h2>
                {/* W-T32: the share comes from the sponsorship contract; no number before it is read */}
                <p className="m-0 mb-5 text-[13px] text-hanji-400 min-h-[20px]">
                    {burnBps.data !== undefined ? copy.redeem.sponsorNote(String(Number(burnBps.data) / 100)) : ""}
                </p>
                <div className="flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400 mb-3">
                    <input value={amount} onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))} placeholder="10,000" inputMode="decimal"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100 tabular-nums" />
                    <span className="text-hanji-400 text-[14px] flex-none">KRWs</span>
                </div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                    placeholder={copy.redeem.msgPlaceholder}
                    className="w-full box-border bg-ink-900 border border-ink-700 rounded-input px-4 py-3.5 text-[14px] text-hanji-100 outline-none focus:border-brass-400 resize-none mb-4" />
                <TxButton className="w-full" disabled={sponsorDisabled} action={sponsor}>{copy.redeem.sponsorCta}</TxButton>
                {sponsorReason && <p className="text-[12px] text-brass-400 mt-2 mb-0">{sponsorReason}</p>}
            </div>
            <div className="mt-6">
                <h3 className="m-0 mb-4 text-[17px] font-bold">{copy.redeem.feed}</h3>
                <LogStateNote scan={feed} count={events.length} recent={copy.logs.noSponsorsRecent} none={copy.logs.noSponsors} />
                {events.map((a, i) => {
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

const SPONSORED = "event Sponsored(address indexed sponsor, bool krwIn, uint256 amountIn, uint256 krwValue, uint256 tokensBurned, uint256 creatorAmount, bytes32 indexed messageHash, string message)";

type SponsorItem = {tx: string; logIndex: number; block: bigint; sponsor: string; krwValue: bigint; tokensBurned: bigint; message: string};

const sponsorFromApi = (r: ApiFeedRow): SponsorItem => ({
    tx: r.tx, logIndex: r.logIndex, block: BigInt(r.block), sponsor: r.actor as string,
    krwValue: BigInt((r.amount as string) ?? "0"), tokensBurned: BigInt((r.amount2 as string) ?? "0"), message: (r.message as string | null) ?? "",
});

const sponsorFromLog = (l: EventLog): SponsorItem => {
    const a = l.args as {sponsor: string; krwValue: bigint; tokensBurned: bigint; message: string};
    return {tx: l.transactionHash!, logIndex: l.logIndex!, block: l.blockNumber!, sponsor: a.sponsor, krwValue: a.krwValue, tokensBurned: a.tokensBurned, message: a.message};
};
