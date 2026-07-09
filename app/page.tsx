"use client";

import { useEffect, useMemo, useState } from "react";
import type { DataTree, EnvCredentials, MergeStrategy, RunStep, Scope } from "@/lib/types";
import { getToken, runItemImport, runTransfer } from "@/lib/runner";
import { useMarketplaceClient } from "@/lib/useMarketplaceClient";

const EMPTY_ENV: EnvCredentials = { host: "", clientId: "", clientSecret: "" };
const EMPTY_TREE: DataTree = {
  ItemPath: "",
  Scope: "SingleItem",
  MergeStrategy: "OverrideExistingItem",
};

const SCOPES: Scope[] = ["SingleItem", "ItemAndDescendants"];
// "LatestWin" is deliberately excluded: as of July 2026 it is not implemented
// server-side and is also rejected by /api/transfer/initiate.
const MERGE_STRATEGIES: MergeStrategy[] = [
  "OverrideExistingItem",
  "KeepExistingItem",
  "OverrideExistingTree",
];

const CONTENT_STEPS: RunStep[] = [
  { id: "auth", label: "Authenticate environments", state: "pending" },
  { id: "initiate", label: "Create source package", state: "pending" },
  { id: "status", label: "Wait for package", state: "pending" },
  { id: "relay", label: "Move package chunks", state: "pending" },
  { id: "complete", label: "Finalize package on target", state: "pending" },
  { id: "consume", label: "Import package", state: "pending" },
  { id: "verify", label: "Verify import", state: "pending" },
];

const IMPORT_STEPS: RunStep[] = [
  { id: "auth", label: "Authenticate target", state: "pending" },
  { id: "consume", label: "Import existing package", state: "pending" },
  { id: "verify", label: "Verify import", state: "pending" },
];

const STORAGE_KEY = "sync-content";

type TestState = "idle" | "testing" | "ok" | "fail";
type TransferMode = "content-transfer" | "item-transfer";
type WizardStep = "connect" | "choose" | "review" | "run";

const wizardSteps: { id: WizardStep; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "choose", label: "Select" },
  { id: "review", label: "Review" },
  { id: "run", label: "Run" },
];

function emptySteps(mode: TransferMode): RunStep[] {
  return (mode === "content-transfer" ? CONTENT_STEPS : IMPORT_STEPS).map((step) => ({
    ...step,
    detail: undefined,
  }));
}

function EnvFields({
  title,
  helper,
  env,
  onChange,
  disabled,
}: {
  title: string;
  helper: string;
  env: EnvCredentials;
  onChange: (env: EnvCredentials) => void;
  disabled: boolean;
}) {
  const [test, setTest] = useState<TestState>("idle");

  async function testConnection() {
    setTest("testing");
    try {
      await getToken(env);
      setTest("ok");
    } catch {
      setTest("fail");
    }
  }

  return (
    <section className="env-panel">
      <div>
        <h3>{title}</h3>
        <p>{helper}</p>
      </div>
      <label>
        CM host
        <input
          className="mono"
          placeholder="https://xmc-project-env.sitecorecloud.io"
          value={env.host}
          disabled={disabled}
          onChange={(e) => onChange({ ...env, host: e.target.value })}
        />
      </label>
      <label>
        Client ID
        <input
          className="mono"
          value={env.clientId}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange({ ...env, clientId: e.target.value })}
        />
      </label>
      <label>
        Client secret
        <input
          className="mono"
          type="password"
          value={env.clientSecret}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange({ ...env, clientSecret: e.target.value })}
        />
      </label>
      <div className="inline-actions">
        <button
          className="secondary"
          disabled={disabled || !env.clientId || !env.clientSecret}
          onClick={testConnection}
        >
          {test === "testing" ? "Checking..." : "Check credentials"}
        </button>
        {test === "ok" && <span className="pill ok">Connected</span>}
        {test === "fail" && <span className="pill err">Failed</span>}
      </div>
    </section>
  );
}

export default function Home() {
  const marketplace = useMarketplaceClient();
  const [source, setSource] = useState<EnvCredentials>(EMPTY_ENV);
  const [target, setTarget] = useState<EnvCredentials>(EMPTY_ENV);
  const [database, setDatabase] = useState("master");
  const [trees, setTrees] = useState<DataTree[]>([{ ...EMPTY_TREE }]);
  const [blobName, setBlobName] = useState("");
  const [mode, setMode] = useState<TransferMode>("content-transfer");
  const [wizardStep, setWizardStep] = useState<WizardStep>("connect");
  const [steps, setSteps] = useState<RunStep[]>(emptySteps("content-transfer"));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.source) setSource(saved.source);
        if (saved.target) setTarget(saved.target);
        if (saved.database) setDatabase(saved.database);
        if (saved.trees?.length) setTrees(saved.trees);
        if (saved.blobName) setBlobName(saved.blobName);
        if (saved.mode === "content-transfer" || saved.mode === "item-transfer") {
          setMode(saved.mode);
          setSteps(emptySteps(saved.mode));
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ source, target, database, trees, blobName, mode })
      );
    } catch {
      /* storage may be unavailable in some embeds */
    }
  }, [source, target, database, trees, blobName, mode]);

  const validTrees = trees.filter((t) => t.ItemPath.trim().startsWith("/sitecore/"));
  const modeLabel =
    mode === "content-transfer" ? "Package from source" : "Import existing package";
  const ready =
    !running &&
    target.host &&
    target.clientId &&
    target.clientSecret &&
    (mode === "item-transfer"
      ? blobName.trim()
      : source.host && source.clientId && source.clientSecret && validTrees.length > 0);
  const pathError = validTrees.length === 0 && trees.some((t) => t.ItemPath.trim());

  const reviewItems = useMemo(
    () => [
      ["Flow", modeLabel],
      ["Target", target.host || "Not set"],
      ["Database", database],
      [
        "Content",
        mode === "item-transfer"
          ? blobName || "No package selected"
          : `${validTrees.length} path${validTrees.length === 1 ? "" : "s"}`,
      ],
    ],
    [blobName, database, mode, modeLabel, target.host, validTrees.length]
  );

  function selectMode(nextMode: TransferMode) {
    setMode(nextMode);
    setSteps(emptySteps(nextMode));
    setDone(false);
    setError(null);
    setWarnings([]);
  }

  function updateTree(index: number, patch: Partial<DataTree>) {
    setTrees((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function setStep(id: string, state: RunStep["state"], detail?: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s))
    );
  }

  async function start() {
    setRunning(true);
    setWizardStep("run");
    setError(null);
    setDone(false);
    setWarnings([]);
    setSteps(emptySteps(mode));
    try {
      const result =
        mode === "item-transfer"
          ? await runItemImport({ target, database, blobName: blobName.trim() }, { onStep: setStep })
          : await runTransfer(
              { source, target, database, dataTrees: validTrees },
              { onStep: setStep }
            );
      setWarnings(result.warnings);
      setDone(true);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      setSteps((prev) => {
        const active = prev.find((s) => s.state === "active");
        return active
          ? prev.map((s) => (s.id === active.id ? { ...s, state: "error" } : s))
          : prev;
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="brand-mark">SC</div>
        <div>
          <p className="eyebrow">Sync-Content beta</p>
          <h1>Move Sitecore content with a guided transfer checklist.</h1>
          <p className="hero-copy">
            Choose a source and target, pick the transfer approach, review the inputs, then run the
            package and import workflow.
          </p>
        </div>
        {marketplace.isEmbedded && (
          <span
            className={`pill marketplace ${
              marketplace.error ? "err" : marketplace.isInitialized ? "ok" : ""
            }`}
          >
            {marketplace.error
              ? "Marketplace unavailable"
              : marketplace.isInitialized
                ? marketplace.appContext?.name ?? "Marketplace connected"
                : "Connecting to Marketplace"}
          </span>
        )}
      </section>

      <div className="notice">
        Use lower environments and small item sets first. Credentials stay in this browser session
        and are only sent to this app&apos;s proxy routes.
      </div>

      <div className="wizard-layout">
        <nav className="rail" aria-label="Workflow sections">
          {wizardSteps.map((step) => (
            <button
              key={step.id}
              className={wizardStep === step.id ? "rail-step active" : "rail-step"}
              onClick={() => setWizardStep(step.id)}
            >
              <span>{step.label}</span>
            </button>
          ))}
        </nav>

        <section className="surface">
          <div className="section-title">
            <p>Step 1</p>
            <h2>Connect environments</h2>
          </div>
          <div className={mode === "item-transfer" ? "env-grid single" : "env-grid"}>
            {mode === "content-transfer" && (
              <EnvFields
                title="Source"
                helper="Environment that will create the transfer package."
                env={source}
                onChange={setSource}
                disabled={running}
              />
            )}
            <EnvFields
              title="Target"
              helper="Environment that will import the package."
              env={target}
              onChange={setTarget}
              disabled={running}
            />
          </div>

          <div className="section-title">
            <p>Step 2</p>
            <h2>Choose transfer approach</h2>
          </div>
          <div className="mode-grid">
            <button
              className={mode === "content-transfer" ? "mode-option selected" : "mode-option"}
              disabled={running}
              onClick={() => selectMode("content-transfer")}
            >
              <strong>Package from source</strong>
              <span>Content Transfer API creates the package; Sync-Content relays chunks and imports it.</span>
            </button>
            <button
              className={mode === "item-transfer" ? "mode-option selected" : "mode-option"}
              disabled={running}
              onClick={() => selectMode("item-transfer")}
            >
              <strong>Import existing package</strong>
              <span>Item Transfer API consumes a `.raif` that already exists on the target.</span>
            </button>
          </div>

          <div className="section-title">
            <p>Step 3</p>
            <h2>{mode === "content-transfer" ? "Select content" : "Select package"}</h2>
          </div>
          {mode === "content-transfer" ? (
            <div className="path-list">
              {trees.map((tree, i) => (
                <div className="tree-row" key={i}>
                  <input
                    className="mono"
                    placeholder="/sitecore/content/site/home"
                    value={tree.ItemPath}
                    disabled={running}
                    onChange={(e) => updateTree(i, { ItemPath: e.target.value })}
                  />
                  <select
                    value={tree.Scope}
                    disabled={running}
                    onChange={(e) => updateTree(i, { Scope: e.target.value as Scope })}
                  >
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {s === "SingleItem" ? "Item only" : "With descendants"}
                      </option>
                    ))}
                  </select>
                  <select
                    value={tree.MergeStrategy}
                    disabled={running}
                    onChange={(e) =>
                      updateTree(i, { MergeStrategy: e.target.value as MergeStrategy })
                    }
                  >
                    {MERGE_STRATEGIES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    title="Remove path"
                    disabled={running || trees.length === 1}
                    onClick={() => setTrees((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="inline-actions">
                <button
                  className="secondary"
                  disabled={running}
                  onClick={() => setTrees((p) => [...p, { ...EMPTY_TREE }])}
                >
                  Add another path
                </button>
                {pathError && <span className="pill err">Paths must start with /sitecore/</span>}
              </div>
            </div>
          ) : (
            <label className="package-field">
              Existing `.raif` blob name
              <input
                className="mono"
                placeholder="contentTransfer-transferId-chunkSetId.raif"
                value={blobName}
                disabled={running}
                onChange={(e) => setBlobName(e.target.value)}
              />
              <span>
                The package must already be available to the target Item Transfer API. Sync-Content
                does not upload arbitrary local files.
              </span>
            </label>
          )}

          <div className="section-title">
            <p>Step 4</p>
            <h2>Options and run</h2>
          </div>
          <div className="run-panel">
            <label>
              Database
              <select value={database} disabled={running} onChange={(e) => setDatabase(e.target.value)}>
                <option value="master">master</option>
                <option value="web">web</option>
                <option value="core">core</option>
              </select>
            </label>
            <button className="primary" disabled={!ready} onClick={start}>
              {running ? "Running transfer..." : "Start Sync-Content run"}
            </button>
          </div>

          {error && <div className="alert">{error}</div>}
          {done && warnings.length === 0 && (
            <div className="success">
              Transfer complete. Review the target Content Editor and publish when ready.
            </div>
          )}
          {done && warnings.length > 0 && (
            <div className="warning">
              Transfer finished with item-level warnings. Verify the target items, templates, and
              references before publishing.
              {warnings.map((w, i) => (
                <div className="step-detail" key={i}>
                  {w}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="summary">
          <h2>Review</h2>
          <dl>
            {reviewItems.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {mode === "content-transfer" && validTrees.length > 0 && (
            <ul className="review-paths">
              {validTrees.map((tree) => (
                <li key={`${tree.ItemPath}-${tree.Scope}-${tree.MergeStrategy}`}>
                  <span>{tree.ItemPath}</span>
                  <small>
                    {tree.Scope}, {tree.MergeStrategy}
                  </small>
                </li>
              ))}
            </ul>
          )}
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.id}>
                <span className={`dot ${s.state}`} />
                <span>
                  {s.label}
                  {s.detail && <div className="step-detail">{s.detail}</div>}
                </span>
              </li>
            ))}
          </ol>
          <p className="note">
            Sync-Content retries known transient Sitecore transfer states, including early status
            lookup misses and temporary target busy responses.
          </p>
        </aside>
      </div>

      <footer>
        Sync-Content uses Sitecore transfer APIs through local Next.js proxy routes. It is not
        affiliated with Sitecore.
      </footer>
    </main>
  );
}
