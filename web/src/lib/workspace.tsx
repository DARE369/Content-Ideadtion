import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Summary } from "./types";

const KEY = "ideation.workspace";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

interface Ctx {
  workspaceId: string | null;
  setWorkspace: (id: string | null) => void;
}

const WorkspaceCtx = createContext<Ctx>({ workspaceId: null, setWorkspace: () => {} });

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setId] = useState<string | null>(read);
  const qc = useQueryClient();
  const setWorkspace = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch { /* private mode: keep it in memory */ }
    setId(id);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] === "ws" });
  }, [qc]);
  const value = useMemo(() => ({ workspaceId, setWorkspace }), [workspaceId, setWorkspace]);
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceCtx);

/** The current workspace id; only used under routes that guarantee one. */
export function useWs(): string {
  const { workspaceId } = useWorkspace();
  if (!workspaceId) throw new Error("no workspace selected");
  return workspaceId;
}

export function useSummary() {
  const { workspaceId } = useWorkspace();
  return useQuery<Summary>({
    queryKey: ["ws", workspaceId, "summary"],
    queryFn: () => api.summary(workspaceId!),
    enabled: !!workspaceId,
    retry: (n, err) => (err as { status?: number }).status !== 404 && n < 2,
  });
}

export function useAppConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
}
