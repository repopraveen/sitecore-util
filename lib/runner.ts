import type { DataTree, EnvCredentials, TransferStatus } from "./types";

/** Client-side orchestration of the full transfer flow. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  return data as T;
}

export async function getToken(env: EnvCredentials): Promise<string> {
  const { accessToken } = await api<{ accessToken: string }>("/api/token", {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  });
  return accessToken;
}

export interface RunCallbacks {
  onStep: (id: string, state: "active" | "done" | "warn" | "error", detail?: string) => void;
  onLog?: (msg: string) => void;
}

export interface RunResult {
  /** Non-fatal issues, e.g. items consumed with errors on the target. */
  warnings: string[];
}

interface TransferSummary {
  TransferState?: string;
  Description?: string;
  TotalItemsCount?: number;
  TransferredItemsCount?: number;
  ValidationErrors?: string[] | null;
}

interface TransferDiagnostics {
  details?: TransferSummary | null;
  failedItems?: { Id?: string; Name?: string }[] | null;
  listEntry?: TransferSummary | null;
  history?: { Events?: { Name?: string; Date?: string }[] } | null;
  attempts?: { step: string; status: number }[];
}

/** Builds human-readable issue strings from the transfer diagnostics. */
function summarizeDiagnostics(diag: TransferDiagnostics): string[] {
  const issues: string[] = [];
  // Prefer the by-id details; fall back to the entry found in the transfers list.
  const d = diag.details ?? diag.listEntry;
  if (d) {
    if (d.TransferState?.trim()) issues.push(`TransferState: ${d.TransferState.trim()}`);
    if (
      typeof d.TransferredItemsCount === "number" &&
      typeof d.TotalItemsCount === "number"
    ) {
      issues.push(`${d.TransferredItemsCount}/${d.TotalItemsCount} item(s) transferred`);
    }
    if (d.Description?.trim()) issues.push(d.Description.trim());
    for (const v of d.ValidationErrors ?? []) {
      if (v?.trim()) issues.push(v.trim());
    }
  }
  if (diag.failedItems?.length) {
    issues.push(
      `Not transferred: ${diag.failedItems.map((i) => i.Name || i.Id).join(", ")}`
    );
  }
  if (diag.history?.Events?.length) {
    issues.push(`History: ${diag.history.Events.map((e) => e.Name).join(" → ")}`);
  }
  // Nothing parseable — expose what the diagnostic calls returned plus raw payloads,
  // so failures are never silent.
  if (!issues.length) {
    if (diag.attempts?.length) {
      issues.push(
        `Diagnostic calls: ${diag.attempts.map((a) => `${a.step}=${a.status}`).join(", ")}`
      );
    }
    const raw = JSON.stringify({ details: diag.details, listEntry: diag.listEntry });
    if (raw && raw !== '{"details":null,"listEntry":null}' && raw !== "{}") {
      issues.push(`Raw: ${raw.slice(0, 400)}`);
    }
  }
  return issues;
}

export interface RunInput {
  source: EnvCredentials;
  target: EnvCredentials;
  database: string;
  dataTrees: DataTree[];
}

export interface ItemImportInput {
  target: EnvCredentials;
  database: string;
  blobName: string;
}

async function verifyBlob(
  target: EnvCredentials,
  targetToken: string,
  database: string,
  blobName: string,
  cb: RunCallbacks,
  warnings: string[]
) {
  cb.onStep("verify", "active");
  const verifyDeadline = Date.now() + 10 * 60 * 1000;
  let verified = false;
  let verifyPollErrors = 0;
  while (Date.now() < verifyDeadline) {
    let blob: { BlobState?: string; Error?: string | null; SourceName?: string };
    try {
      blob = await api("/api/transfer/verify", {
        targetHost: target.host,
        targetToken,
        blobName,
      });
      verifyPollErrors = 0;
    } catch (e) {
      // The CM often returns transient 502/503 while it is busy consuming
      // the .raif — keep polling instead of failing the whole run.
      verifyPollErrors++;
      if (verifyPollErrors >= 8) throw e;
      cb.onStep("verify", "active", `Target busy - retrying (${verifyPollErrors}/8)...`);
      await sleep(8000);
      continue;
    }

    if (blob.BlobState === "Transferred") {
      verified = true;
      cb.onStep("verify", "done", "BlobState: Transferred");
      break;
    }

    // Terminal, but partial: the .raif was consumed and content landed,
    // though some items had errors (missing templates, broken links, ...).
    if (blob.BlobState === "TransferredWithErrors") {
      verified = true;
      let issues: string[] = blob.Error ? [blob.Error] : [];
      try {
        const diag = await api<TransferDiagnostics>("/api/transfer/details", {
          targetHost: target.host,
          targetToken,
          blobName,
          database,
        });
        issues = issues.concat(summarizeDiagnostics(diag));
      } catch {
        /* diagnostics are best-effort */
      }
      const summary = issues.length
        ? issues.join(" | ")
        : "No per-item detail returned by the API - check the item(s) in the target Content Editor.";
      warnings.push(`Consumed with errors (${blobName}): ${summary}`);
      cb.onStep("verify", "warn", `BlobState: TransferredWithErrors - ${summary}`);
      break;
    }

    // Terminal failure states.
    if (blob.Error || /^(failed|error|faulted)$/i.test(blob.BlobState ?? "")) {
      throw new Error(
        `Blob transfer failed (BlobState: ${blob.BlobState ?? "unknown"})${
          blob.Error ? `: ${blob.Error}` : ""
        }`
      );
    }

    cb.onStep("verify", "active", `BlobState: ${blob.BlobState ?? "..."}`);
    await sleep(4000);
  }
  if (!verified) throw new Error("Timed out verifying the blob transfer on the target.");
}

export async function runTransfer(input: RunInput, cb: RunCallbacks): Promise<RunResult> {
  const { source, target, database, dataTrees } = input;
  const warnings: string[] = [];

  // 1. Authenticate both environments
  cb.onStep("auth", "active");
  const [sourceToken, targetToken] = await Promise.all([getToken(source), getToken(target)]);
  cb.onStep("auth", "done");

  // 2. Initiate transfer on source
  const transferId = crypto.randomUUID();
  cb.onStep("initiate", "active", `TransferId: ${transferId}`);
  await api("/api/transfer/initiate", {
    host: source.host,
    token: sourceToken,
    transferId,
    database,
    dataTrees,
  });
  cb.onStep("initiate", "done", `TransferId: ${transferId}`);

  // 3. Poll status until Completed (tolerating transient 404s — CFW-9663)
  cb.onStep("status", "active");
  let status: TransferStatus | undefined;
  let statusPollErrors = 0;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      status = await api<TransferStatus>("/api/transfer/status", {
        host: source.host,
        token: sourceToken,
        transferId,
      });
      statusPollErrors = 0;
    } catch (e) {
      statusPollErrors++;
      if (statusPollErrors >= 5) throw e;
      cb.onStep("status", "active", `Source busy — retrying (${statusPollErrors}/5)…`);
      await sleep(6000);
      continue;
    }
    if (status.State === "Completed") break;
    if (status.State === "Failed") throw new Error("Source transfer job reported Failed.");
    cb.onStep("status", "active", `State: ${status.State}`);
    await sleep(5000);
  }
  if (status?.State !== "Completed") throw new Error("Timed out waiting for the source transfer to complete.");
  const chunkSets = status.ChunkSetsMetadata ?? [];
  if (!chunkSets.length) throw new Error("Transfer completed but returned no chunk sets.");
  const totalChunks = chunkSets.reduce((n, cs) => n + cs.ChunkCount, 0);
  cb.onStep("status", "done", `${chunkSets.length} chunk set(s), ${totalChunks} chunk(s)`);

  // 4. Relay every chunk (download from source, upload to target — server side)
  cb.onStep("relay", "active");
  let moved = 0;
  for (const cs of chunkSets) {
    for (let i = 0; i < cs.ChunkCount; i++) {
      const { bytes } = await api<{ isMedia: boolean; bytes: number }>(
        "/api/transfer/relay-chunk",
        {
          sourceHost: source.host,
          sourceToken,
          targetHost: target.host,
          targetToken,
          transferId,
          chunkSetId: cs.ChunkSetId,
          chunkIndex: i,
        }
      );
      moved++;
      cb.onStep("relay", "active", `Chunk ${moved}/${totalChunks} (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }
  cb.onStep("relay", "done", `${moved} chunk(s) relayed`);

  // 5. Complete each chunk set (assembles the .raif) then consume + verify it
  for (const cs of chunkSets) {
    cb.onStep("complete", "active", cs.ChunkSetId);
    const { fileName } = await api<{ fileName: string }>("/api/transfer/complete", {
      targetHost: target.host,
      targetToken,
      transferId,
      chunkSetId: cs.ChunkSetId,
    });
    cb.onStep("complete", "done", fileName);

    cb.onStep("consume", "active", fileName);
    await api("/api/transfer/consume", {
      targetHost: target.host,
      targetToken,
      database,
      blobName: fileName,
    });
    cb.onStep("consume", "done", fileName);

    await verifyBlob(target, targetToken, database, fileName, cb, warnings);
  }

  return { warnings };
}

export async function runItemImport(input: ItemImportInput, cb: RunCallbacks): Promise<RunResult> {
  const { target, database, blobName } = input;
  const warnings: string[] = [];

  cb.onStep("auth", "active");
  const targetToken = await getToken(target);
  cb.onStep("auth", "done");

  cb.onStep("consume", "active", blobName);
  await api("/api/transfer/consume", {
    targetHost: target.host,
    targetToken,
    database,
    blobName,
  });
  cb.onStep("consume", "done", blobName);

  await verifyBlob(target, targetToken, database, blobName, cb, warnings);

  return { warnings };
}
