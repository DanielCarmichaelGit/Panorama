import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { signRequest, type Attachment } from "@panorama/core";
import { ApiError, api } from "./api";
import { session } from "./session";

// Attachment ids are server-generated UUIDs, but any string reaching fetchBlob/useAttachmentUrl
// ultimately comes from markdown content an author wrote (an `attachment:ID` reference). This is
// the one shape we ever accept there: restricting it up front means a crafted id (`../..`, a
// query string, anything path-like) can never reach a fetch URL or an href, in this module or in
// markdown.tsx, which imports this pattern rather than keeping its own copy.
export const ATTACHMENT_ID_PATTERN = "[A-Za-z0-9-]{1,64}";
const ATTACHMENT_ID_RE = new RegExp(`^${ATTACHMENT_ID_PATTERN}$`);

export function isValidAttachmentId(id: string | null | undefined): id is string {
  return !!id && ATTACHMENT_ID_RE.test(id);
}

/** Shared 423/bad_signature handling: same rule `api()` applies. */
function handleAuthFailure(status: number, code: string): void {
  if (status === 423 || code === "bad_signature") session.clear();
}

function errorFromBody(status: number, body: unknown): ApiError {
  const e = (body as any)?.error ?? { code: "network", message: `Request failed (${status})` };
  handleAuthFailure(status, e.code);
  return new ApiError(status, e.code, e.message, e.details);
}

/**
 * Fetches a binary response (an attachment's bytes) signed the same way `api()` signs JSON
 * requests, but returns the raw Blob instead of parsing JSON. Multipart/binary requests are
 * signed over the empty string, so a GET here signs the same way a GET through `api()` would.
 */
export async function fetchBlob(path: string): Promise<Blob> {
  const seed = session.getSeed();
  const headers: Record<string, string> = seed ? { ...(await signRequest(seed, "human", "GET", path, "")) } : {};
  const res = await fetch(path, { method: "GET", headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw errorFromBody(res.status, body);
  }
  return res.blob();
}

/**
 * Uploads a file as a signed multipart POST. Uses XMLHttpRequest (rather than fetch) so upload
 * progress is observable. The `ticketId` field is appended to the FormData before `file`,
 * matching the field order the server's multipart parser relies on (Task 4): it reads
 * `ticketId` off the first file part's preceding fields before buffering the file's bytes.
 * The request is signed over the empty-string body, per the multipart signing convention.
 */
export function uploadFile(ticketId: string, file: File, onProgress?: (fraction: number) => void): Promise<Attachment> {
  const path = "/api/v1/attachments";
  return new Promise((resolve, reject) => {
    (async () => {
      const seed = session.getSeed();
      const headers = seed ? await signRequest(seed, "human", "POST", path, "") : null;

      const form = new FormData();
      form.append("ticketId", ticketId);
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      if (headers) for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }

      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // non-JSON body; errorFromBody below falls back to a generic message
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as Attachment);
        else reject(errorFromBody(xhr.status, body));
      };
      xhr.onerror = () => reject(new ApiError(0, "network", "Could not reach Panorama"));

      xhr.send(form);
    })();
  });
}

/** What `GET /api/v1/attachments/:id/meta` reports: enough to render a file field without the bytes. */
export interface AttachmentMeta {
  id: string;
  ticketId: string;
  filename: string;
  mime: string;
  size: number;
  isImage: boolean;
}

/**
 * An attachment's metadata (filename, whether it is an image), cached for good since an
 * attachment never changes. A null or malformed id leaves the query disabled, the same guard
 * `useAttachmentUrl` applies before an id can reach a URL.
 */
export function useAttachmentMeta(id: string | null) {
  const valid = isValidAttachmentId(id);
  return useQuery({
    queryKey: ["attachment-meta", id],
    queryFn: () => api<AttachmentMeta>("GET", `/api/v1/attachments/${id}/meta`),
    enabled: valid,
    staleTime: Infinity,
  });
}

const ATTACHMENT_URL_KEY = "attachment-url";

// react-query dedupes observers of the same queryKey onto one cached Query: when the same
// attachment appears twice on screen, both AttachmentImage instances share the one cached object
// URL. Revoking it from a per-mount effect cleanup (the first version of this hook) is wrong,
// because unmounting the FIRST instance would revoke the URL the SECOND is still rendering. The
// right point to free the URL is cache eviction itself, i.e. once react-query has no observers
// left for that key *and* gcTime has elapsed and it drops the entry entirely: that's exactly what
// the QueryCache's "removed" event reports. We subscribe once per QueryClient (module-level,
// keyed by client, so re-rendering components don't add duplicate subscriptions) rather than once
// per hook instance.
const subscribedClients = new WeakSet<QueryClient>();

function ensureRevokeOnEviction(queryClient: QueryClient): void {
  if (subscribedClients.has(queryClient)) return;
  subscribedClients.add(queryClient);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "removed") return;
    const [scope, id] = event.query.queryKey as [string, unknown];
    if (scope !== ATTACHMENT_URL_KEY) return;
    const url = event.query.state.data as string | undefined;
    if (url) URL.revokeObjectURL(url);
  });
}

/**
 * Loads an attachment's bytes and exposes them as an object URL, cached by react-query under
 * `["attachment-url", id]`. `staleTime: Infinity` means the blob is fetched once per id (an
 * attachment never changes); `gcTime` keeps it around for 10 minutes after the last observer
 * unmounts, in case the same attachment reappears (e.g. scrolling a thread). See
 * `ensureRevokeOnEviction` above for why the object URL is freed on cache eviction rather than
 * on this hook's own unmount. `id` is validated with `isValidAttachmentId` before it is ever
 * used to build a fetch URL; an invalid id behaves like no id at all (the query stays disabled).
 */
export function useAttachmentUrl(id: string | null): { url: string | null; error: boolean } {
  const queryClient = useQueryClient();
  useEffect(() => {
    ensureRevokeOnEviction(queryClient);
  }, [queryClient]);

  const valid = isValidAttachmentId(id);
  const { data, isError } = useQuery({
    queryKey: [ATTACHMENT_URL_KEY, id],
    queryFn: async () => URL.createObjectURL(await fetchBlob(`/api/v1/attachments/${id}`)),
    enabled: valid,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });

  return { url: data ?? null, error: valid && isError };
}
