import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { signRequest, type Attachment } from "@panorama/core";
import { ApiError } from "./api";
import { session } from "./session";

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

/**
 * Loads an attachment's bytes and exposes them as an object URL, cached by react-query under
 * `["attachment-url", id]`. `staleTime: Infinity` means the blob is fetched once per id (an
 * attachment never changes); `gcTime` keeps it around for 10 minutes after the last observer
 * unmounts, in case the same attachment reappears (e.g. scrolling a thread). The object URL
 * itself is revoked from an effect when the URL we handed out changes or this component
 * unmounts, so we don't leak blob URLs past the DOM nodes that reference them.
 */
export function useAttachmentUrl(id: string | null): string | null {
  const { data } = useQuery({
    queryKey: ["attachment-url", id],
    queryFn: async () => URL.createObjectURL(await fetchBlob(`/api/v1/attachments/${id}`)),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    return () => {
      if (data) URL.revokeObjectURL(data);
    };
  }, [data]);

  return data ?? null;
}
