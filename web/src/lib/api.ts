import type {
  Account, AppConfig, BrandBrain, BrandBrainRow, BrandDraft, CompetitorSuggestion, BriefDetail, BriefListItem, BriefPayload, Competitor, CostRow, IdeaCard,
  Learning, Match, Overview, Platform, PostDetail, PostRow, ReportDetail, ReportListItem, Summary, WorkspaceListItem,
} from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, friendlyError(res.status, data));
  return data as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function friendlyError(status: number, data: unknown): string {
  const msg = typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : "";
  if (status === 401) return "This server needs an access token. Set AUTH_MODE=open for the web app while sign-in isn't built.";
  if (status === 429) return msg || "Today's AI budget for this workspace is used up. It resets at midnight UTC.";
  if (status === 400 && typeof data === "object" && data && "issues" in data) {
    const issues = (data as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
  }
  if (msg) return msg;
  if (status >= 500) return "The server hit a problem before it could answer. Open /healthz/deep on this site for a setup check.";
  return `Something went wrong (${status}).`;
}

const get = <T,>(p: string) => request<T>("GET", p);
const post = <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const put = <T,>(p: string, b: unknown) => request<T>("PUT", p, b);
const patch = <T,>(p: string, b: unknown) => request<T>("PATCH", p, b);
const del = <T,>(p: string) => request<T>("DELETE", p);

export const api = {
  config: () => get<AppConfig>("/v1/app-config"),
  workspaces: () => get<{ workspaces: WorkspaceListItem[] }>("/v1/workspaces").then((r) => r.workspaces),
  createWorkspace: (name: string) =>
    post<{ workspace_id: string }>("/v1/workspaces", { name, studio_workspace_id: `web_${crypto.randomUUID()}` }),
  renameWorkspace: (ws: string, name: string) => patch(`/v1/workspaces/${ws}`, { name }),
  deleteWorkspace: (ws: string) => del(`/v1/workspaces/${ws}`),
  seedDemo: () => post<{ workspace_id: string }>("/v1/demo"),
  summary: (ws: string) => get<Summary>(`/v1/workspaces/${ws}/summary`),

  brain: (ws: string) => get<BrandBrainRow>(`/v1/workspaces/${ws}/brand-brain`),
  draftBrain: (ws: string, b: { website_url: string; goal: string; language?: string | null }) => post<BrandDraft>(`/v1/workspaces/${ws}/brand-brain/draft`, b),
  confirmBrain: (ws: string, b: BrandBrain) => put(`/v1/workspaces/${ws}/brand-brain`, b),

  competitors: (ws: string) => get<Competitor[]>(`/v1/workspaces/${ws}/competitors`),
  addCompetitor: (ws: string, c: { name: string; handles: Partial<Record<Platform, string>> }) => post(`/v1/workspaces/${ws}/competitors`, c),
  removeCompetitor: (ws: string, id: string) => del(`/v1/workspaces/${ws}/competitors/${id}`),
  competitorSuggestions: (ws: string) =>
    get<{ suggestions: CompetitorSuggestion[]; tracked: number; limit: number }>(`/v1/workspaces/${ws}/competitor-suggestions`),
  refreshCompetitorSuggestions: (ws: string) => post<{ suggestions: CompetitorSuggestion[] }>(`/v1/workspaces/${ws}/competitor-suggestions/refresh`),
  selectCompetitors: (ws: string, pick: { names?: string[]; auto?: boolean }) =>
    post<{ added: string[]; skipped: string[]; limit: number }>(`/v1/workspaces/${ws}/competitors/select`, pick),

  accounts: (ws: string) => get<{ accounts: Account[] }>(`/v1/workspaces/${ws}/accounts`).then((r) => r.accounts),
  addAccount: (ws: string, a: { platform: Platform; external_account_id: string; handle?: string; account_kind: string; studio_connection_id: string }) =>
    post(`/v1/workspaces/${ws}/accounts`, a),
  disconnect: (id: string) => del<{ deleted: { posts: number; comments: number } }>(`/v1/accounts/${id}`),

  ideas: (ws: string) => get<{ ideas: IdeaCard[] }>(`/v1/workspaces/${ws}/ideas?limit=10`).then((r) => r.ideas),
  generateIdeas: (ws: string) => post<{ ideas: IdeaCard[] }>(`/v1/workspaces/${ws}/ideas/generate`),
  idea: (id: string) => get<IdeaCard>(`/v1/ideas/${id}`),
  dismissIdea: (id: string) => post(`/v1/ideas/${id}/dismiss`),
  handoff: (id: string, platforms: Platform[]) => post<{ briefs: BriefPayload[] }>(`/v1/ideas/${id}/handoff`, { platforms }),
  autopilot: (ws: string) => post<{ briefs: BriefPayload[] }>(`/v1/workspaces/${ws}/autopilot`),

  briefs: (ws: string) => get<{ briefs: BriefListItem[] }>(`/v1/workspaces/${ws}/briefs`).then((r) => r.briefs),
  brief: (id: string) => get<BriefDetail>(`/v1/briefs/${id}`),
  queueBrief: (id: string) => post<{ queued: boolean }>(`/v1/briefs/${id}/queue`),

  overview: (ws: string) => get<Overview>(`/v1/workspaces/${ws}/analytics/overview?weeks=12`),
  posts: (ws: string) => get<{ posts: PostRow[] }>(`/v1/workspaces/${ws}/posts`).then((r) => r.posts),
  post: (id: string) => get<PostDetail>(`/v1/posts/${id}`),
  matches: (ws: string) => get<{ matches: Match[] }>(`/v1/workspaces/${ws}/matches`).then((r) => r.matches),
  confirmMatch: (postId: string, accept: boolean) => post(`/v1/published-posts/${postId}/confirm-match`, { accept }),
  learning: (ws: string) => get<Learning>(`/v1/workspaces/${ws}/learning`),

  reports: (ws: string) => get<{ reports: ReportListItem[] }>(`/v1/workspaces/${ws}/reports`).then((r) => r.reports),
  report: (id: string) => get<ReportDetail>(`/v1/reports/${id}`),
  costs: (ws: string) => get<{ last_30_days: CostRow[] }>(`/v1/workspaces/${ws}/costs`).then((r) => r.last_30_days),
};

/** Export downloads go straight to the API as files. */
export const exportUrl = {
  ideas: (ws: string, f: "md" | "csv" | "json") => `/v1/workspaces/${ws}/ideas?format=${f}`,
  idea: (id: string, f: "md" | "csv" | "json") => `/v1/ideas/${id}/export?format=${f}`,
  brief: (id: string, f: "md" | "csv" | "json") => `/v1/briefs/${id}/export?format=${f}`,
};

export async function download(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status}).`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
