import clsx from "clsx";
import { BarChart3, BookOpen, ClipboardList, FileText, MoreHorizontal, Settings, Sparkles, Target, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "../components/ui";
import { useSummary } from "../lib/workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const NAV = [
  { to: "/week", label: "This week", icon: Sparkles },
  { to: "/plan", label: "Plan", icon: Target },
  { to: "/briefs", label: "Briefs", icon: FileText },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen },
  { to: "/refine", label: "Refine", icon: Wand2 },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/reports", label: "Reports", icon: ClipboardList },
] as const;
/** Phones get the first four plus "More" (the rest). */
const MOBILE = NAV.slice(0, 4);
const MORE = NAV.slice(4);

export function AppShell() {
  const summary = useSummary();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);
  const inMore = MORE.some((m) => pathname.startsWith(m.to));
  const isDemo = summary.data?.name.includes("(demo)");
  const badge = (to: string) =>
    to === "/briefs" && summary.data?.briefs_queued ? summary.data.briefs_queued
    : to === "/analytics" && summary.data?.pending_matches ? summary.data.pending_matches : 0;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <WorkspaceSwitcher />
        <nav aria-label="Main" className="mt-6 flex flex-1 flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}>
              {({ isActive }) => (
                <>
                  <Icon className={clsx("size-4", isActive && "text-accent")} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {badge(to) > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{badge(to)}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/settings"
          className={({ isActive }) => clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
            isActive ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
          <Settings className="size-4" aria-hidden /> Settings
        </NavLink>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1"><WorkspaceSwitcher /></div>
        <NavLink to="/settings" aria-label="Settings" className="rounded-lg p-2 text-ink-2 hover:bg-surface-2"><Settings className="size-5" /></NavLink>
      </header>

      <div className="min-w-0">
        {isDemo && (
          <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft px-4 py-2 text-sm lg:px-8">
            <p><span className="font-semibold">Demo data</span><span className="hidden sm:inline"> for a fictional Lagos bakery. Everything works; nothing is real.</span><span className="sm:hidden"> · nothing is real</span></p>
            <Button size="sm" variant="secondary" onClick={() => nav("/welcome")}>Set up my brand</Button>
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {more && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setMore(false)}>
          <div id="more-menu" className="absolute inset-x-3 bottom-20 rounded-2xl border border-line bg-surface p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {MORE.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => clsx("flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium", isActive ? "bg-surface-2 text-ink" : "text-ink-2")}>
                <Icon className="size-5" aria-hidden />{label}
                {badge(to) > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{badge(to)}</span>}
              </NavLink>
            ))}
          </div>
        </div>
      )}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {MOBILE.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-accent" : "text-ink-3")}>
            <Icon className="size-5" aria-hidden />
            {label}
            {badge(to) > 0 && <span className="absolute right-[22%] top-1 size-2 rounded-full bg-accent" aria-label={`${badge(to)} need attention`} />}
          </NavLink>
        ))}
        <button type="button" aria-expanded={more} aria-controls="more-menu" onClick={() => setMore((m) => !m)}
          className={clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", more || inMore ? "text-accent" : "text-ink-3")}>
          <MoreHorizontal className="size-5" aria-hidden />More
          {MORE.some((m) => badge(m.to) > 0) && <span className="absolute right-[22%] top-1 size-2 rounded-full bg-accent" aria-label="Needs attention" />}
        </button>
      </nav>
    </div>
  );
}
