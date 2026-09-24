import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Actor, Attachment, Comment, Evidence, EvidenceType, Lane, Project, Scopes, Ticket } from "@panorama/core";
import { api } from "./api";
import { session } from "./session";
import { connectStream, invalidationsFor } from "./stream";

export interface ThreadData {
  comments: Comment[];
  attachments: Attachment[];
  evidence: Evidence[];
  actors: Pick<Actor, "id" | "name" | "kind">[];
}

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("GET", "/api/v1/projects") });

export const useLanes = (projectId: string | undefined) =>
  useQuery({ queryKey: ["lanes", projectId], queryFn: () => api<Lane[]>("GET", `/api/v1/projects/${projectId}/lanes`), enabled: !!projectId });

export const useQueue = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["queue", projectId],
    queryFn: () => api<{ needsHuman: Ticket[]; active: Ticket[] }>("GET", `/api/v1/queue?projectId=${projectId}`),
    enabled: !!projectId,
  });

export const useAgents = () =>
  useQuery({ queryKey: ["agents"], queryFn: () => api<Actor[]>("GET", "/api/v1/agents") });

export const useTicket = (id: string | undefined) =>
  useQuery({ queryKey: ["ticket", id], queryFn: () => api<Ticket>("GET", `/api/v1/tickets/${id}`), enabled: !!id });

export const useTickets = (projectId: string | undefined) =>
  useQuery({ queryKey: ["tickets", projectId], queryFn: () => api<Ticket[]>("GET", `/api/v1/tickets?projectId=${projectId}`), enabled: !!projectId });

export const useEvidenceTypes = () =>
  useQuery({ queryKey: ["evidence-types"], queryFn: () => api<EvidenceType[]>("GET", "/api/v1/evidence-types"), staleTime: Infinity });

export const useThread = (ticketId: string | undefined) =>
  useQuery({ queryKey: ["thread", ticketId], queryFn: () => api<ThreadData>("GET", `/api/v1/tickets/${ticketId}/thread`), enabled: !!ticketId });

export interface GateMiss {
  typeId: string;
  name: string;
  need: number;
  have: number;
}

export const useGates = (ticketId: string | undefined) =>
  useQuery({
    queryKey: ["gates", ticketId],
    queryFn: () => api<Record<string, GateMiss[]>>("GET", `/api/v1/tickets/${ticketId}/gates`),
    enabled: !!ticketId,
  });

export const useAddComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; body: string; attachmentIds?: string[] }) => api<Comment>("POST", "/api/v1/comments", v),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["thread", v.ticketId] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
};

export const useAddEvidence = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; typeId: string; payload: Record<string, unknown>; attachmentId?: string; commentId?: string }) =>
      api<Evidence>("POST", "/api/v1/evidence", v),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["thread", v.ticketId] });
      qc.invalidateQueries({ queryKey: ["gates", v.ticketId] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
};

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
};

export const useMoveTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; laneId: string }) => api<Ticket>("POST", `/api/v1/tickets/${v.id}/move`, { laneId: v.laneId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
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
      qc.invalidateQueries({ queryKey: ["tickets"] });
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
      qc.invalidateQueries({ queryKey: ["tickets"] });
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

/**
 * Keeps a live SSE connection open while a session seed exists (reconnecting after unlock,
 * disconnecting after lock) and invalidates the affected queries as events arrive.
 * Returns "open" while connected, "closed" while reconnecting or logged out.
 */
export const useStream = (): "open" | "closed" => {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "closed">("closed");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function start() {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      connectStream({
        signal: controller.signal,
        onEvent: (e) => {
          for (const queryKey of invalidationsFor(e.type, e.data)) qc.invalidateQueries({ queryKey });
        },
        onStatus: setStatus,
      });
    }
    function stop() {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setStatus("closed");
    }

    if (session.getSeed()) start();
    const unsubscribe = session.subscribe(() => {
      if (session.getSeed()) start();
      else stop();
    });

    return () => {
      unsubscribe();
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [qc]);

  return status;
};
