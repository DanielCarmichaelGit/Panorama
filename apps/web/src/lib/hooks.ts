import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Actor, Lane, Project, Scopes, Ticket } from "@panorama/core";
import { api } from "./api";

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("GET", "/api/v1/projects") });

export const useLanes = (projectId: string | undefined) =>
  useQuery({ queryKey: ["lanes", projectId], queryFn: () => api<Lane[]>("GET", `/api/v1/projects/${projectId}/lanes`), enabled: !!projectId });

export const useQueue = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["queue", projectId],
    queryFn: () => api<{ needsHuman: Ticket[]; active: Ticket[] }>("GET", `/api/v1/queue?projectId=${projectId}`),
    enabled: !!projectId,
  });

export const useAgents = () => useQuery({ queryKey: ["agents"], queryFn: () => api<Actor[]>("GET", "/api/v1/agents") });

export const useTicket = (id: string | undefined) =>
  useQuery({ queryKey: ["ticket", id], queryFn: () => api<Ticket>("GET", `/api/v1/tickets/${id}`), enabled: !!id });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; key: string }) => api<{ project: Project; lanes: Lane[] }>("POST", "/api/v1/projects", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

export const useCreateTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { projectId: string; title: string }) => api<Ticket>("POST", "/api/v1/tickets", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
};

export const useMoveTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; laneId: string }) => api<Ticket>("POST", `/api/v1/tickets/${v.id}/move`, { laneId: v.laneId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["ticket"] });
    },
  });
};

export const useSetFlag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; flag: string; on: boolean }) => api<Ticket>("POST", `/api/v1/tickets/${v.id}/flags`, { flag: v.flag, on: v.on }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["ticket"] });
    },
  });
};

export const useUpdateTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) => api<Ticket>("PATCH", `/api/v1/tickets/${v.id}`, v.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["ticket"] });
    },
  });
};

export const useApproveAgent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; scopes: Scopes }) => api<Actor>("POST", `/api/v1/agents/${v.id}/approve`, { scopes: v.scopes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
};

export const useRevokeAgent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Actor>("POST", `/api/v1/agents/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
};
