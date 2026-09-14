# Forge Markets

Build the COMPLETE FORGE V1 frontend in this ONE turn. Be credit-efficient.

PRIORITY ORDER:
1. ALL six routes/pages must exist and be navigable.
2. App must compile and preview successfully.
3. Then polish styling/components.

Do NOT stop after planning, a foundation, a service layer, or shared components. Do NOT over-engineer architecture before pages exist. Start coding immediately. Do NOT add Supabase, database, auth, backend APIs, contract integration, or unrelated infrastructure. Use simple local mock data. Do not ask follow-up questions. Finish the pages, run the build, fix compile errors, and return only when the app works.

PRODUCT
FORGE is a GenLayer commodity dominance prediction market. Each market asks: “Which commodity has the highest percentage return over this exact 1-hour UTC window?”

Categories and fixed outcomes:
METALS: GOLD, SILVER, COPPER
ENERGY: WTI_CRUDE, BRENT_CRUDE, NATURAL_GAS

Rules the UI must reflect exactly:
- Exact 1-hour UTC windows, starting on exact UTC-hour boundaries.
- Betting closes when the performance hour begins.
- Minimum stake 1 GEN.
- Maximum cumulative stake 50 GEN per wallet per market.
- One commodity per wallet per market; same-side top-ups allowed before betting closes; switching sides is not.
- 0% protocol fee.
- Settlement uses Hyperliquid, Gate and Bitget.
- Each source independently ranks the three commodities using its own exact 1h open/close return. Never average prices or returns across exchanges.
- 2-of-3 matching VALID source winners settle the market.
- TIE, UNAVAILABLE, or INVALID source = no vote.
- 30-minute retry window after the market ends.
- If no 2-of-3 by deadline: INCONCLUSIVE and users self-claim original-stake refunds.
- If the consensus-winning commodity has zero GEN backing while the total market pool is nonzero: INCONCLUSIVE/refund.
- Winning payouts are pari-mutuel and self-claimed.

DESIGN — FOLLOW THE SUCCESSFUL CROWN/DOMINION PATTERN
Premium dark financial UI, not a generic SaaS app.
- Near-black background, charcoal panels, thin subtle borders.
- Warm ember/copper FORGE accent as the main brand/action color.
- Off-white primary text, muted gray secondary text.
- Green for open/success/valid, amber for settlement pending, red only for errors/losses.
- Compact top navigation, search, network pill, wallet pill, notification bell.
- Dense but clean cards, restrained pills, 12–16px radii, no glassmorphism overload, no giant decorative hero, no casino visuals.
- Desktop-first and responsive.
- Create an original simple FORGE geometric flame/anvil/hex mark with CSS/Lucide; do not copy Crown or Dominion branding.

STACK
Use the Lovable default React/TypeScript/Tailwind/shadcn stack. Use Lucide icons. Use Recharts only where needed for the market detail chart. Keep implementation straightforward.

ROUTES — ALL MUST BE BUILT AND WORK
/ or /markets — market discovery
/market/:id — individual market detail
/portfolio — connected-wallet positions
/activity — activity / notification center
/create — permissionless market creation
/how-it-works — protocol explanation

GLOBAL HEADER
FORGE logo/wordmark.
Nav: Markets, Portfolio, Activity, Create Market, How it works.
Desktop search: “Search category, commodity or market ID”.
Network pill: green dot + “GenLayer StudioNext”.
Notification bell with unread badge and small dropdown.
Wallet button with mock disconnected/connected toggle. Connected example can show 0xC8…1B87 and 98.9 GEN.
Mobile menu.

MARKETS PAGE
Use the successful Dominion-style market browser layout.
Top area:
Eyebrow: COMMODITY DOMINANCE
Headline: “Commodities compete. One hour decides.”
Subtitle: “Back the commodity that leads its category over an exact 1-hour UTC window. 0% protocol fee, settled by 2-of-3 exchange consensus.”
Right-side summary cards: Total Liquidity and Open Now.

Filters:
Category: All, Metals, Energy.
Status: All status, Open, Upcoming, Awaiting settlement, Settled, Inconclusive.
Search field.

Responsive market card grid: 3 columns desktop, 2 tablet, 1 mobile.
Every card shows category badge, state badge, market ID, exact UTC window, date, total pool, three-outcome segmented pool bar, and three commodity rows with name, GEN pool and pool share %. For settled markets highlight winner. Footer shows connected wallet position if one exists or “Connect wallet to see your position”. CTA “View market ↗”.
Create realistic mock markets covering OPEN, SETTLEMENT_PENDING, SETTLED, INCONCLUSIVE across METALS and ENERGY.

MARKET DETAIL PAGE
Use the successful Crown detail-page pattern: main content ~70%, sticky right action/position panel ~30%.

Header:
Breadcrumb e.g. “METALS · Forge · 1 Hour”.
Title: “Which commodity leads this window?”
Exact UTC start → end, market ID, total pool, state badge.

Main left card: Market view.
Tabs: Live Performance / Pool Composition.
Live Performance uses a clean 3-line Recharts chart showing relative return since market open and label “INFORMATIONAL ONLY”. METALS series: Gold/Silver/Copper. ENERGY: WTI/Brent/Natural Gas. For settled mock show “Contract winner: GOLD” style badge.
Pool Composition tab shows the three GEN pools and shares.
Below chart say: “Live performance is informational only. Settlement uses exact native 1h candles independently from Hyperliquid, Gate and Bitget.”

Sticky right panel variants:
OPEN: heading “Place a position”, three commodity choices, current GEN pool/share, amount input, quick 1 / 5 / 10 / Max, note min 1 / max cumulative 50, one asset per wallet, same-side top-ups only, ember CTA. Mock interaction can update local state or show toast.
SETTLEMENT_PENDING: show pick/stake if any, “Awaiting source consensus”, retry deadline, and permissionless “Settle market” mock button.
SETTLED winner/loser: contract winner + consensus count, Your Pick, Your Stake, Won/Lost. Winning unclaimed state shows claimable amount + “Claim winnings”. Lost state shows muted loss message. Claimed state shows confirmation.
INCONCLUSIVE: show refundable stake + “Claim refund”.

Below chart build:
1. Timeline (UTC): Betting closes, Performance starts, Performance ends, Settlement ready, Retry deadline.
2. Settlement card: Hyperliquid, Gate, Bitget rows with VALID/TIE/UNAVAILABLE and source winner; bottom summary “At least 2 of 3 valid sources” + contract winner/consensus. Add simple expandable evidence showing symbol/open/close/return for each source.
3. Rules card with Forge rules above.

PORTFOLIO PAGE
Use the successful Dominion portfolio pattern.
Eyebrow: WALLET PORTFOLIO
Heading: “Your Forge positions”
Subtext about active positions, claims/refunds and settled history.
Four summary cards: Total Staked, Claimable, Active Positions, Settled Positions.
Tabs: Active, Claimable, History.
Connected mock state shows position cards/rows with category, UTC window, selected commodity, stake, state, won/lost, claim/refund CTA when relevant.
Disconnected state shows “Connect a wallet to view your portfolio”.

ACTIVITY PAGE
Heading: “Activity”.
Subtitle: “Wallet actions and market outcomes that need your attention.”
Filters: All, Actions, Claims, Market updates.
Group mock items Today / Earlier.
Include BET_PLACED, BET_TOPPED_UP, PAYOUT_CLAIMED, REFUND_CLAIMED plus derived UI notifications such as market settled/won, market settled/lost, refund available, settlement pending.
Each item: icon, title, short description, timestamp, market/category, optional View market/Claim CTA. Unread items get a subtle ember mark. Add local “Mark all read”. Header bell dropdown shows latest four.

CREATE MARKET PAGE
Use the successful Crown create-market pattern.
Eyebrow: PERMISSIONLESS CREATION
Heading: “Create a Forge market”
Copy: “Choose a category and upcoming exact 1-hour UTC window. Anyone can open a market; no admin approval is required.”
Category selection cards: METALS with GOLD/SILVER/COPPER; ENERGY with WTI_CRUDE/BRENT_CRUDE/NATURAL_GAS.
Date selector.
Show upcoming exact 1-hour UTC window cards for selected date. Past/current windows disabled, future exact-hour windows selectable.
Right sidebar “Window preview”: category, assets, UTC start/end, betting closes, settlement retry deadline (+30 min after end), 0% fee, minimum 1 GEN.
CTA “Create Market”. Mock creation can show success and navigate to a fake market detail.
Note duplicate category + start window is rejected by the contract.

HOW IT WORKS PAGE
Keep it clean and educational, not marketing fluff.
Explain in six numbered sections:
1. Choose METALS or ENERGY and an exact 1-hour market.
2. Pick one commodity and stake 1–50 GEN.
3. Hyperliquid, Gate and Bitget independently rank the three commodities using their own exact 1h candle returns.
4. Two matching valid source winners out of three settle the market.
5. Winning side shares the whole pool pari-mutually, 0% protocol fee.
6. If consensus fails by retry deadline, users self-claim original stakes.
Include a simple three-source → 2-of-3 consensus diagram and explicitly say prices/returns are NOT averaged across exchanges.

MOCK DATA
Keep this simple. One typed local mock-data file is enough. Do NOT spend the turn building a complex service architecture. Create enough data to render every important state.

QUALITY / CREDIT RULES
- ALL route files/pages must be created before optional abstractions.
- Do NOT create a long planning document and then run out of time.
- Do NOT stop after shared components.
- Do NOT add backend, database, Supabase, auth, live APIs, or real GenLayer integration.
- Do NOT leave the default blank Lovable page anywhere.
- Ensure `/` redirects/renders Markets.
- Make nav links work.
- Run the build/typecheck and fix errors before finishing.
- If you must simplify anything to finish in this one turn, simplify mock interactions/architecture first — NEVER omit one of the six pages.

At completion, all six pages must exist, compile, and be clickable in preview.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/128d1bdb-7233-4508-acd2-4d9986d10eb4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
