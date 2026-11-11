import type {
  JsonValue,
  LedgerEntry,
  NodeState,
  ReplayState,
  RunOptions,
  RunResult,
  TraceEvent,
  Workflow,
} from './types';
import { jsonValue, topologicalOrder, validateOptions, validateWorkflow } from './validate';

export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function initialState(workflow: Workflow): ReplayState {
  return {
    nodes: Object.fromEntries(
      workflow.nodes.map((n) => [n.id, { status: 'pending', attempts: 0 }]),
    ),
    at: 0,
    status: 'idle',
  };
}
export function replay(
  workflow: Workflow,
  events: TraceEvent[],
  count = events.length,
): ReplayState {
  const state = initialState(workflow);
  for (const event of events.slice(0, Math.max(0, Math.min(events.length, Math.floor(count))))) {
    state.at = event.at;
    if (event.type === 'run.started') state.status = 'running';
    if (event.type === 'run.completed')
      state.status = event.data === 'succeeded' ? 'succeeded' : 'failed';
    if (!event.nodeId || !Object.hasOwn(state.nodes, event.nodeId)) continue;
    const node = state.nodes[event.nodeId];
    if (event.attempt !== undefined) node.attempts = event.attempt;
    if (event.type === 'node.started') {
      node.status = 'running';
      delete node.readyAt;
      delete node.error;
    }
    if (event.type === 'node.retry') {
      node.status = 'waiting';
      node.readyAt = Number(event.data);
      node.error = event.message;
    }
    if (event.type === 'node.succeeded' || event.type === 'node.cached') {
      node.status = event.type === 'node.cached' ? 'cached' : 'succeeded';
      node.output = structuredClone(event.data ?? null);
      delete node.error;
    }
    if (event.type === 'node.failed' || event.type === 'node.blocked') {
      node.status = event.type === 'node.failed' ? 'failed' : 'blocked';
      node.error = event.message;
    }
  }
  return state;
}
const success = (state: NodeState) => state.status === 'succeeded' || state.status === 'cached';
const terminal = (state: NodeState) =>
  success(state) || state.status === 'failed' || state.status === 'blocked';

/** A pure discrete-event simulation. No network calls, timers, or real side effects. */
export function simulate(
  inputWorkflow: Workflow,
  inputOptions: RunOptions,
  previousLedger: LedgerEntry[] = [],
): RunResult {
  const workflow = validateWorkflow(inputWorkflow);
  const options = validateOptions(inputOptions);
  const ordered = topologicalOrder(workflow.nodes);
  const state = initialState(workflow).nodes;
  const ledger = new Map<string, LedgerEntry>();
  for (const entry of previousLedger) {
    if (
      !entry ||
      typeof entry.key !== 'string' ||
      typeof entry.fingerprint !== 'string' ||
      !Object.hasOwn(entry, 'output') ||
      !jsonValue(entry.output, 0, 21)
    )
      throw new Error('Invalid ledger entry.');
    if (ledger.has(entry.key)) throw new Error('Duplicate key in ledger.');
    ledger.set(entry.key, structuredClone(entry));
  }
  const owners = new Map<string, { nodeId: string; fingerprint: string }>();
  const active = new Map<string, number>();
  const events: TraceEvent[] = [];
  const random = seededRandom(options.seed);
  let now = 0;
  function emit(event: Omit<TraceEvent, 'sequence' | 'at'>) {
    events.push({ sequence: events.length + 1, at: now, ...event });
  }
  emit({
    type: 'run.started',
    message: `Simulation started · ${options.concurrency} concurrent slots · seed ${options.seed}`,
  });
  while (ordered.some((n) => !terminal(state[n.id]))) {
    for (const node of ordered) {
      const current = state[node.id];
      if (current.status !== 'pending' && current.status !== 'waiting') continue;
      const failedDependency = node.dependsOn.find(
        (id) => state[id].status === 'failed' || state[id].status === 'blocked',
      );
      if (failedDependency) {
        current.status = 'blocked';
        emit({
          type: 'node.blocked',
          nodeId: node.id,
          message: `Blocked by ${failedDependency}; no attempt executed.`,
        });
        continue;
      }
      if (!node.dependsOn.every((id) => success(state[id])) || (current.readyAt ?? 0) > now)
        continue;
      const fingerprint = canonicalJson({ operation: node.operation, input: node.input });
      if (node.idempotencyKey) {
        const saved = ledger.get(node.idempotencyKey);
        const owner = owners.get(node.idempotencyKey);
        if (
          (saved && saved.fingerprint !== fingerprint) ||
          (owner && owner.fingerprint !== fingerprint)
        ) {
          current.status = 'failed';
          emit({
            type: 'node.failed',
            nodeId: node.id,
            attempt: current.attempts,
            message:
              'Idempotency conflict: this key is already associated with a different operation or payload.',
          });
          continue;
        }
        if (saved) {
          current.status = 'cached';
          current.output = structuredClone(saved.output);
          emit({
            type: 'node.cached',
            nodeId: node.id,
            attempt: 0,
            message: 'Matching key and payload; reused the recorded result.',
            data: saved.output,
          });
          continue;
        }
        if (owner && owner.nodeId !== node.id) continue;
      }
      if (active.size >= options.concurrency) continue;
      current.status = 'running';
      current.attempts += 1;
      active.set(node.id, now + node.durationMs);
      if (node.idempotencyKey) owners.set(node.idempotencyKey, { nodeId: node.id, fingerprint });
      emit({
        type: 'node.started',
        nodeId: node.id,
        attempt: current.attempts,
        message: `Attempt ${current.attempts} started; ${node.durationMs} ms simulated work.`,
      });
    }
    if (ordered.every((n) => terminal(state[n.id]))) break;
    const nextTimes = [
      ...active.values(),
      ...ordered
        .filter((n) => state[n.id].status === 'waiting' && (state[n.id].readyAt ?? 0) > now)
        .map((n) => state[n.id].readyAt!),
    ];
    if (nextTimes.length === 0)
      throw new Error('Scheduler stalled: no runnable node or scheduled event.');
    now = Math.min(...nextTimes);
    for (const node of ordered) {
      if (active.get(node.id) !== now) continue;
      active.delete(node.id);
      const current = state[node.id];
      const fails = node.permanentFailure || current.attempts <= node.failUntilAttempt;
      if (fails) {
        if (!node.permanentFailure && current.attempts < options.maxAttempts) {
          const delay = Math.round(
            options.baseDelayMs *
              2 ** (current.attempts - 1) *
              (1 + random() * options.jitterFraction),
          );
          current.status = 'waiting';
          current.readyAt = now + delay;
          emit({
            type: 'node.retry',
            nodeId: node.id,
            attempt: current.attempts,
            message: `Transient failure; next attempt in ${delay} ms.`,
            data: current.readyAt,
          });
        } else {
          current.status = 'failed';
          if (node.idempotencyKey) owners.delete(node.idempotencyKey);
          emit({
            type: 'node.failed',
            nodeId: node.id,
            attempt: current.attempts,
            message: node.permanentFailure
              ? 'Permanent failure; retry policy is bypassed.'
              : `Retry budget exhausted after ${current.attempts} attempts.`,
          });
        }
      } else {
        current.status = 'succeeded';
        current.output = {
          operation: node.operation,
          accepted: true,
          input: structuredClone(node.input),
          upstream: [...node.dependsOn],
        };
        if (node.idempotencyKey) {
          ledger.set(node.idempotencyKey, {
            key: node.idempotencyKey,
            fingerprint: canonicalJson({ operation: node.operation, input: node.input }),
            output: structuredClone(current.output),
          });
          owners.delete(node.idempotencyKey);
        }
        emit({
          type: 'node.succeeded',
          nodeId: node.id,
          attempt: current.attempts,
          message: 'Completed successfully; result recorded.',
          data: current.output,
        });
      }
    }
  }
  const status = ordered.every((n) => success(state[n.id])) ? 'succeeded' : 'failed';
  emit({
    type: 'run.completed',
    message: `Run ${status} at ${now} ms logical time.`,
    data: status,
  });
  return {
    schemaVersion: 1,
    workflow,
    options,
    events,
    ledger: [...ledger.values()],
    elapsedMs: now,
    status,
  };
}
