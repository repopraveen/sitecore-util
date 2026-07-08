import { bearer, jsonError, normalizeHost } from "@/lib/server";

export const runtime = "nodejs";

const BASE = "/sitecore/shell/api/v3/ItemsTransfer";

async function tryJson(url: string, headers: HeadersInit) {
  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

export async function POST(req: Request) {
  let body: { targetHost?: string; targetToken?: string; blobName?: string; database?: string };
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

  const headers = bearer(targetToken);
  const base = `${origin}${BASE}`;
  const blob = encodeURIComponent(blobName);

  const [a1, a2, a3, a4] = await Promise.all([
    tryJson(`${base}/transfers/${blob}`, headers),
    tryJson(
      `${base}/transfers/databases/${encodeURIComponent(database)}/sources/${blob}/items?page=1&pageSize=50`,
      headers
    ),
    tryJson(`${base}/transfers?page=1&pageSize=50`, headers),
    tryJson(`${base}/history?page=1&pageSize=20`, headers),
  ]);

  const details = a1.body ?? null;

  let failedItems: { Id?: string; Name?: string }[] | null = null;
  if (a2.body) {
    const items: { Id?: string; Name?: string; IsTransferred?: boolean }[] = a2.body.Items ?? [];
    failedItems = items
      .filter((i) => i.IsTransferred === false)
      .map(({ Id, Name }) => ({ Id, Name }));
  }

  const transfers: { Id?: string; SourceName?: string }[] = a3.body?.Transfers ?? [];
  const listEntry =
    transfers.find((t) => t.SourceName === blobName || t.Id === blobName) ?? null;

  const historySources: { SourceName?: string }[] = a4.body?.Sources ?? [];
  const history = historySources.find((h) => h.SourceName === blobName) ?? null;

  return Response.json({
    details,
    failedItems,
    listEntry,
    history,
    attempts: [
      { step: "transfer-details", status: a1.status },
      { step: "items", status: a2.status },
      { step: "transfers-list", status: a3.status },
      { step: "history", status: a4.status },
    ],
  });
}
