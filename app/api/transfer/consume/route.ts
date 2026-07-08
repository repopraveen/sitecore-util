import { bearer, jsonError, normalizeHost, upstreamError } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Consumes the assembled .raif file into the TARGET environment's content
 * tree via the Item Transfer API. This is the moment content actually lands.
 * Body: { targetHost, targetToken, database, blobName }
 */
export async function POST(req: Request) {
  let body: { targetHost?: string; targetToken?: string; database?: string; blobName?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { targetHost, targetToken, blobName } = body;
  const database = body.database || "master";
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
    `${origin}/sitecore/shell/api/v3/ItemsTransfer/transfers/databases/${encodeURIComponent(
      database
    )}/sources?blobName=${encodeURIComponent(blobName)}`,
    { method: "POST", headers: bearer(targetToken), cache: "no-store" }
  );
  if (!res.ok) return upstreamError(res, "Consume .raif file");

  return Response.json({ ok: true, location: res.headers.get("location") });
}
