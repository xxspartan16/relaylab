import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileJson,
  FlaskConical,
  GitBranch,
  Info,
  Layers3,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { WorkflowGraph } from './components/WorkflowGraph';
import { EventLog } from './components/EventLog';
import { FIXTURES } from './domain/fixtures';
import { DEFAULT_OPTIONS } from './domain/types';
import type { LedgerEntry, RunOptions, RunResult, Workflow } from './domain/types';
import { initialState, replay, simulate } from './domain/engine';
import { parseWorkflow } from './domain/validate';

const initialRun = simulate(FIXTURES[0].workflow, DEFAULT_OPTIONS);
const stringify = (value: unknown) => JSON.stringify(value, null, 2);
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([stringify(value)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [workflow, setWorkflow] = useState<Workflow>(() => structuredClone(FIXTURES[0].workflow));
  const [options, setOptions] = useState<RunOptions>(DEFAULT_OPTIONS);
  const [fixtureId, setFixtureId] = useState('fulfillment');
  const [result, setResult] = useState<RunResult | null>(initialRun);
  const [cursor, setCursor] = useState(initialRun.events.length);
  const [selected, setSelected] = useState('payment');
  const [ledger, setLedger] = useState<LedgerEntry[]>(initialRun.ledger);
  const [reuseLedger, setReuseLedger] = useState(false);
  const [filterSelected, setFilterSelected] = useState(false);
  const [view, setView] = useState<'lab' | 'guide'>('lab');
  const [editor, setEditor] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editor && modalRef.current && !modalRef.current.open) modalRef.current.showModal();
  }, [editor]);
  const state = useMemo(
    () => (result ? replay(result.workflow, result.events, cursor) : initialState(workflow)),
    [workflow, result, cursor],
  );
  const selectedNode = workflow.nodes.find((n) => n.id === selected) ?? workflow.nodes[0];
  const nodeState = state.nodes[selectedNode.id];
  const visibleEvents = result?.events.slice(0, cursor) ?? [];
  const attempts = visibleEvents.filter((e) => e.type === 'node.started').length;
  const retries = visibleEvents.filter((e) => e.type === 'node.retry').length;
  const cached = visibleEvents.filter((e) => e.type === 'node.cached').length;
  const successes = Object.values(state.nodes).filter(
    (n) => n.status === 'succeeded' || n.status === 'cached',
  ).length;

  function invalidate() {
    setResult(null);
    setCursor(0);
    setError('');
    setNotice('Configuration changed. Run the simulation to see its effect.');
  }
  function chooseFixture(id: string) {
    const fixture = FIXTURES.find((f) => f.id === id)!;
    const next = structuredClone(fixture.workflow);
    setWorkflow(next);
    setFixtureId(id);
    setSelected(
      next.nodes.find((n) => n.failUntilAttempt || n.permanentFailure)?.id ?? next.nodes[0].id,
    );
    setOptions(DEFAULT_OPTIONS);
    setLedger([]);
    setReuseLedger(false);
    invalidate();
  }
  function run(step = false) {
    try {
      const next = simulate(workflow, options, reuseLedger ? ledger : []);
      setResult(next);
      setCursor(step ? 1 : next.events.length);
      setLedger(next.ledger);
      setError('');
      setNotice(
        step
          ? 'Paused at the first event. Step forward or drag the replay handle.'
          : `${next.status === 'succeeded' ? 'Run completed' : 'Run finished with failures'} in ${next.elapsedMs.toLocaleString()} ms of logical time.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation could not start.');
    }
  }
  function reset() {
    setResult(null);
    setCursor(0);
    setLedger([]);
    setReuseLedger(false);
    setNotice('Trace and session ledger cleared. Your workflow and settings are unchanged.');
    setError('');
  }
  function changeOption<K extends keyof RunOptions>(key: K, value: RunOptions[K]) {
    setOptions((o) => ({ ...o, [key]: value }));
    invalidate();
  }
  function changeNode(key: 'failUntilAttempt' | 'permanentFailure', value: number | boolean) {
    setWorkflow((w) => ({
      ...w,
      nodes: w.nodes.map((n) => (n.id === selectedNode.id ? { ...n, [key]: value } : n)),
    }));
    invalidate();
  }
  function openEditor() {
    setJsonText(stringify(workflow));
    setEditor(true);
    setError('');
    requestAnimationFrame(() => editorRef.current?.focus());
  }
  function applyJson() {
    try {
      const next = parseWorkflow(jsonText);
      setWorkflow(next);
      setSelected(next.nodes[0].id);
      setFixtureId('custom');
      setLedger([]);
      setEditor(false);
      invalidate();
      setNotice('Custom workflow validated. It is ready to simulate.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid workflow.');
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 200_000) {
      setError('Workflow exceeds the 200 KB import limit.');
      return;
    }
    try {
      const next = parseWorkflow(await file.text());
      setWorkflow(next);
      setSelected(next.nodes[0].id);
      setFixtureId('custom');
      setLedger([]);
      invalidate();
      setNotice(`Imported ${next.name}. Ready to simulate.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('lab');
          }}
          aria-label="Relaylab home"
        >
          <span className="brand-mark">
            <GitBranch size={22} />
          </span>
          <span>
            relaylab<span className="brand-dot">.</span>
          </span>
          <small>LAB</small>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={view === 'lab' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('lab')}
          >
            <FlaskConical size={17} /> Simulation lab <span className="nav-dot" />
          </button>
          <button
            className={view === 'guide' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('guide')}
          >
            <BookOpen size={17} /> Field notes
          </button>
        </nav>
        <div className="sidebar-label scenarios-title">
          SCENARIOS <span>03</span>
        </div>
        <div className="scenario-list">
          {FIXTURES.map((f) => (
            <button
              key={f.id}
              className={`scenario ${fixtureId === f.id ? 'chosen' : ''}`}
              onClick={() => {
                chooseFixture(f.id);
                setView('lab');
              }}
            >
              <span className="scenario-icon">
                <GitBranch size={15} />
              </span>
              <span>
                <strong>{f.workflow.name}</strong>
                <small>{f.eyebrow}</small>
              </span>
            </button>
          ))}
        </div>
        <button className="import-nav" onClick={() => fileInput.current?.click()}>
          <Upload size={14} /> Import workflow <span>.json</span>
        </button>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <span /> Local simulation
          </div>
          <p>
            No API calls. No real side effects.
            <br />
            Your data stays in this tab.
          </p>
          <div className="author">
            <span className="avatar">BL</span>
            <span>
              <strong>Brennan LeBlanc</strong>
              <small>Personal software project</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            <span className="muted">Workspace</span>
            <span className="slash">/</span>
            {view === 'lab' ? 'Simulation lab' : 'Field notes'}
          </span>
          <div>
            <span className="version">v0.1</span>
            <button className="topbar-link" onClick={() => setView('guide')}>
              <BookOpen size={14} /> Field notes <ArrowRight size={13} />
            </button>
          </div>
        </header>
        <main>
          {view === 'guide' ? (
            <section className="guide">
              <div className="eyebrow">
                <BookOpen size={14} /> ENGINEERING FIELD NOTES
              </div>
              <h1>
                What happens between
                <br />
                “try again” and “done”?
              </h1>
              <p className="guide-lead">
                Retries look simple until a payment succeeds twice, a dependency never finishes, or
                a replay changes the outcome. Relaylab makes those decisions inspectable.
              </p>
              <div className="guide-grid">
                <article>
                  <span>01</span>
                  <h2>A clock you can trust</h2>
                  <p>
                    The engine uses logical time. A node with a 300 ms duration advances the
                    scheduler by 300 simulated milliseconds, without waiting. Identical workflows,
                    settings, seed, and starting ledger produce identical events.
                  </p>
                </article>
                <article>
                  <span>02</span>
                  <h2>Failure has a shape</h2>
                  <p>
                    Transient failures consume the retry budget. Permanent failures stop
                    immediately. Dependent nodes are blocked; unrelated branches continue. Jitter is
                    a seeded, positive addition to exponential backoff.
                  </p>
                </article>
                <article>
                  <span>03</span>
                  <h2>One key, one intent</h2>
                  <p>
                    The ledger fingerprints the operation and canonical JSON input. A repeated key
                    with the same intent reuses a result. A changed payload is a conflict.
                    Concurrent duplicates wait for the first attempt’s outcome.
                  </p>
                </article>
                <article>
                  <span>04</span>
                  <h2>Replay, not re-execution</h2>
                  <p>
                    The replay slider folds an immutable event log into node state. Moving the
                    slider never performs work. This simulator has no durable workers, real HTTP
                    requests, or exactly-once delivery guarantee.
                  </p>
                </article>
              </div>
              <div className="guide-callout">
                <Info size={22} />
                <div>
                  <h3>Use synthetic or non-sensitive fixtures</h3>
                  <p>
                    All bundled examples are synthetic. The tab holds the trace and ledger in
                    memory; reloading clears them. Export a trace before closing if you need to keep
                    it.
                  </p>
                </div>
              </div>
              <button className="primary" onClick={() => setView('lab')}>
                Open the simulation lab <ArrowRight size={16} />
              </button>
            </section>
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> WORKFLOW RELIABILITY LAB
                  </div>
                  <h1>Make failures explain themselves.</h1>
                  <p>Inject a failure. Follow the retry. Replay every decision.</p>
                </div>
                <button
                  className="secondary export-button"
                  disabled={!result}
                  onClick={() => result && download('relaylab-trace.json', result)}
                >
                  <ArrowDownToLine size={15} /> Export trace
                </button>
              </section>
              <div className="mobile-scenarios">
                <label>
                  SCENARIO
                  <select
                    aria-label="Choose scenario"
                    value={fixtureId}
                    onChange={(e) => chooseFixture(e.target.value)}
                  >
                    {fixtureId === 'custom' ? (
                      <option value="custom">Custom workflow</option>
                    ) : null}
                    {FIXTURES.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.workflow.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary" onClick={() => fileInput.current?.click()}>
                  <Upload size={13} /> Import JSON
                </button>
              </div>
              <section className="workflow-heading">
                <div>
                  <span className="workflow-icon">
                    <GitBranch size={20} />
                  </span>
                  <div>
                    <h2>
                      {workflow.name}
                      <span className="tag">
                        {fixtureId === 'custom' ? 'CUSTOM WORKFLOW' : 'SYNTHETIC SCENARIO'}
                      </span>
                    </h2>
                    <p>{workflow.description}</p>
                  </div>
                </div>
                <button
                  className="icon-button"
                  aria-label="Edit workflow JSON"
                  onClick={openEditor}
                >
                  <Braces size={17} />
                </button>
              </section>
              <section className="run-controls" aria-label="Simulation settings">
                <label>
                  CONCURRENCY
                  <select
                    value={options.concurrency}
                    onChange={(e) => changeOption('concurrency', Number(e.target.value))}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'worker' : 'workers'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  MAX ATTEMPTS
                  <select
                    value={options.maxAttempts}
                    onChange={(e) => changeOption('maxAttempts', Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'attempt' : 'attempts'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  BASE BACKOFF
                  <select
                    value={options.baseDelayMs}
                    onChange={(e) => changeOption('baseDelayMs', Number(e.target.value))}
                  >
                    {[0, 100, 400, 800, 1500].map((n) => (
                      <option key={n} value={n}>
                        {n} ms
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  JITTER
                  <select
                    value={options.jitterFraction}
                    onChange={(e) => changeOption('jitterFraction', Number(e.target.value))}
                  >
                    {[0, 0.1, 0.2, 0.5, 1].map((n) => (
                      <option key={n} value={n}>
                        +0–{n * 100}%
                      </option>
                    ))}
                  </select>
                </label>
                <label className="seed-field">
                  SEED
                  <input
                    type="number"
                    value={options.seed}
                    min="0"
                    max="4294967295"
                    onChange={(e) => changeOption('seed', Number(e.target.value))}
                  />
                </label>
                <div className="run-actions">
                  <button
                    className="icon-button"
                    aria-label="Reset trace and ledger"
                    onClick={reset}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button className="primary" onClick={() => run()}>
                    <Play size={15} fill="currentColor" /> Run simulation
                  </button>
                </div>
              </section>
              {error && !editor ? (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              ) : null}
              <div className="workbench-grid">
                <section className="graph-panel">
                  <div className="panel-heading">
                    <h3>
                      <Layers3 size={15} /> Workflow map
                    </h3>
                    <span className={`status-pill ${state.status}`}>
                      <span />
                      {state.status === 'idle'
                        ? 'Ready'
                        : state.status === 'running'
                          ? 'Replaying'
                          : state.status === 'succeeded'
                            ? 'Completed'
                            : 'Failed'}
                    </span>
                  </div>
                  <WorkflowGraph
                    workflow={workflow}
                    state={state}
                    selected={selectedNode.id}
                    onSelect={setSelected}
                  />
                  <div className="graph-footer">
                    <span>
                      <i className="legend-dot completed" />
                      Completed
                    </span>
                    <span>
                      <i className="legend-dot retry" />
                      Retry
                    </span>
                    <span>
                      <i className="legend-dot failed" />
                      Failed / blocked
                    </span>
                    <span className="legend-note">
                      <ShieldCheck size={12} /> Idempotent step
                    </span>
                  </div>
                  <div className="replay-controls">
                    <button
                      className="icon-button"
                      aria-label="Previous event"
                      disabled={!result || cursor === 0}
                      onClick={() => setCursor((c) => Math.max(0, c - 1))}
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Step to next event"
                      disabled={!!result && cursor === result.events.length}
                      onClick={() =>
                        result ? setCursor((c) => Math.min(result.events.length, c + 1)) : run(true)
                      }
                    >
                      <SkipForward size={15} />
                    </button>
                    <div className="replay-track">
                      <div>
                        <span>REPLAY TIMELINE</span>
                        <span>
                          {cursor} / {result?.events.length ?? 0} events
                        </span>
                      </div>
                      <input
                        aria-label="Replay event"
                        type="range"
                        min="0"
                        max={result?.events.length ?? 0}
                        value={cursor}
                        disabled={!result}
                        onChange={(e) => setCursor(Number(e.target.value))}
                      />
                    </div>
                    <div className="logical-clock">
                      <Clock3 size={13} />
                      <strong>{state.at.toLocaleString()}</strong>
                      <span>ms</span>
                    </div>
                  </div>
                </section>
                <aside className="inspector">
                  <div className="panel-heading">
                    <h3>
                      <Settings2 size={15} /> Step inspector
                    </h3>
                    <span className="small-label">SELECT A NODE</span>
                  </div>
                  <div className="inspector-body">
                    <div className={`inspector-status ${nodeState?.status ?? 'pending'}`}>
                      <span />
                      {nodeState?.status ?? 'pending'}
                    </div>
                    <h3>{selectedNode.label}</h3>
                    <code>{selectedNode.id}</code>
                    <div className="inspector-facts">
                      <span>
                        Duration<strong>{selectedNode.durationMs} ms</strong>
                      </span>
                      <span>
                        Attempts
                        <strong>
                          {nodeState?.attempts ?? 0} / {options.maxAttempts}
                        </strong>
                      </span>
                    </div>
                    <div className="divider" />
                    <label className="failure-label">
                      INJECT TRANSIENT FAILURES
                      <select
                        value={selectedNode.failUntilAttempt}
                        onChange={(e) => changeNode('failUntilAttempt', Number(e.target.value))}
                      >
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>
                            {n === 0 ? 'None' : `First ${n} ${n === 1 ? 'attempt' : 'attempts'}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={selectedNode.permanentFailure}
                        onChange={(e) => changeNode('permanentFailure', e.target.checked)}
                      />{' '}
                      Permanent failure<span>Never retry</span>
                    </label>
                    <div className="divider" />
                    <h4>INPUT PAYLOAD</h4>
                    <pre>{stringify(selectedNode.input)}</pre>
                    {selectedNode.idempotencyKey ? (
                      <div className="key-box">
                        <ShieldCheck size={13} />
                        <span>
                          <small>IDEMPOTENCY KEY</small>
                          <code>{selectedNode.idempotencyKey}</code>
                        </span>
                      </div>
                    ) : (
                      <p className="no-key">No idempotency key for this step.</p>
                    )}
                    {nodeState?.error ? <p className="node-error">{nodeState.error}</p> : null}
                    {nodeState?.output ? (
                      <details className="output-details">
                        <summary>
                          Recorded output <ChevronDown size={13} />
                        </summary>
                        <pre>{stringify(nodeState.output)}</pre>
                      </details>
                    ) : null}
                  </div>
                </aside>
              </div>
              <section className="metrics" aria-label="Trace metrics">
                <div>
                  <span>
                    <Check size={14} /> COMPLETED STEPS
                  </span>
                  <strong>
                    {successes}
                    <small> / {workflow.nodes.length}</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Activity size={14} /> EXECUTED ATTEMPTS
                  </span>
                  <strong>{attempts}</strong>
                </div>
                <div>
                  <span>
                    <RotateCcw size={14} /> SCHEDULED RETRIES
                  </span>
                  <strong className={retries ? 'amber' : ''}>{retries}</strong>
                </div>
                <div>
                  <span>
                    <ShieldCheck size={14} /> REUSED RESULTS
                  </span>
                  <strong>{cached}</strong>
                </div>
              </section>
              <section className="trace-panel">
                <div className="panel-heading">
                  <h3>
                    <Terminal size={15} /> Event trace{' '}
                    <span className="count-badge">{result?.events.length ?? 0}</span>
                  </h3>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={filterSelected}
                      onChange={(e) => setFilterSelected(e.target.checked)}
                    />{' '}
                    Selected step only
                  </label>
                </div>
                <EventLog
                  events={result?.events ?? []}
                  cursor={cursor}
                  selected={filterSelected ? selectedNode.id : null}
                  onSeek={setCursor}
                />
              </section>
              <section className="ledger-bar">
                <div>
                  <ShieldCheck size={17} />
                  <span>
                    <strong>Session idempotency ledger</strong>
                    <small>
                      {ledger.length} recorded {ledger.length === 1 ? 'key' : 'keys'} · in memory
                      until this tab closes
                    </small>
                  </span>
                </div>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={reuseLedger}
                    onChange={(e) => setReuseLedger(e.target.checked)}
                  />{' '}
                  Reuse on next run
                </label>
                <button
                  className="text-button"
                  disabled={!ledger.length}
                  onClick={() => {
                    setLedger([]);
                    setNotice('Session ledger cleared.');
                  }}
                >
                  Clear ledger
                </button>
              </section>
              <div className="notice" role="status" aria-live="polite">
                <Info size={13} />
                <span>
                  {notice ||
                    'The initial trace is a synthetic demonstration. Change a setting or step to explore a new outcome.'}
                </span>
              </div>
            </>
          )}
          <footer>
            <span>Built to make the invisible parts of automation visible.</span>
            <span>
              Deterministic engine <span className="footer-dot">·</span> No backend required
            </span>
          </footer>
        </main>
      </div>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-label="Import workflow file"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {editor ? (
        <dialog
          ref={modalRef}
          className="editor-overlay"
          aria-labelledby="editor-title"
          onCancel={() => {
            setEditor(false);
            setError('');
          }}
        >
          <section
            className="editor-dialog"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditor(false);
                setError('');
              }
            }}
          >
            <div className="panel-heading">
              <h2 id="editor-title">
                <FileJson size={18} /> Workflow definition
              </h2>
              <button
                className="icon-button"
                aria-label="Close editor"
                onClick={() => {
                  setEditor(false);
                  setError('');
                }}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Edit the dependency graph and simulated operations. Imports are validated before
              replacing your workflow.
            </p>
            <textarea
              ref={editorRef}
              aria-label="Workflow JSON"
              spellCheck={false}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            <div className="editor-status">
              schemaVersion: 1 · Up to 30 nodes · No cycles · 200 KB limit
            </div>
            {error ? (
              <div className="error-banner" role="alert">
                {error}
              </div>
            ) : null}
            <div className="editor-actions">
              <button
                className="secondary"
                onClick={() => download('relaylab-workflow.json', workflow)}
              >
                <ArrowDownToLine size={14} /> Export workflow
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(jsonText);
                    setNotice('Workflow JSON copied.');
                  } catch {
                    setError('Clipboard is unavailable. Select the JSON text to copy it manually.');
                  }
                }}
              >
                <Copy size={14} /> Copy
              </button>
              <button className="primary" onClick={applyJson}>
                Validate & apply <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </dialog>
      ) : null}
    </div>
  );
}
