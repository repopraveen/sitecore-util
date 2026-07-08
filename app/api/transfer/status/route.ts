import { bearer, jsonError, normalizeHost, upstreamError } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Polls transfer status on the SOURCE environment.
 * Body: { host, token, transferId }
 * Returns the raw status payload: { State, ChunkSetsMetadata? }
 *
 * Note: shortly after initiation the status endpoint may transiently return
 * 404 (known issue CFW-9663). We surface that as { State: "NotFoundYet" } so
 * the client keeps polling instead of failing.
 */
export async function POST(req: Request) {
  let body: { host?: string; token?: string; transferId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { host, token, transferId } = body;
  if (!host || !token || !transferId) {
    return jsonError("host, token and transferId are required", 400);
  }

  let origin: string;
  try {
    origin = normalizeHost(host);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }

  const res = await fetch(
    `${origin}/sitecore/api/content/transfer/v1/transfers/${encodeURIComponent(transferId)}/status`,
    { headers: bearer(token), cache: "no-store" }
  );

  if (res.status === 404) return Response.json({ State: "NotFoundYet" });
  if (!res.ok) return upstreamError(res, "Transfer status");
  return Response.json(await res.json());
}
