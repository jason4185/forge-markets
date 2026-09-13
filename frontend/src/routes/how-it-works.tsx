import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How Forge works — 2-of-3 exchange consensus" },
      {
        name: "description",
        content:
          "How Forge commodity dominance markets work: exact 1-hour UTC windows, 1–50 GEN stakes, and 2-of-3 independent exchange consensus.",
      },
      { property: "og:title", content: "How Forge works" },
      {
        property: "og:description",
        content: "Exact 1-hour windows, pari-mutuel payouts and 2-of-3 exchange consensus.",
      },
    ],
  }),
  component: HowItWorks,
});

const STEPS = [
  {
    title: "Choose METALS or ENERGY and an exact 1-hour market",
    body: "Every market covers one exact 1-hour UTC window starting on an exact hour boundary. METALS ranks GOLD, SILVER and COPPER. ENERGY ranks WTI_CRUDE, BRENT_CRUDE and NATURAL_GAS.",
  },
  {
    title: "Pick one commodity and stake 1–50 GEN",
    body: "Minimum stake is 1 GEN and cumulative stake is capped at 50 GEN per wallet per market. One commodity per wallet per market — you can top up the same side before betting closes, but you cannot switch sides. Betting closes the moment the performance hour begins.",
  },
  {
    title: "Binance, Gate and Bitget independently rank the commodities",
    body: "Each exchange computes its own exact 1h open/close return for each commodity and ranks the three on its own. Prices and returns are never averaged across exchanges.",
  },
  {
    title: "Two matching valid source winners out of three settle the market",
    body: "A source that returns a TIE or is UNAVAILABLE casts no vote. There is a 30-minute retry window after the market ends, and settlement is permissionless — anyone can trigger it.",
  },
  {
    title: "Winning side shares the whole pool pari-mutually, 0% protocol fee",
    body: "Payouts are proportional to your share of the winning commodity's pool and are self-claimed. Forge takes no protocol fee.",
  },
  {
    title: "If consensus fails by the retry deadline, users self-claim original stakes",
    body: "No 2-of-3 agreement by the deadline means the market is INCONCLUSIVE and every wallet can reclaim its original stake. The same applies if the consensus-winning commodity has zero GEN backing while the total pool is nonzero.",
  },
];

function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 lg:px-6">
      <p className="forge-eyebrow">Protocol</p>
      <h1 className="mt-3 text-4xl font-semibold text-foreground">How Forge works</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Forge is a commodity dominance prediction market on GenLayer. Each market asks a single
        question: which commodity has the highest percentage return over this exact 1-hour UTC
        window?
      </p>

      <ol className="mt-10 flex flex-col gap-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-2xl border border-border bg-panel p-5">
            <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-ember/40 bg-ember/10 text-sm text-ember-soft">
              {i + 1}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{s.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-10 rounded-2xl border border-border bg-panel p-6">
        <h2 className="text-sm font-semibold text-foreground">2-of-3 consensus</h2>
        <div className="mt-6 flex flex-col items-center gap-4">
          <div className="grid w-full grid-cols-3 gap-3">
            {[
              { name: "Binance", res: "GOLD", status: "VALID" },
              { name: "Bitget", res: "GOLD", status: "VALID" },
              { name: "Gate", res: "No vote", status: "TIE" },
            ].map((s) => (
              <div
                key={s.name}
                className="rounded-xl border border-border bg-panel-2 p-4 text-center"
              >
                <p className="text-sm text-foreground">{s.name}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">own exact 1h candles</p>
                <p
                  className={`num mt-2 text-xs ${s.status === "VALID" ? "text-success" : "text-warning"}`}
                >
                  {s.status} · {s.res}
                </p>
              </div>
            ))}
          </div>
          <div className="flex w-full justify-center gap-16 text-muted-foreground">
            <span>↓</span>
            <span>↓</span>
            <span>↓</span>
          </div>
          <div className="w-full rounded-xl border border-ember/40 bg-ember/10 p-4 text-center">
            <p className="text-sm text-ember-soft">
              2 matching VALID winners → market settles GOLD
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              TIE and UNAVAILABLE sources cast no vote.
            </p>
          </div>
        </div>
        <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          Prices and returns are <span className="text-foreground">not averaged</span> across
          exchanges. Each source ranks the commodities independently using only its own exact 1h
          open and close.
        </p>
      </section>
    </div>
  );
}
