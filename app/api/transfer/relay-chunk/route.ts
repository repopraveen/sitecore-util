import { bearer, jsonError, normalizeHost, upstreamError } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Relays one chunk: downloads it from the SOURCE environment and uploads it
 * to the TARGET environment, keeping the isMedia flag paired correctly.
 * The binary never touches the browser.
 *
 * Body: { sourceHost, sourceToken, targetHost, targetToken, transferId, chunkSetId, chunkIndex }
 * Returns: { isMedia: boolean, bytes: number }
 */
export async function POST(req: Request) {
  let body: {
    sourceHost?: string;
    sourceToken?: string;
    targetHost?: string;
    targetToken?: string;
    transferId?: string;
    chunkSetId?: string;
    chunkIndex?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { sourceHost, sourceToken, targetHost, targetToken, transferId, chunkSetId } = body;
  const chunkIndex = body.chunkIndex ?? 0;
  if (!sourceHost || !sourceToken || !targetHost || !targetToken || !transferId || !chunkSetId) {
    return jsonError(
      "sourceHost, sourceToken, targetHost, targetToken, transferId and chunkSetId are required",
      400
    );
  }

  let sourceOrigin: string, targetOrigin: string;
  try {
    sourceOrigin = normalizeHost(sourceHost);
    targetOrigin = normalizeHost(targetHost);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }

  const chunkPath = `/sitecore/api/content/transfer/v1/transfers/${encodeURIComponent(
    transferId
  )}/chunksets/${encodeURIComponent(chunkSetId)}/chunks/${chunkIndex}`;

  // 1. Download the chunk from the source (binary).
  const download = await fetch(`${sourceOrigin}${chunkPath}`, {
    headers: bearer(sourceToken),
    cache: "no-store",
  });
  if (!download.ok) return upstreamError(download, `Download chunk ${chunkIndex}`);

  // The Content-Disposition header carries an IsMedia flag:
  //   true  -> compressed media data
  //   false -> encrypted content data
  // It must be echoed back as the isMedia query param on upload, or the
  // receiving environment will corrupt the chunk trying to decode it.
  const disposition = download.headers.get("content-disposition") || "";
  const isMedia = /ismedia\s*=\s*true/i.test(disposition);

  const bytes = await download.arrayBuffer();

  // 2. Upload the exact same bytes to the target.
  const upload = await fetch(`${targetOrigin}${chunkPath}?isMedia=${isMedia}`, {
    method: "PUT",
    headers: { ...bearer(targetToken), "Content-Type": "application/octet-stream" },
    body: bytes,
    cache: "no-store",
  });
  if (!upload.ok) return upstreamError(upload, `Upload chunk ${chunkIndex}`);

  return Response.json({ isMedia, bytes: bytes.byteLength });
}
