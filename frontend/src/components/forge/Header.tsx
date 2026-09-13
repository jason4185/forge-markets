import { Link } from "@tanstack/react-router";
import {
  Bell,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  LogOut,
  Menu,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ForgeWordmark } from "./Logo";
import { FORGE_CHAIN_ID } from "@/lib/forge/constants";
import { forgeInjectedConnector, getActiveInjectedProvider } from "@/lib/forge/walletConfig";
import { logForgeError, mapForgeError } from "@/lib/forge/errors";
import { formatAsset, formatGen, relativeActivityTime, truncateAddress } from "@/lib/forge/format";
import { useForgeNotifications } from "@/lib/forge/notifications";
import {
  useForgeNetworkSwitch,
  useForgeNetworkSync,
  useForgeWalletAddress,
} from "@/lib/forge/useForge";

const NAV = [
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/create", label: "Create Market" },
  { to: "/how-it-works", label: "How it works" },
] as const;

export function Header() {
  const { address: accountAddress, chainId, isConnected } = useAccount();
  const address = useForgeWalletAddress();
  const { data: balance } = useBalance({ address: accountAddress, chainId: FORGE_CHAIN_ID });
  const { connect, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchNetwork, isPending: switching } = useForgeNetworkSwitch();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const notifications = useForgeNotifications(address);
  const wrongNetwork = isConnected && chainId !== FORGE_CHAIN_ID;
  useForgeNetworkSync();

  useEffect(() => {
    if (connectError) {
      logForgeError(connectError, "WALLET_CONNECT");
      const mapped = mapForgeError(connectError, "WALLET_CONNECT");
      toast.error(mapped.title, { description: mapped.message });
    }
  }, [connectError]);

  const connectWallet = () => {
    void getActiveInjectedProvider().then((provider) => {
      if (!provider) {
        const mapped = mapForgeError(new Error("NO_INJECTED_PROVIDER"), "WALLET_CONNECT");
        toast.error(mapped.title, { description: mapped.message });
        return;
      }
      connect({ connector: forgeInjectedConnector });
    });
  };
  const requestNetworkSwitch = () =>
    void switchNetwork("header").catch((error) => {
      const mapped = mapForgeError(error, "NETWORK_SWITCH");
      toast.error(mapped.title, { description: mapped.message });
    });
  const copyAddress = () => {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Couldn’t copy address", { description: "Try copying the address again." });
      return;
    }
    void navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() =>
        toast.error("Couldn’t copy address", { description: "Try copying the address again." }),
      );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 lg:px-6">
        <Link to="/" className="shrink-0">
          <ForgeWordmark />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-panel-2 hover:text-foreground data-[status=active]:bg-panel-2 data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="relative ml-auto hidden w-72 xl:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-9 w-full rounded-xl border border-border bg-panel pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search category, commodity or market ID"
          />
        </div>
        <div className="ml-auto flex items-center gap-2 xl:ml-0">
          <button
            onClick={wrongNetwork ? requestNetworkSwitch : undefined}
            className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs md:inline-flex ${wrongNetwork ? "border-warning/50 bg-warning/10 text-warning" : "border-border bg-panel text-muted-foreground"}`}
            title={wrongNetwork ? "Switch network" : "Connected to GenLayer StudioNext"}
          >
            <span
              className={`h-2 w-2 rounded-full ${wrongNetwork ? "bg-warning" : "bg-success"}`}
            />
            {wrongNetwork
              ? switching
                ? "Switching network…"
                : "Switch to StudioNext"
              : "GenLayer StudioNext"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="relative rounded-xl border border-border bg-panel p-2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {notifications.actionableCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember px-1 text-[10px] font-semibold text-primary-foreground">
                    {notifications.actionableCount}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Notifications</span>
                {address && notifications.actionableCount > 0 && (
                  <span className="text-[11px] text-ember-soft">
                    {notifications.actionableCount} actionable
                  </span>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {!address && (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    Connect a wallet to see Forge notifications.
                  </p>
                )}
                {address && notifications.isLoading && (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    Loading Forge activity…
                  </p>
                )}
                {address && notifications.isError && (
                  <p className="px-3 py-8 text-center text-xs text-destructive">
                    Activity is temporarily unavailable.
                  </p>
                )}
                {address &&
                  !notifications.isLoading &&
                  !notifications.isError &&
                  notifications.items.length === 0 && (
                    <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                      No recent activity.
                    </p>
                  )}
                {notifications.items.map((item) => (
                  <NotificationItem key={item.id} item={item} />
                ))}
              </div>
              {address && (
                <Link
                  to="/portfolio"
                  className="block border-t border-border px-3 py-2 text-center text-xs text-ember-soft hover:underline"
                >
                  View portfolio
                </Link>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {isConnected && address ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${wrongNetwork ? "border-warning/40 bg-warning/10 text-warning" : "border-ember/30 bg-ember/10 text-ember-soft"}`}
                  title="Open wallet menu"
                >
                  <span className="num">{truncateAddress(address)}</span>
                  <span className="h-3 w-px bg-ember/30" />
                  <span className="num">
                    {balance ? `${formatGen(balance.value)} GEN` : "— GEN"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Connected wallet
                </DropdownMenuLabel>
                <div className="px-2 pb-2">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-panel-2 p-2">
                    <code className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      {address}
                    </code>
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-panel hover:text-foreground"
                      aria-label="Copy wallet address"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="num mt-3 text-sm text-foreground">
                    {balance ? `${formatGen(balance.value)} GEN` : "Balance unavailable"}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Network</span>
                    <span className={wrongNetwork ? "text-warning" : "text-success"}>
                      {wrongNetwork ? "Wrong network" : "GenLayer StudioNext"}
                    </span>
                  </div>
                  {wrongNetwork && (
                    <button
                      type="button"
                      onClick={requestNetworkSwitch}
                      disabled={switching}
                      className="mt-3 w-full rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left text-xs text-warning disabled:opacity-60"
                    >
                      {switching ? "Switching…" : "Switch to StudioNext"}
                    </button>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => disconnect()} className="text-destructive">
                  <LogOut className="h-4 w-4" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" onClick={connectWallet} className="gap-1.5 rounded-xl">
              <Wallet className="h-4 w-4" /> Connect
            </Button>
          )}
          <button
            className="rounded-xl border border-border bg-panel p-2 text-muted-foreground lg:hidden"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Menu"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-border bg-panel px-4 py-3 lg:hidden">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-9 w-full rounded-xl border border-border bg-panel-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none"
              placeholder="Search category, commodity or market ID"
            />
          </div>
          <div className="flex flex-col">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            {wrongNetwork && (
              <button
                onClick={requestNetworkSwitch}
                disabled={switching}
                className="px-2 py-2 text-left text-sm text-warning disabled:opacity-60"
              >
                {switching ? "Switching…" : "Switch to StudioNext"}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function NotificationItem({ item }: { item: import("@/lib/forge/types").ForgeNotification }) {
  const Icon = item.kind.includes("SETTLED")
    ? CheckCircle2
    : item.kind === "SETTLEMENT_PENDING"
      ? Clock3
      : item.kind === "REFUND_AVAILABLE"
        ? CircleAlert
        : Bell;
  return (
    <Link
      to="/market/$id"
      params={{ id: item.marketId }}
      className="block border-b border-border/60 px-3 py-2.5 hover:bg-panel-2"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-lg bg-ember/10 p-1.5 text-ember-soft">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm text-foreground">{item.title}</p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          <p className="num mt-0.5 text-[11px] text-muted-foreground">
            {item.category} · #{item.marketId} · {relativeActivityTime(item.timestampMs)}
            {item.asset ? ` · ${formatAsset(item.asset)}` : ""}
            {item.action === "claim" ? " · Claim" : item.action === "refund" ? " · Refund" : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}
