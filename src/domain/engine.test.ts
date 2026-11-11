import { describe, expect, it } from 'vitest';
import { canonicalJson, replay, simulate } from './engine';
import { FIXTURES } from './fixtures';
import { DEFAULT_OPTIONS } from './types';
import type { JsonValue, Workflow, WorkflowNode } from './types';
import { parseWorkflow, topologicalOrder, validateWorkflow } from './validate';
const n = (
  id: string,
  dependsOn: string[] = [],
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  label: id,
  operation: id,
  dependsOn,
  durationMs: 100,
  input: { x: 1 },
  failUntilAttempt: 0,
  permanentFailure: false,
  ...extra,
});
const w = (...nodes: WorkflowNode[]): Workflow => ({
  schemaVersion: 1,
  name: 'Test flow',
  description: 'Synthetic test',
  nodes,
});
const opts = { ...DEFAULT_OPTIONS, jitterFraction: 0, baseDelayMs: 100 };
describe('dependency validation', () => {
  it('rejects cyclic dependencies', () =>
    expect(() => validateWorkflow(w(n('a', ['b']), n('b', ['a'])))).toThrow(/cycle/));
  it('rejects self loops', () => expect(() => validateWorkflow(w(n('a', ['a'])))).toThrow(/cycle/));
  it('rejects duplicate node ids', () =>
    expect(() => validateWorkflow(w(n('a'), n('a')))).toThrow(/Duplicate/));
  it('rejects missing dependencies', () =>
    expect(() => validateWorkflow(w(n('a', ['missing'])))).toThrow(/missing/));
  it('rejects duplicate dependency declarations', () =>
    expect(() => validateWorkflow(w(n('a'), n('b', ['a', 'a'])))).toThrow(/unique/));
  it('sorts deterministic ready nodes regardless of array order', () =>
    expect(topologicalOrder([n('c', ['a']), n('b'), n('a')]).map((v) => v.id)).toEqual([
      'a',
      'b',
      'c',
    ]));
  it('rejects unknown schema versions and unknown fields', () => {
    expect(() => validateWorkflow({ ...w(n('a')), schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => validateWorkflow({ ...w(n('a')), surprise: true })).toThrow(/unknown field/);
  });
  it('rejects malformed JSON and oversize imports', () => {
    expect(() => parseWorkflow('{oops}')).toThrow(/Invalid JSON/);
    expect(() => parseWorkflow(' '.repeat(200001))).toThrow(/200 KB/);
  });
  it('rejects nonfinite inputs and zero-duration nodes', () => {
    expect(() => validateWorkflow(w(n('a', [], { input: Infinity })))).toThrow(/finite JSON/);
    expect(() => validateWorkflow(w(n('a', [], { durationMs: 0 })))).toThrow(/durationMs/);
  });
  it('rejects reserved keys in imported payloads', () =>
    expect(() =>
      parseWorkflow(
        JSON.stringify(w(n('a', [], { input: JSON.parse('{"__proto__":{"polluted":true}}') }))),
      ),
    ).toThrow(/reserved/));
  it('accepts null input and returns an independent validated copy', () => {
    const original = w(n('a', [], { input: null }));
    const cloned = validateWorkflow(original);
    cloned.nodes[0].label = 'changed';
    expect(original.nodes[0].label).toBe('a');
  });
});
describe('discrete-event scheduler', () => {
  it('runs independent nodes in parallel within the concurrency cap', () => {
    const flow = w(n('a'), n('b'), n('c'));
    expect(simulate(flow, { ...opts, concurrency: 2 }).elapsedMs).toBe(200);
    expect(simulate(flow, { ...opts, concurrency: 1 }).elapsedMs).toBe(300);
  });
  it('starts dependents only after all parents complete', () => {
    const run = simulate(
      w(n('a', [], { durationMs: 100 }), n('b', [], { durationMs: 250 }), n('c', ['a', 'b'])),
      opts,
    );
    expect(run.events.find((e) => e.nodeId === 'c' && e.type === 'node.started')?.at).toBe(250);
    expect(run.elapsedMs).toBe(350);
  });
  it('retries with exact exponential backoff and inclusive maximum attempts', () => {
    const run = simulate(w(n('a', [], { failUntilAttempt: 2 })), opts);
    expect(run.events.filter((e) => e.type === 'node.started').map((e) => e.at)).toEqual([
      0, 200, 500,
    ]);
    expect(run.elapsedMs).toBe(600);
    expect(run.status).toBe('succeeded');
  });
  it('handles zero retry delay without deadlocking', () => {
    const run = simulate(w(n('a', [], { failUntilAttempt: 2 })), { ...opts, baseDelayMs: 0 });
    expect(run.elapsedMs).toBe(300);
    expect(run.status).toBe('succeeded');
  });
  it('never retries permanent errors', () => {
    const run = simulate(w(n('a', [], { permanentFailure: true })), opts);
    expect(run.events.filter((e) => e.type === 'node.started')).toHaveLength(1);
    expect(run.events.some((e) => e.type === 'node.retry')).toBe(false);
    expect(run.status).toBe('failed');
  });
  it('exhausts the retry budget then blocks descendants', () => {
    const run = simulate(
      w(n('a', [], { failUntilAttempt: 8 }), n('b', ['a']), n('c', ['b']), n('independent')),
      opts,
    );
    const state = replay(run.workflow, run.events);
    expect(state.nodes.a.attempts).toBe(3);
    expect(state.nodes.b.status).toBe('blocked');
    expect(state.nodes.c.status).toBe('blocked');
    expect(state.nodes.independent.status).toBe('succeeded');
  });
  it('produces identical seeded event traces', () => {
    const a = simulate(FIXTURES[0].workflow, DEFAULT_OPTIONS);
    const b = simulate(FIXTURES[0].workflow, DEFAULT_OPTIONS);
    expect(a).toEqual(b);
    const c = simulate(FIXTURES[0].workflow, { ...DEFAULT_OPTIONS, seed: 999 });
    expect(a.events).not.toEqual(c.events);
  });
  it('never exceeds configured concurrency', () => {
    const run = simulate(
      w(
        ...Array.from({ length: 8 }, (_, i) =>
          n(`job${i}`, [], { durationMs: 100 + i * 50, failUntilAttempt: i % 2 }),
        ),
      ),
      { ...opts, concurrency: 3 },
    );
    let active = 0;
    let peak = 0;
    for (const event of run.events) {
      if (event.type === 'node.started') {
        active++;
        peak = Math.max(peak, active);
      }
      if (['node.succeeded', 'node.failed', 'node.retry'].includes(event.type)) active--;
    }
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });
  it('validates configuration boundaries before executing', () => {
    expect(() => simulate(w(n('a')), { ...opts, concurrency: 0 })).toThrow(/Concurrency/);
    expect(() => simulate(w(n('a')), { ...opts, seed: NaN })).toThrow(/Seed/);
    expect(() => simulate(w(n('a')), { ...opts, maxAttempts: 0 })).toThrow(/attempts/);
  });
  it('does not mutate input workflow or options', () => {
    const flow = structuredClone(FIXTURES[0].workflow);
    const before = structuredClone(flow);
    const config = { ...opts };
    simulate(flow, config);
    expect(flow).toEqual(before);
    expect(config).toEqual(opts);
  });
});
describe('idempotency intent and reuse', () => {
  const task = (
    id: string,
    input: WorkflowNode['input'] = { amount: 42 },
    dependsOn: string[] = [],
  ) => n(id, dependsOn, { operation: 'capture', idempotencyKey: 'capture:demo', input });
  it('serializes object keys canonically while preserving array order', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('coalesces concurrent duplicate deliveries before a ledger result exists', () => {
    const run = simulate(w(task('a'), task('b')), opts);
    expect(run.events.filter((e) => e.type === 'node.started')).toHaveLength(1);
    expect(run.events.filter((e) => e.type === 'node.cached')).toHaveLength(1);
    expect(run.elapsedMs).toBe(100);
  });
  it('holds ownership while the original attempt waits to retry', () => {
    const run = simulate(w({ ...task('a'), failUntilAttempt: 1 }, task('b')), opts);
    expect(run.events.filter((e) => e.nodeId === 'b' && e.type === 'node.started')).toHaveLength(0);
    expect(replay(run.workflow, run.events).nodes.b.status).toBe('cached');
  });
  it('rejects a changed payload before executing a duplicate side effect', () => {
    const run = simulate(w(task('a'), task('b', { amount: 99 })), opts);
    expect(run.events.filter((e) => e.nodeId === 'b' && e.type === 'node.started')).toHaveLength(0);
    expect(replay(run.workflow, run.events).nodes.b.status).toBe('failed');
  });
  it('rejects the same key reused for a different operation', () => {
    const run = simulate(w(task('a'), { ...task('b'), operation: 'refund' }), opts);
    expect(run.status).toBe('failed');
  });
  it('reuses matching persisted-in-session results without work', () => {
    const flow = w(task('a'));
    const first = simulate(flow, opts);
    const before = structuredClone(first.ledger);
    const next = simulate(flow, opts, first.ledger);
    expect(next.elapsedMs).toBe(0);
    expect(next.events.some((e) => e.type === 'node.started')).toBe(false);
    expect(first.ledger).toEqual(before);
  });
  it('does not cache failed attempts', () => {
    const first = simulate(w({ ...task('a'), permanentFailure: true }), opts);
    expect(first.ledger).toHaveLength(0);
    const next = simulate(w(task('a')), opts, first.ledger);
    expect(next.elapsedMs).toBe(100);
  });
  it('checks canonical payload identity when reusing an earlier run ledger', () => {
    const first = simulate(w(task('a', { a: 1, b: 2 })), opts);
    expect(simulate(w(task('a', { b: 2, a: 1 })), opts, first.ledger).status).toBe('succeeded');
    expect(simulate(w(task('a', { b: 2, a: 2 })), opts, first.ledger).status).toBe('failed');
  });
  it('rejects nonfinite cached output instead of corrupting JSON export', () => {
    const first = simulate(w(task('a')), opts);
    expect(() => simulate(w(task('a')), opts, [{ ...first.ledger[0], output: NaN }])).toThrow(
      /Invalid ledger/,
    );
  });
  it('can reuse the deepest allowed input after it is wrapped in output metadata', () => {
    let input: JsonValue = 1;
    for (let i = 0; i < 20; i++) input = { nested: input };
    const flow = w(task('a', input));
    const first = simulate(flow, opts);
    expect(simulate(flow, opts, first.ledger).elapsedMs).toBe(0);
  });
  it('rejects ambiguous duplicate entries in imported engine ledgers', () => {
    const first = simulate(w(task('a')), opts);
    expect(() => simulate(w(task('a')), opts, [...first.ledger, ...first.ledger])).toThrow(
      /Duplicate key/,
    );
  });
});
describe('event replay', () => {
  it('can reconstruct any prefix without changing the original trace', () => {
    const run = simulate(FIXTURES[0].workflow, DEFAULT_OPTIONS);
    const before = structuredClone(run);
    const initial = replay(run.workflow, run.events, 0);
    expect(initial.status).toBe('idle');
    expect(Object.values(initial.nodes).every((n) => n.status === 'pending')).toBe(true);
    const started = run.events.findIndex((e) => e.type === 'node.started');
    const state = replay(run.workflow, run.events, started + 1);
    expect(state.nodes[run.events[started].nodeId!].status).toBe('running');
    expect(run).toEqual(before);
  });
  it('clamps replay endpoints and returns isolated output objects', () => {
    const run = simulate(w(n('a')), opts);
    const final = replay(run.workflow, run.events, 999);
    expect(final.status).toBe('succeeded');
    (final.nodes.a.output as Record<string, unknown>).input = 'changed';
    expect(replay(run.workflow, run.events).nodes.a.output).not.toEqual(final.nodes.a.output);
    expect(replay(run.workflow, run.events, -1).status).toBe('idle');
  });
  it('uses exact event ordering to show same-timestamp state transitions', () => {
    const run = simulate(w(n('a'), n('b', ['a'])), opts);
    const complete = run.events.findIndex((e) => e.type === 'node.succeeded' && e.nodeId === 'a');
    expect(replay(run.workflow, run.events, complete + 1).nodes.b.status).toBe('pending');
    expect(replay(run.workflow, run.events, complete + 2).nodes.b.status).toBe('running');
  });
});
