import { bearer, jsonError, normalizeHost, upstreamError } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Marks a chunk set complete on the TARGET environment, which assembles the
 * uploaded chunks into a .raif file.
 * Body: { targetHost, targetToken, transferId, chunkSetId }
 * Returns: { fileName: string }
 */
export async function POST(req: Request) {
  let body: { targetHost?: string; targetToken?: string; transferId?: string; chunkSetId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { targetHost, targetToken, transferId, chunkSetId } = body;
  if (!targetHost || !targetToken || !transferId || !chunkSetId) {
    return jsonError("targetHost, targetToken, transferId and chunkSetId are required", 400);
  }

  let origin: string;
  try {
    origin = normalizeHost(targetHost);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }

  const res = await fetch(
    `${origin}/sitecore/api/content/transfer/v1/transfers/${encodeURIComponent(
      transferId
    )}/chunksets/${encodeURIComponent(chunkSetId)}/complete`,
    { method: "POST", headers: bearer(targetToken), cache: "no-store" }
  );
  if (!res.ok) return upstreamError(res, "Complete chunk set");

  const data = await res.json().catch(() => ({}));
  return Response.json({
    fileName:
      data.ContentTransferFileName || `contentTransfer-${transferId}-${chunkSetId}.raif`,
  });
}
