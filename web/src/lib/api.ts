import type {
  Acceptance, Account, AnalyseInput, AnalyseStage, AppConfig, Campaign, CampaignIdea, CampaignInput, CampaignResults, CardType, CoverageRow, KnowledgeCard,
  Objective, ObjectiveInput, Product, ScanPage, ScanPreview, SourceRow, UploadRow, BrandBrain, BrandBrainRow, BrandDraft, CompetitorSuggestion, BriefDetail, BriefListItem, BriefPayload, Competitor, CostRow, IdeaCard,
  Learning, Match, Overview, Platform, PostDetail, PostRow, ReportDetail, ReportListItem, Summary, WorkspaceListItem,
} from "./types";

export interface MarketScan { ok: boolean; found: number; reused: boolean; warning?: string }
export interface GenerateResult { ideas: IdeaCard[]; drafted?: number; kept?: number; shortlisted?: number; scan: MarketScan }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface RequestOpts {
  /** Cancels the request (the user pressed Cancel). */
  signal?: AbortSignal;
  /** Give up after this long; throws ApiError with status 408. */
  timeoutMs?: number;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) c.abort(s.reason);
    else s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

/** True when the user cancelled, as opposed to a timeout or a server error. */
export const isCancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  let res: Response;
  const signals = [opts.signal, opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined].filter((s): s is AbortSignal => !!s);
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signals.length ? { signal: anySignal(signals) } : {}),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (e instanceof DOMException && e.name === "TimeoutError") throw new ApiError(408, "The server took too long to answer.");
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
  if (status === 504) return "The server ran out of time on this step.";
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
const post = <T,>(p: string, b?: unknown, o?: RequestOpts) => request<T>("POST", p, b ?? {}, o);
const put = <T,>(p: string, b: unknown) => request<T>("PUT", p, b);
const patch = <T,>(p: string, b: unknown) => request<T>("PATCH", p, b);
const putO = <T,>(p: string, b: unknown, o?: RequestOpts) => request<T>("PUT", p, b, o);
const del = <T,>(p: string) => request<T>("DELETE", p);

const W = (ws: string) => `/v1/workspaces/${ws}`;

export const api = {
  // --- Knowledge -------------------------------------------------------------------
  sources: (ws: string) => get<{ sources: SourceRow[] }>(`${W(ws)}/sources`).then((r) => r.sources),
  addSource: (ws: string, url: string, role = "other") => post<SourceRow>(`${W(ws)}/sources`, { url, role }),
  setSource: (ws: string, id: string, status: "active" | "rejected") => patch(`${W(ws)}/sources/${id}`, { status }),
  previewScan: (ws: string, extraUrls: string[] = []) => post<ScanPreview>(`${W(ws)}/scans`, { extra_urls: extraUrls }, { timeoutMs: 90_000 }),
  latestScan: (ws: string) => get<{ scan: ScanPreview | null }>(`${W(ws)}/scans/latest`).then((r) => r.scan),
  scan: (ws: string, id: string) => get<ScanPreview>(`${W(ws)}/scans/${id}`),
  scanPages: (ws: string, id: string) => get<{ pages: ScanPage[] }>(`${W(ws)}/scans/${id}/pages`).then((r) => r.pages),
  selectScanPages: (ws: string, id: string, pageIds: string[]) => putO<ScanPreview>(`${W(ws)}/scans/${id}/pages`, { page_ids: pageIds }),
  startScan: (ws: string, id: string) => post<ScanPreview>(`${W(ws)}/scans/${id}/start`, {}, { timeoutMs: 180_000 }),
  cards: (ws: string, q: { status?: string; type?: string; product?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return get<{ cards: KnowledgeCard[]; counts: Record<string, number> }>(`${W(ws)}/cards${qs ? `?${qs}` : ""}`);
  },
  addCard: (ws: string, c: { type: CardType; title: string; body: string; product_ids: string[] }) => post<{ id: string }>(`${W(ws)}/cards`, c),
  updateCard: (ws: string, id: string, c: Partial<Pick<KnowledgeCard, "status" | "type" | "title" | "body" | "product_ids">>) => patch(`${W(ws)}/cards/${id}`, c),
  bulkCards: (ws: string, ids: string[], status: "approved" | "rejected" | "suggested") => post<{ updated: number }>(`${W(ws)}/cards/bulk`, { ids, status }),
  mergeCards: (ws: string, ids: string[]) => post<{ id: string }>(`${W(ws)}/cards/merge`, { ids }),
  coverage: (ws: string) => get<{ products: CoverageRow[] }>(`${W(ws)}/coverage`).then((r) => r.products),
  products: (ws: string, all = false) => get<{ products: Product[] }>(`${W(ws)}/products${all ? "?all=1" : ""}`).then((r) => r.products),
  product: (ws: string, id: string) => get<{ product: Product; cards: KnowledgeCard[] }>(`${W(ws)}/products/${id}`),
  createProduct: (ws: string, p: Partial<Product> & { name: string }) => post<Product>(`${W(ws)}/products`, p),
  updateProduct: (ws: string, id: string, p: Partial<Product>) => patch<Product>(`${W(ws)}/products/${id}`, p),
  removeProduct: (ws: string, id: string) => del(`${W(ws)}/products/${id}`),
  refreshSummaries: (ws: string) => post<{ refreshed: number }>(`${W(ws)}/products/summaries`, {}, { timeoutMs: 120_000 }),
  uploads: (ws: string) => get<{ uploads: UploadRow[]; storage: boolean }>(`${W(ws)}/uploads`),
  createUpload: (ws: string, f: { filename: string; mime: string; size: number; sha256: string }) =>
    post<{ upload: UploadRow; upload_url: string | null; existing: boolean; storage: boolean }>(`${W(ws)}/uploads`, f),
  processUpload: (ws: string, id: string, b: { text?: string; image?: { media_type: string; data: string }; pages?: number; scanned?: boolean }) =>
    post<UploadRow>(`${W(ws)}/uploads/${id}/process`, b, { timeoutMs: 170_000 }),
  uploadLink: (ws: string, id: string) => get<{ url: string | null }>(`${W(ws)}/uploads/${id}/link`).then((r) => r.url),
  deleteUpload: (ws: string, id: string) => del(`${W(ws)}/uploads/${id}`),
  acceptance: (ws: string) => get<Acceptance>(`${W(ws)}/acceptance`),

  // --- Plan ------------------------------------------------------------------------
  objectives: (ws: string) => get<{ objectives: Objective[] }>(`${W(ws)}/objectives`).then((r) => r.objectives),
  saveObjective: (ws: string, o: ObjectiveInput, id?: string) => (id ? putO<Objective>(`${W(ws)}/objectives/${id}`, o) : post<Objective>(`${W(ws)}/objectives`, o)),
  deleteObjective: (ws: string, id: string) => del(`${W(ws)}/objectives/${id}`),
  draftGrowthPlan: (ws: string, a: { must_happen: string; customers: string; key_products: string; path_to_sale: string; measure: string }) =>
    post<{ objectives: ObjectiveInput[] }>(`${W(ws)}/growth-plan/draft`, a, { timeoutMs: 120_000 }).then((r) => r.objectives),
  campaigns: (ws: string) => get<{ campaigns: Campaign[] }>(`${W(ws)}/campaigns`).then((r) => r.campaigns),
  campaign: (ws: string, id: string) => get<{ campaign: Campaign; ideas: CampaignIdea[]; results: CampaignResults }>(`${W(ws)}/campaigns/${id}`),
  draftCampaign: (ws: string, sentence: string, cardIds: string[] = []) =>
    post<{ campaign: CampaignInput }>(`${W(ws)}/campaigns/draft`, { sentence, card_ids: cardIds }, { timeoutMs: 90_000 }).then((r) => r.campaign),
  saveCampaign: (ws: string, c: CampaignInput, id?: string) => (id ? putO<Campaign>(`${W(ws)}/campaigns/${id}`, c) : post<Campaign>(`${W(ws)}/campaigns`, c)),
  deleteCampaign: (ws: string, id: string) => del(`${W(ws)}/campaigns/${id}`),
  planCampaign: (ws: string, id: string) => post<{ created: number }>(`${W(ws)}/campaigns/${id}/plan`, {}, { timeoutMs: 240_000 }),

  config: () => get<AppConfig>("/v1/app-config"),
  workspaces: () => get<{ workspaces: WorkspaceListItem[] }>("/v1/workspaces").then((r) => r.workspaces),
  createWorkspace: (name: string) =>
    post<{ workspace_id: string }>("/v1/workspaces", { name, studio_workspace_id: `web_${crypto.randomUUID()}` }),
  renameWorkspace: (ws: string, name: string) => patch(`/v1/workspaces/${ws}`, { name }),
  deleteWorkspace: (ws: string) => del(`/v1/workspaces/${ws}`),
  seedDemo: () => post<{ workspace_id: string }>("/v1/demo"),
  summary: (ws: string) => get<Summary>(`/v1/workspaces/${ws}/summary`),

  brain: (ws: string) => get<BrandBrainRow>(`/v1/workspaces/${ws}/brand-brain`),
  analyseSite: (ws: string, b: AnalyseInput, o?: RequestOpts) => post<AnalyseStage & { name: string | null; logos: string[]; pages: number }>(`/v1/workspaces/${ws}/brand-brain/analyse/site`, b, o),
  analyseResearch: (ws: string, b: AnalyseInput, o?: RequestOpts) => post<AnalyseStage & { searched: boolean }>(`/v1/workspaces/${ws}/brand-brain/analyse/research`, b, o),
  analyseFinish: (ws: string, b: AnalyseInput, o?: RequestOpts) => post<BrandDraft & { warnings: string[] }>(`/v1/workspaces/${ws}/brand-brain/analyse/finish`, b, o),
  confirmBrain: (ws: string, b: BrandBrain) => put(`/v1/workspaces/${ws}/brand-brain`, b),

  competitors: (ws: string) => get<Competitor[]>(`/v1/workspaces/${ws}/competitors`),
  addCompetitor: (ws: string, c: { name: string; handles: Partial<Record<Platform, string>> }) => post(`/v1/workspaces/${ws}/competitors`, c),
  removeCompetitor: (ws: string, id: string) => del(`/v1/workspaces/${ws}/competitors/${id}`),
  competitorSuggestions: (ws: string) =>
    get<{ suggestions: CompetitorSuggestion[]; tracked: number; limit: number }>(`/v1/workspaces/${ws}/competitor-suggestions`),
  refreshCompetitorSuggestions: (ws: string) => post<{ suggestions: CompetitorSuggestion[] }>(`/v1/workspaces/${ws}/competitor-suggestions/refresh`, {}, { timeoutMs: 250_000 }),
  selectCompetitors: (ws: string, pick: { names?: string[]; auto?: boolean }) =>
    post<{ added: string[]; skipped: string[]; limit: number }>(`/v1/workspaces/${ws}/competitors/select`, pick),

  accounts: (ws: string) => get<{ accounts: Account[] }>(`/v1/workspaces/${ws}/accounts`).then((r) => r.accounts),
  addAccount: (ws: string, a: { platform: Platform; external_account_id: string; handle?: string; account_kind: string; studio_connection_id: string }) =>
    post(`/v1/workspaces/${ws}/accounts`, a),
  disconnect: (id: string) => del<{ deleted: { posts: number; comments: number } }>(`/v1/accounts/${id}`),

  ideas: (ws: string) => get<{ ideas: IdeaCard[] }>(`/v1/workspaces/${ws}/ideas?limit=10`).then((r) => r.ideas),
  /** Scan the market first (cited "why now"), then generate. A failed scan never blocks the ideas. */
  generateIdeas: async (ws: string): Promise<GenerateResult> => {
    const scan = await post<MarketScan>(`/v1/workspaces/${ws}/market-scan`, {}, { timeoutMs: 120_000 })
      .catch((): MarketScan => ({ ok: false, found: 0, reused: false, warning: "The market scan didn't finish, so these ideas don't cite current news." }));
    const r = await post<Omit<GenerateResult, "scan">>(`/v1/workspaces/${ws}/ideas/generate`, {}, { timeoutMs: 300_000 });
    return { ...r, scan };
  },
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
