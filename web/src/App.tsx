import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Skeleton } from "./components/ui";
import { AppShell } from "./layout/AppShell";
import { useSummary, useWorkspace } from "./lib/workspace";
import { BriefDetailPage } from "./pages/BriefDetail";
import { Briefs } from "./pages/Briefs";
import { Refine } from "./pages/Refine";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { ThisWeek } from "./pages/ThisWeek";
import { Welcome } from "./pages/Welcome";

// Chart pages carry the charting library; load them on demand.
const Analytics = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.Analytics })));
const PostDetailPage = lazy(() => import("./pages/PostDetail").then((m) => ({ default: m.PostDetailPage })));
const pageFallback = <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64" /></div>;

const TITLES: [RegExp, string][] = [
  [/^\/week/, "This week"], [/^\/refine/, "Refine my idea"], [/^\/briefs/, "Briefs"], [/^\/analytics/, "Analytics"],
  [/^\/reports/, "Reports"], [/^\/settings/, "Settings"], [/^\/setup/, "Set up"], [/^\/welcome/, "Welcome"],
];

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · Ideation` : "Ideation";
    window.scrollTo(0, 0);
  }, [pathname]);
}

/** Routes that need a workspace with a confirmed Brand Brain. */
function RequireReady({ children }: { children: ReactNode }) {
  const { workspaceId, setWorkspace } = useWorkspace();
  const summary = useSummary();
  useEffect(() => {
    if ((summary.error as { status?: number } | null)?.status === 404) setWorkspace(null);
  }, [summary.error, setWorkspace]);
  if (!workspaceId) return <Navigate to="/welcome" replace />;
  if (summary.isLoading) return <div className="mx-auto max-w-5xl space-y-4 p-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (summary.data && !summary.data.confirmed_at) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function App() {
  useDocumentTitle();
  const { workspaceId } = useWorkspace();
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/setup" element={workspaceId ? <Setup /> : <Navigate to="/welcome" replace />} />
      <Route element={<RequireReady><AppShell /></RequireReady>}>
        <Route path="/week" element={<ThisWeek />} />
        <Route path="/refine" element={<Refine />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/briefs/:id" element={<BriefDetailPage />} />
        <Route path="/analytics" element={<Suspense fallback={pageFallback}><Analytics /></Suspense>} />
        <Route path="/analytics/posts/:id" element={<Suspense fallback={pageFallback}><PostDetailPage /></Suspense>} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:id" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={workspaceId ? "/week" : "/welcome"} replace />} />
    </Routes>
  );
}
