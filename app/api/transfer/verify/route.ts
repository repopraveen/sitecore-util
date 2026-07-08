import { bearer, jsonError, normalizeHost, upstreamError } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Verifies the blob transfer status on the TARGET environment.
 * Body: { targetHost, targetToken, blobName }
 * Returns the raw payload: { BlobState, Error, SourceName, Name }
 */
export async function POST(req: Request) {
  let body: { targetHost?: string; targetToken?: string; blobName?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { targetHost, targetToken, blobName } = body;
  if (!targetHost || !targetToken || !blobName) {
    return jsonError("targetHost, targetToken and blobName are required", 400);
  }

  let origin: string;
  try {
    origin = normalizeHost(targetHost);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }

  const res = await fetch(
    `${origin}/sitecore/shell/api/v3/ItemsTransfer/sources/blobs/${encodeURIComponent(blobName)}`,
    { headers: bearer(targetToken), cache: "no-store" }
  );
  if (!res.ok) return upstreamError(res, "Verify blob");
  return Response.json(await res.json());
}
