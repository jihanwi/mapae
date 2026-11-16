# MAPAE (마패)

<p align="center"><img src="assets/logo.png" alt="MAPAE" width="240"></p>

**A launchpad on GIWA where every launch starts from the same line.**

모두가 같은 출발선에서 시작하는 런치패드. 한국어 문서는 [mapae.gitbook.io/mapae](https://mapae.gitbook.io/mapae/)에 있습니다.

> Status: live on GIWA Sepolia testnet. The contracts have not been audited.

## Why

Open token launches reward whoever is fastest. Bots buy in the first block, insiders hold supply nobody can see, and regular buyers arrive last.

GIWA has Dojang, an onchain attestation that a verified person is behind a wallet. MAPAE uses it at the moment it matters most: the start of a launch.

## Two tracks

### Bonding-curve launch (L0)

| Rule | Enforced by |
|---|---|
| For the first 10 minutes only real-name wallets can buy; after that anyone can. | `CurveSale._buyerVerified` (reverts `NotVerified` before `priorityUntil`), window from `CurveFactory.priorityWindow` (600 s) |
| No Dev pre-allocation: the whole supply is minted to the curve contract itself. | `CurveSale` constructor (`mintAllocations` to `address(this)`) |
| A Dev first buy inside the launch transaction is capped at 5% of total supply; a larger one reverts the whole launch. | `CurveFactory._checkDevFirstBuy` (`DevFirstBuyTooLarge`), `CurvePresets.DEV_FIRST_BUY_MAX_TOKENS` |
| Every token has the same supply, the same curve and the same graduation point. | `CurvePresets` constants (`TOTAL_SUPPLY`, `CURVE_SUPPLY`, `DEX_SUPPLY`, virtual reserves) |
| No minting after launch. | `MembershipToken.mintAllocations` (callable once; sets `minter` to `address(0)`) |
| On graduation the pool's liquidity is locked for good. | `CurveSale._graduate` (LP shares minted to the pool's `DEAD` address) |

### Fixed-price offering (L1)

| Rule | Enforced by |
|---|---|
| One price for everyone. | `Offering.price` (immutable) |
| Oversubscribed: an equal share first, then a lottery for the rest. The seed is published, so anyone can recompute the result. | [`script/allocation`](script/allocation/README.md) (`allocate.js`); `Offering.settle` stores `allocationRoot` and `seed` and emits `Settled`; `Offering.claim` checks the Merkle proof (`InvalidProof`) |
| Only part of the proceeds is paid at settlement; the rest is released over time by a lock contract per offering, which the platform cannot move. | `Offering._distributeProceeds`; `ProceedsLock` (no admin or revoke path, `transferOwnership` and `renounceOwnership` revert) |
| The issuer's disclosure is saved with a wallet signature and can be edited only until the first commitment; after that only dated addenda are added. | Off-chain: `web/api/_lib/disclosureHandler.ts` (signature check, `locked` after the first commitment, addenda) |
| Target missed: either a full refund or only the sold amount is issued. A refund takes two steps: `enableRefunds`, then `refund`. | `IOffering.RefundMode` (`AllOrNothing`, `Partial`); `Offering.settle` (`TargetNotReached` in `AllOrNothing`), `Offering.enableRefunds`, `Offering.refund` |

## What the token page shows

Dev first buy, Dev holdings, Dev sell history, the share held by the top 10 wallets and the share held by real-name wallets. These are shown as facts, without a score or a grade.

## Fees

| Where | Total | Split |
|---|---|---|
| Bonding-curve trade (L0) | 1.00% | platform 0.50% · Dev 0.35% · liquidity 0.15% |
| L0 pool after graduation | 1.00% | platform 0.40% · Dev 0.30% · liquidity 0.30% |
| L1 offering fee | 0% | allowed range in the contract: 0% to 5% |
| L1 pool (default) | 1.50% | platform 0.40% · issuer 0.60% · burn 0.30% · liquidity 0.20% (cap 1.50%) |

Values read on chain on 2026-11-17 (`FeeRouter.getCurveFees`, `getFees(L0)`, `getFees(L1)`). The two offerings opened on v3.2-L1 keep their original terms (7.5% offering fee).

The platform never receives the issued token by any path (`test/NoPlatformTokens.t.sol`, `CurveSale` accounting, [`docs/TRUST.md`](docs/TRUST.md)).

## Deployments (GIWA Sepolia)

Chain ID `91342` · RPC `https://sepolia-rpc.giwa.io` · Explorer [sepolia-explorer.giwa.io](https://sepolia-explorer.giwa.io)

L0, from [`deployments/giwa-sepolia-v3_2.json`](deployments/giwa-sepolia-v3_2.json):

| Contract | Address | Role |
|---|---|---|
| CurveFactory | [`0x9b8155C39cdB912557d8588157fC11e8D989e652`](https://sepolia-explorer.giwa.io/address/0x9b8155C39cdB912557d8588157fC11e8D989e652) | bonding-curve launches |
| FeeRouter | [`0xAB665B7867080cd62Aa316717400f3Cc094E7bd6`](https://sepolia-explorer.giwa.io/address/0xAB665B7867080cd62Aa316717400f3Cc094E7bd6) | curve and L0 pool fees |
| PoolFactory | [`0xf4E7Bf1ACe429400AC23E271E4409D212677e44F`](https://sepolia-explorer.giwa.io/address/0xf4E7Bf1ACe429400AC23E271E4409D212677e44F) | pools after graduation or settlement (shared with L1) |
| DojangAnyOf | [`0x87326FbbF76e724bA2bA954dAc04c3B939999f84`](https://sepolia-explorer.giwa.io/address/0x87326FbbF76e724bA2bA954dAc04c3B939999f84) | real-name check (shared with L1) |
| DojangEASAdapter | [`0x6cADa83208B32c2Ee0D0dB0341cfD0BF7B1584a4`](https://sepolia-explorer.giwa.io/address/0x6cADa83208B32c2Ee0D0dB0341cfD0BF7B1584a4) | reads the official Dojang attestation |
| MockDojang | [`0xaf80C431813EC4d2Cb34B3EC5b064095256871f8`](https://sepolia-explorer.giwa.io/address/0xaf80C431813EC4d2Cb34B3EC5b064095256871f8) | testnet demo verification |
| MockKRW | [`0x74eC9141afAd51F346BA5B841Ba93D573e8786fD`](https://sepolia-explorer.giwa.io/address/0x74eC9141afAd51F346BA5B841Ba93D573e8786fD) | testnet KRW stand-in (shared with L1) |
| MembershipTokenDeployer | [`0x9F011858B85b93a73330B56319Dc76a6f3255279`](https://sepolia-explorer.giwa.io/address/0x9F011858B85b93a73330B56319Dc76a6f3255279) | linked library (shared with L1) |

L1, from [`deployments/giwa-sepolia-v3_3_l1.json`](deployments/giwa-sepolia-v3_3_l1.json):

| Contract | Address | Role |
|---|---|---|
| MapaeFactory | [`0x3b1D679d6CFA5f2e92832aFfBf516319204D767f`](https://sepolia-explorer.giwa.io/address/0x3b1D679d6CFA5f2e92832aFfBf516319204D767f) | fixed-price offerings |
| FeeRouter | [`0xC8EF125aa945aF92144ECadc39CeE1a0b7415a70`](https://sepolia-explorer.giwa.io/address/0xC8EF125aa945aF92144ECadc39CeE1a0b7415a70) | L1 offering and pool fees |
| OfferingDeployer | [`0x08c51863170835Cb86a9e214f5B0b13F0380086b`](https://sepolia-explorer.giwa.io/address/0x08c51863170835Cb86a9e214f5B0b13F0380086b) | created by the factory |
| StackDeployer | [`0x5EE46f45af61270b5738e78ccad51b89dAC9F792`](https://sepolia-explorer.giwa.io/address/0x5EE46f45af61270b5738e78ccad51b89dAC9F792) | created by the factory |
| ProceedsLockDeployer | [`0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9`](https://sepolia-explorer.giwa.io/address/0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9) | per-offering proceeds locks |
| BuybackVault | [`0x3Ed11f7Bcc36B3603d51736652884800daa2f54c`](https://sepolia-explorer.giwa.io/address/0x3Ed11f7Bcc36B3603d51736652884800daa2f54c) | |

Earlier versions and their addresses: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

## Trust model and known limits

- Settlement of an offering is run only by the platform operator wallet (`Offering.settle` is `onlyOwner`). The allocation can be recomputed by anyone from the published seed ([`docs/TRUST.md`](docs/TRUST.md)).
- On testnet, the demo verification (`MockDojang`) also counts as real-name (`DojangAnyOf`: the official Dojang or MockDojang).
- Images, descriptions, disclosures, nicknames and comments are stored off chain.
- No external audit.

## Repository

- `src/`: Solidity contracts (Foundry).
- `test/`: Foundry tests.
- `script/`: deploy scripts, child-contract verification and the allocation script.
- `web/`: the web app (Vite, React) and its serverless API.
- `docs/`: deployment records, deploy procedures, trust model and specs.

## Development

```sh
forge build
forge test
```

```sh
cd web
npm ci
npm run codegen
npx vitest run
npm run build
```

Deploy procedures: [`docs/DEPLOY_V3_1.md`](docs/DEPLOY_V3_1.md), [`docs/DEPLOY_V3_2.md`](docs/DEPLOY_V3_2.md), [`docs/DEPLOY_V3_2_L1.md`](docs/DEPLOY_V3_2_L1.md), [`docs/DEPLOY_V3_3_L1.md`](docs/DEPLOY_V3_3_L1.md).

**Never store a private key in `.env`.** Use an encrypted keystore:

```sh
cast wallet import deployer --interactive
```

## History

The v1.0 / v2.0.1 creator-membership version is recorded in [`docs/README_v2.md`](docs/README_v2.md), [`docs/SUBMISSION.md`](docs/SUBMISSION.md) and [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).
Its contracts stay on GIWA Sepolia; the web app no longer lists them.
