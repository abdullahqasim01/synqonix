/**
 * Files never pass through the API. To upload, the API hands out a presigned link and the browser
 * PUTs the bytes straight to storage; to download, the API hands out a short-lived link to open.
 */
export interface UploadTarget {
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  uploadToken: string;
}

export class UploadError extends Error {}

/** Sends the file to the presigned link. Plain fetch on purpose: no API Authorization header must go to the storage host. */
export async function putToPresigned(target: Pick<UploadTarget, "uploadUrl" | "headers">, file: Blob): Promise<void> {
  let res: Response;
  try {
    res = await globalThis.fetch(target.uploadUrl, { method: "PUT", headers: target.headers, body: file });
  } catch {
    throw new UploadError("Could not reach file storage. If this keeps happening, ask an admin to check the storage bucket's CORS settings.");
  }
  if (!res.ok) throw new UploadError(res.status === 403 ? "The upload link was rejected or has expired. Try again." : `Upload failed (${res.status})`);
}

/** Starts a browser download from a presigned link (the storage service sends it as an attachment). */
export function startDownload(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
