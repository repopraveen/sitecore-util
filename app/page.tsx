"use client";

import { useEffect, useState } from "react";
import type { DataTree, EnvCredentials, MergeStrategy, RunStep, Scope } from "@/lib/types";
import { getToken, runTransfer } from "@/lib/runner";

const EMPTY_ENV: EnvCredentials = { host: "", clientId: "", clientSecret: "" };
const EMPTY_TREE: DataTree = {
  ItemPath: "",
  Scope: "SingleItem",
  MergeStrategy: "OverrideExistingItem",
};

const SCOPES: Scope[] = ["SingleItem", "ItemAndDescendants"];
// "LatestWin" is deliberately excluded: as of July 2026 it is NOT implemented
// server-side ("Strategy 'LatestWin' is not yet implemented", Sitecore.Kernel)
// and using it can crash the CM environment. It is also rejected by our
// /api/transfer/initiate route. Re-add here once Sitecore confirms a fix.
const MERGE_STRATEGIES: MergeStrategy[] = [
  "OverrideExistingItem",
  "KeepExistingItem",
  "OverrideExistingTree",
];

const INITIAL_STEPS: RunStep[] = [
  { id: "auth", label: "Authenticate source & target", state: "pending" },
  { id: "initiate", label: "Initiate transfer on source", state: "pending" },
  { id: "status", label: "Wait for source to package content", state: "pending" },
  { id: "relay", label: "Relay chunks source → target", state: "pending" },
  { id: "complete", label: "Assemble .raif file on target", state: "pending" },
  { id: "consume", label: "Consume .raif into content tree", state: "pending" },
  { id: "verify", label: "Verify blob transfer", state: "pending" },
];

const STORAGE_KEY = "content-courier";
const THEME_KEY = "content-courier-theme";

type Theme = "light" | "dark";
type TestState = "idle" | "testing" | "ok" | "fail";

function EnvFields({
  title,
  env,
  onChange,
  disabled,
}: {
  title: string;
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
    <fieldset>
      <legend>{title}</legend>
      <label>CM host</label>
      <input
        className="mono"
        placeholder="https://xmc-yourorg-project-env.sitecorecloud.io"
        value={env.host}
        disabled={disabled}
        onChange={(e) => onChange({ ...env, host: e.target.value })}
      />
      <label>Client ID</label>
      <input
        className="mono"
        value={env.clientId}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => onChange({ ...env, clientId: e.target.value })}
      />
      <label>Client secret</label>
      <input
        className="mono"
        type="password"
        value={env.clientSecret}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => onChange({ ...env, clientSecret: e.target.value })}
      />
      <div className="row mt">
        <button
          className="small"
          disabled={disabled || !env.clientId || !env.clientSecret}
          onClick={testConnection}
        >
          {test === "testing" ? "Testing…" : "Test connection"}
        </button>
        {test === "ok" && <span className="badge ok">✓ Authenticated</span>}
        {test === "fail" && <span className="badge err">✕ Auth failed</span>}
      </div>
    </fieldset>
  );
}

export default function Home() {
  const [source, setSource] = useState<EnvCredentials>(EMPTY_ENV);
  const [target, setTarget] = useState<EnvCredentials>(EMPTY_ENV);
  const [database, setDatabase] = useState("master");
  const [trees, setTrees] = useState<DataTree[]>([{ ...EMPTY_TREE }]);
  const [steps, setSteps] = useState<RunStep[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>("light");

  // Theme: default light, remembered across visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  // Restore session-scoped settings (never persisted beyond the browser tab session).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.source) setSource(saved.source);
        if (saved.target) setTarget(saved.target);
        if (saved.database) setDatabase(saved.database);
        if (saved.trees?.length) setTrees(saved.trees);
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ source, target, database, trees }));
    } catch {
      /* storage may be unavailable in some embeds */
    }
  }, [source, target, database, trees]);

  const validTrees = trees.filter((t) => t.ItemPath.trim().startsWith("/sitecore/"));
  const ready =
    !running &&
    source.host &&
    source.clientId &&
    source.clientSecret &&
    target.host &&
    target.clientId &&
    target.clientSecret &&
    validTrees.length > 0;

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
    setError(null);
    setDone(false);
    setWarnings([]);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, detail: undefined })));
    try {
      const result = await runTransfer(
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
        return active ? prev.map((s) => (s.id === active.id ? { ...s, state: "error" } : s)) : prev;
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="container">
      <header className="app">
        <div className="logo">CC</div>
        <h1>Content Courier</h1>
        <span className="beta">BETA</span>
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>
            ☀ Light
          </button>
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>
            ☾ Dark
          </button>
        </div>
      </header>
      <p className="tagline">
        You pick it. We move it. — Transfer content between SitecoreAI environments with the
        Content Transfer &amp; Item Transfer APIs.
      </p>
      <div className="beta-note">
        ⚠ Beta: this tool hasn&apos;t been tested for all scenarios yet. Try it on a lower
        environment with a few small items before moving anything significant.
      </div>

      <div className="card">
        <h2>
          <span className="stepnum">1</span> Environments
        </h2>
        <p className="hint">
          OAuth client credentials for each environment (created in the Sitecore Cloud Portal /
          Deploy app). Stored in this browser tab only — never on any server.
        </p>
        <div className="grid2">
          <EnvFields title="Source (from)" env={source} onChange={setSource} disabled={running} />
          <EnvFields title="Target (to)" env={target} onChange={setTarget} disabled={running} />
        </div>
      </div>

      <div className="card">
        <h2>
          <span className="stepnum">2</span> Content to move
        </h2>
        <p className="hint">
          One row per content tree. Paths exactly as shown in the Content Editor, e.g.{" "}
          <code>/sitecore/content/MySite/Home</code>.
        </p>
        {trees.map((tree, i) => (
          <div className="tree-row" key={i}>
            <input
              className="mono"
              placeholder="/sitecore/content/…"
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
                  {s === "SingleItem" ? "Item only" : "Item + descendants"}
                </option>
              ))}
            </select>
            <select
              value={tree.MergeStrategy}
              disabled={running}
              onChange={(e) => updateTree(i, { MergeStrategy: e.target.value as MergeStrategy })}
            >
              {MERGE_STRATEGIES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              className="ghost small"
              title="Remove row"
              disabled={running || trees.length === 1}
              onClick={() => setTrees((prev) => prev.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="row spread mt">
          <button className="small" disabled={running} onClick={() => setTrees((p) => [...p, { ...EMPTY_TREE }])}>
            + Add item path
          </button>
          <div className="row">
            <label style={{ margin: 0 }}>Database</label>
            <select value={database} disabled={running} onChange={(e) => setDatabase(e.target.value)} style={{ width: 130 }}>
              <option value="master">master</option>
              <option value="web">web</option>
              <option value="core">core</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          <span className="stepnum">3</span> Run transfer
        </h2>
        <p className="hint">
          The full pipeline runs step by step: initiate → package → relay chunks → assemble .raif →
          consume → verify.
        </p>
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.id}>
              <span className={`dot ${s.state}`}>
                {s.state === "done" ? "✓" : s.state === "warn" || s.state === "error" ? "!" : ""}
              </span>
              <span>
                {s.label}
                {s.detail && <div className="step-detail">{s.detail}</div>}
              </span>
            </li>
          ))}
        </ol>
        <div className="row mt">
          <button className="primary" disabled={!ready} onClick={start}>
            {running ? "Transferring…" : "Start transfer"}
          </button>
          {validTrees.length === 0 && trees.some((t) => t.ItemPath.trim()) && (
            <span className="badge err">Paths must start with /sitecore/</span>
          )}
        </div>
        {error && <div className="alert">⚠ {error}</div>}
        {done && warnings.length === 0 && (
          <div className="success">
            ✓ Transfer complete — content is now in the target environment. Review it in the
            Content Editor and publish when ready.
          </div>
        )}
        {done && warnings.length > 0 && (
          <div className="warning">
            ⚠ Transfer finished with errors — the .raif was consumed and content should be in the
            target, but some items reported issues. Verify them in the target Content Editor
            (common causes: templates or referenced items missing on the target — include them in
            the transfer, or use &quot;Item + descendants&quot;).
            {warnings.map((w, i) => (
              <div className="step-detail" key={i} style={{ marginTop: 6 }}>
                {w}
              </div>
            ))}
          </div>
        )}
        <p className="note">
          Heads up: right after initiation, Sitecore&apos;s status endpoint can transiently report
          &quot;not found&quot; (known issue CFW-9663). Content Courier keeps polling
          automatically.
        </p>
      </div>

      <footer>
        Content Courier is an open-source interim tool while Sitecore builds its official content
        migration app. Not affiliated with Sitecore.
      </footer>
    </div>
  );
}
