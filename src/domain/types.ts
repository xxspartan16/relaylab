export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface WorkflowNode {
  id: string;
  label: string;
  operation: string;
  dependsOn: string[];
  durationMs: number;
  input: JsonValue;
  failUntilAttempt: number;
  permanentFailure: boolean;
  idempotencyKey?: string;
}
export interface Workflow {
  schemaVersion: 1;
  name: string;
  description: string;
  nodes: WorkflowNode[];
}
export interface RunOptions {
  concurrency: number;
  maxAttempts: number;
  baseDelayMs: number;
  jitterFraction: number;
  seed: number;
}
export type NodeStatus =
  'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'blocked' | 'cached';
export interface NodeState {
  status: NodeStatus;
  attempts: number;
  readyAt?: number;
  output?: JsonValue;
  error?: string;
}
export type EventType =
  | 'run.started'
  | 'node.started'
  | 'node.retry'
  | 'node.succeeded'
  | 'node.failed'
  | 'node.blocked'
  | 'node.cached'
  | 'run.completed';
export interface TraceEvent {
  sequence: number;
  at: number;
  type: EventType;
  nodeId?: string;
  attempt?: number;
  message: string;
  data?: JsonValue;
}
export interface LedgerEntry {
  key: string;
  fingerprint: string;
  output: JsonValue;
}
export interface RunResult {
  schemaVersion: 1;
  workflow: Workflow;
  options: RunOptions;
  events: TraceEvent[];
  ledger: LedgerEntry[];
  elapsedMs: number;
  status: 'succeeded' | 'failed';
}
export interface ReplayState {
  nodes: Record<string, NodeState>;
  at: number;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
}
export const DEFAULT_OPTIONS: RunOptions = {
  concurrency: 2,
  maxAttempts: 3,
  baseDelayMs: 400,
  jitterFraction: 0.2,
  seed: 42,
};
