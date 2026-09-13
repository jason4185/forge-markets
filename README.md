# FORGE

_1-hour commodity dominance markets on GenLayer._

FORGE is a permissionless prediction market where users back the commodity
with the highest percentage return over an exact 1-hour UTC window.

**Live Demo:** [forge-markets.vercel.app](https://forge-markets.vercel.app/)

## How it works

Choose a category, choose an exact future UTC-hour market, and stake GEN on one
commodity. Betting closes when that performance window begins. After the hour
ends, the market can be settled from independent exchange evidence.

```mermaid
flowchart LR
    A[Choose METALS or ENERGY] --> B[Choose an exact 1-hour UTC market]
    B --> C[Pick one commodity]
    C --> D[Stake 1-50 GEN]
    D --> E[1-hour performance window]
    E --> F[Settlement]
    F --> G{Result}
    G -->|Winner| H[Claim pari-mutuel payout]
    G -->|Inconclusive| I[Claim original stake refund]
```

Each market:

- uses a 1-hour window starting on an exact UTC-hour boundary;
- accepts bets only before the performance window begins;
- requires a minimum stake of `1 GEN`;
- caps cumulative stake at `50 GEN` per wallet per market;
- allows one commodity per wallet per market;
- allows same-side top-ups, but does not allow switching sides; and
- charges a `0%` protocol fee.

## Supported markets

Forge has two fixed categories. Every market compares the three commodities in
its category.

| Category | Commodities |
| --- | --- |
| `METALS` | GOLD · SILVER · COPPER |
| `ENERGY` | WTI Crude (`WTI_CRUDE`) · Brent Crude (`BRENT_CRUDE`) · Natural Gas (`NATURAL_GAS`) |

The question is always: which of the three commodities will have the highest
percentage return during this exact 1-hour UTC window?

## Settlement

Forge uses Binance USD-M Futures, Gate, and Bitget as independent sources. Each
source uses its own open and close values for the same 1-hour candle and calculates:

```text
return = (close - open) / open
```

Each source then selects the commodity with the highest numerical return. The
contract does not average prices or returns across exchanges. It treats each
source result as an independent vote; the exchanges provide evidence, while
Forge and GenLayer consensus determine whether settlement is proven.

A source result is classified as `VALID`, `TIE`, `UNAVAILABLE`, or `INVALID`.
`VALID` casts its winner vote; `TIE`, `UNAVAILABLE`, and `INVALID` cast no vote.
`UNAVAILABLE` is a transient result that can be retried, while `INVALID` means
the source responded but its evidence failed deterministic validation.
Settlement requires `2 of 3` matching `VALID` source winners.
Each source calculation allows up to three attempts, but only `UNAVAILABLE`
results are retried; `TIE` and `INVALID` results stop that source calculation.

Forge evaluates the complete source proposal through GenLayer consensus. The
leader collects all three source results, and validators independently refetch
and validate all three. A positive result must prove the same financial winner
and include at least two matching source/winner witnesses in both executions;
a transient difference in the third source does not invalidate those common
witnesses.

Returns are compared by highest percentage return, so all-negative returns are
valid and the least-negative commodity can win. An exact highest-return tie
produces `TIE` and casts no winner vote.

The market lasts one hour. Settlement becomes available after the performance
hour ends and can be retried for a further 30 minutes. If no 2-of-3 result is
reached during that retry window, a `settle_market` call at or after the
deadline changes the market to `INCONCLUSIVE` without requiring another source
fetch.

```mermaid
flowchart LR
    B[Binance winner] --> C{2-of-3 match?}
    G[Gate winner] --> C
    T[Bitget winner] --> C

    C -->|Yes| W[Market winner]
    C -->|No before deadline| R[Retry settlement]
    R -->|No consensus by deadline| I[INCONCLUSIVE]
```

Example:

```text
Binance → GOLD
Gate → GOLD
Bitget → SILVER
```

Result → GOLD wins with 2-of-3 consensus.

## Payouts and refunds

All GEN staked in a market forms one pool. In a normally settled market, users
on the winning side share the full pool in proportion to their winning stake.
The protocol fee is `0%`.

```text
payout = total market pool × user winning stake / total winning stake
```

The final winning claimant receives any remaining integer-rounding amount, so
the full pool can be distributed.

If consensus selects a winning commodity with zero GEN staked while the market
contains funds, the market becomes `INCONCLUSIVE` instead. Users can claim back
their original stake. The same refund path applies to any market that reaches
the inconclusive state.

## Why GenLayer?

Forge uses GenLayer so a leader and validators independently execute the
nondeterministic source-evidence proposal. Validators refetch the three
exchange sources and verify the financial witness before the contract records
the market result and controls the winner, payout, or refund path under the
same rules for every caller.

## Deployment

| Field | Value |
| --- | --- |
| Network | GenLayer StudioNext / studio-dev |
| Chain ID | `61997` |
| Contract | [`0xcfA2625BC9bC6d1D34D4865e2f790087AE00fD15`](https://explorer-studio-dev.genlayer.com/address/0xcfA2625BC9bC6d1D34D4865e2f790087AE00fD15) |
| RPC | `https://studio-dev.genlayer.com/api` |

## Contract interface

### Reads

The contract exposes reads for protocol configuration and market discovery,
market details and state, connected-wallet positions and claimable positions,
source evidence, betting state, and wallet activity.

```text
categories
category_assets
get_config
get_market
get_markets
get_open_markets
get_market_count
get_market_by_category_start
get_my_position
get_my_market_count
get_my_positions
get_my_claimable_markets
get_source_evidence
get_betting_state
get_my_activity_count
get_my_activity
```

### Writes

```text
create_market
place_bet
settle_market
claim
claim_refund
```

`place_bet` is the only payable write. Settlement is permissionless: any wallet
can call `settle_market` once the market's performance window has ended.

## Frontend

The frontend is a TanStack Start application connected to the Forge contract
through `genlayer-js`. Current user-facing areas are:

- Markets (`/` and `/markets`)
- Market detail (`/market/:id`)
- Portfolio (`/portfolio`)
- Create Market (`/create`)
- How it works (`/how-it-works`)
- Notification bell in the shared header

Wallet-specific reads and writes use the connected injected browser wallet.
The market detail page also shows source evidence and pool composition. Its live
performance chart uses the contract-provided Binance symbols and public 1-minute
market data; it is informational only and is not connected to settlement.

## Run locally

```bash
cd frontend
bun install
bun run dev
```

To create a production build:

```bash
bun run build
```

## Project structure

```text
forge/
├── contracts/
│   └── Forge.py
├── frontend/
│   ├── src/
│   ├── package.json
│   └── bun.lock
├── tests/
│   ├── direct/
│   └── integration/
├── docs/
├── artifacts/
├── gltest.config.yaml
├── requirements.txt
└── README.md
```

## Status

- Forge intelligent contract deployed on GenLayer StudioNext.
- Frontend pages and contract-backed reads and writes are implemented.
- Wallet actions use the deployed contract through an injected wallet.
- Live performance chart data is informational only; settlement uses the contract's independent Binance, Gate, and Bitget evidence.
