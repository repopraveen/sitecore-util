import { bearer, jsonError, normalizeHost, upstreamError } from "@/lib/server";
import type { DataTree } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Initiates a content transfer on the SOURCE environment.
 * Body: { host, token, transferId, database, dataTrees: DataTree[] }
 */
export async function POST(req: Request) {
  let body: {
    host?: string;
    token?: string;
    transferId?: string;
    database?: string;
    dataTrees?: DataTree[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { host, token, transferId, database, dataTrees } = body;
  if (!host || !token || !transferId || !dataTrees?.length) {
    return jsonError("host, token, transferId and dataTrees are required", 400);
  }

  // Safety guard: "LatestWin" is not implemented server-side (as of July 2026)
  // and can crash the CM environment with an unrecoverable HttpModule
  // initialization error ("Strategy 'LatestWin' is not yet implemented").
  if (dataTrees.some((t) => t.MergeStrategy === "LatestWin")) {
    return jsonError(
      "MergeStrategy 'LatestWin' is blocked: it is not implemented in SitecoreAI yet and " +
        "can crash the environment. Use OverrideExistingItem, KeepExistingItem or OverrideExistingTree.",
      400
    );
  }

  let origin: string;
  try {
    origin = normalizeHost(host);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }

  const res = await fetch(`${origin}/sitecore/api/content/transfer/v1/transfers`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      Configuration: { DataTrees: dataTrees, Database: database || "master" },
      TransferId: transferId,
    }),
    cache: "no-store",
  });

  if (!res.ok) return upstreamError(res, "Initiate transfer");
  return Response.json({ ok: true });
}
