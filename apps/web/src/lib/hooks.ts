import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Actor,
  Attachment,
  Board,
  Comment,
  Epic,
  Evidence,
  EvidenceType,
  Family,
  FieldDefinition,
  FieldKind,
  Lane,
  LaneRequirement,
  Project,
  Scopes,
  Tag,
  Ticket,
} from "@panorama/core";
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

export const useBoards = (projectId: string | undefined) =>
  useQuery({ queryKey: ["boards", projectId], queryFn: () => api<Board[]>("GET", `/api/v1/projects/${projectId}/boards`), enabled: !!projectId });

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

/** The Board's tickets: the same query as `useTickets`, so the two views share one cache entry. */
export const useBoard = (projectId: string | undefined) => useTickets(projectId);

export const useEvidenceTypes = () =>
  useQuery({ queryKey: ["evidence-types"], queryFn: () => api<EvidenceType[]>("GET", "/api/v1/evidence-types"), staleTime: Infinity });

export const useEpics = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["epics", projectId],
    queryFn: () => api<Epic[]>("GET", `/api/v1/epics?projectId=${projectId}`),
    enabled: !!projectId,
  });

export const useTags = (projectId: string | undefined) =>
  useQuery({ queryKey: ["tags", projectId], queryFn: () => api<Tag[]>("GET", `/api/v1/tags?projectId=${projectId}`), enabled: !!projectId });

export const useFields = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["fields", projectId],
    queryFn: () => api<FieldDefinition[]>("GET", `/api/v1/fields?projectId=${projectId}`),
    enabled: !!projectId,
  });

export const useThread = (ticketId: string | undefined) =>
  useQuery({ queryKey: ["thread", ticketId], queryFn: () => api<ThreadData>("GET", `/api/v1/tickets/${ticketId}/thread`), enabled: !!ticketId });

export interface GateMiss {
  typeId: string;
  name: string;
  need: number;
  have: number;
}

const gatesQueryFn = (ticketId: string) => () => api<Record<string, GateMiss[]>>("GET", `/api/v1/tickets/${ticketId}/gates`);

export const useGates = (ticketId: string | undefined) =>
  useQuery({
    queryKey: ["gates", ticketId],
    queryFn: ticketId ? gatesQueryFn(ticketId) : gatesQueryFn(""),
    enabled: !!ticketId,
  });

/**
 * Warms the gates cache for a ticket ahead of time (the Board prefetches on pointerdown and on
 * focus), so by the time a drag crosses its activation distance, or a keyboard "m" move opens,
 * the data is usually already there instead of every lane briefly looking open. Cached for 10s:
 * long enough to cover the gap between a pointerdown/focus and the drag or select that follows.
 */
export const usePrefetchGates = () => {
  const qc = useQueryClient();
  return (ticketId: string) =>
    qc.prefetchQuery({ queryKey: ["gates", ticketId], queryFn: gatesQueryFn(ticketId), staleTime: 10_000 });
};

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
    mutationFn: (v: { projectId: string; title: string; boardId?: string; laneId?: string; metadata?: Record<string, unknown> }) =>
      api<Ticket>("POST", "/api/v1/tickets", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
};

export const useCreateBoard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { projectId: string; name: string; description?: string; family?: Family }) => api<Board>("POST", "/api/v1/boards", v),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ["boards", v.projectId] }),
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

/** Human only: replaces a lane's evidence requirements. */
export const useSetLaneRequirements = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; requirements: LaneRequirement[] }) =>
      api<Lane>("PUT", `/api/v1/lanes/${v.id}/requirements`, { requirements: v.requirements }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lanes"] });
      qc.invalidateQueries({ queryKey: ["gates"] });
    },
  });
};

/** Human only: creates an epic. Epics show as chips on tickets, so ticket and queue caches move too. */
export const useCreateEpic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { projectId: string; name: string; description?: string; family?: Family }) => api<Epic>("POST", "/api/v1/epics", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["epics"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
};

/** Human only: edits, reorders, or archives an epic. */
export const useUpdateEpic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      patch: { name?: string; description?: string | null; family?: Family; position?: number; archived?: boolean };
    }) => api<Epic>("PATCH", `/api/v1/epics/${v.id}`, v.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["epics"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
};

/** Human only: creates a tag. Tags show as chips on tickets, so ticket and queue caches move too. */
export const useCreateTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { projectId: string; name: string; family?: Family }) => api<Tag>("POST", "/api/v1/tags", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
};

/** Human only: archives a tag. Values already on tickets stay, but it stops being offered. */
export const useArchiveTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Tag>("POST", `/api/v1/tags/${id}/archive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
};

/** Human only: creates a custom ticket field definition. */
export const useCreateField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      projectId: string;
      name: string;
      key: string;
      kind: FieldKind;
      options?: { value: string; label: string }[];
      required: boolean;
    }) => api<FieldDefinition>("POST", "/api/v1/fields", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields"] }),
  });
};

/** Human only: edits, reorders, or archives a field definition. */
export const useUpdateField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      patch: { name?: string; options?: { value: string; label: string }[]; required?: boolean; position?: number; archived?: boolean };
    }) => api<FieldDefinition>("PATCH", `/api/v1/fields/${v.id}`, v.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields"] }),
  });
};

/** Human only: archives a field definition. Values already stored stay, just hidden. */
export const useArchiveField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<FieldDefinition>("POST", `/api/v1/fields/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields"] }),
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
      // Events that happened while the connection was down never arrived, so the caches are
      // stale by an unknown amount. On every reopen after a drop, refetch everything rather
      // than guessing which keys moved on.
      let dropped = false;
      connectStream({
        signal: controller.signal,
        onEvent: (e) => {
          for (const queryKey of invalidationsFor(e.type, e.data)) qc.invalidateQueries({ queryKey });
        },
        onStatus: (s) => {
          if (s === "closed") dropped = true;
          else if (dropped) { dropped = false; qc.invalidateQueries(); }
          setStatus(s);
        },
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
