import type { JsonValue, RunOptions, Workflow, WorkflowNode } from './types';

const MAX_BYTES = 200_000;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function text(value: unknown, max = 120): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function fields(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${path}: unknown field "${key}".`);
}
export function jsonValue(value: unknown, depth = 0, maxDepth = 20): value is JsonValue {
  if (depth > maxDepth) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => jsonValue(v, depth + 1, maxDepth));
  if (object(value))
    return Object.entries(value).every(
      ([k, v]) => !RESERVED.has(k) && jsonValue(v, depth + 1, maxDepth),
    );
  return false;
}
export function topologicalOrder(nodes: WorkflowNode[]): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const remaining = new Map(nodes.map((n) => [n.id, n.dependsOn.length]));
  const ready = nodes
    .filter((n) => n.dependsOn.length === 0)
    .map((n) => n.id)
    .sort();
  const ordered: WorkflowNode[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const node of nodes)
      if (node.dependsOn.includes(id)) {
        const count = remaining.get(node.id)! - 1;
        remaining.set(node.id, count);
        if (count === 0) {
          ready.push(node.id);
          ready.sort();
        }
      }
  }
  if (ordered.length !== nodes.length)
    throw new Error(
      'Workflow has a dependency cycle. Every node must be reachable without revisiting a node.',
    );
  return ordered;
}
export function validateWorkflow(value: unknown): Workflow {
  if (!object(value)) throw new Error('Workflow must be a JSON object.');
  fields(value, ['schemaVersion', 'name', 'description', 'nodes'], 'Workflow');
  if (value.schemaVersion !== 1) throw new Error('Expected schemaVersion: 1.');
  if (!text(value.name, 80) || !text(value.description, 500))
    throw new Error('Workflow needs a name (1–80 characters) and description (1–500).');
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 30)
    throw new Error('Workflow must contain between 1 and 30 nodes.');
  const ids = new Set<string>();
  for (const [i, node] of value.nodes.entries()) {
    const path = `Node ${i + 1}`;
    if (!object(node)) throw new Error(`${path} must be an object.`);
    fields(
      node,
      [
        'id',
        'label',
        'operation',
        'dependsOn',
        'durationMs',
        'input',
        'failUntilAttempt',
        'permanentFailure',
        'idempotencyKey',
      ],
      path,
    );
    if (!text(node.id, 40) || !/^[a-z][a-z0-9_-]*$/.test(node.id) || RESERVED.has(node.id))
      throw new Error(
        `${path}: id must start with a lowercase letter and contain lowercase letters, digits, - or _.`,
      );
    if (ids.has(node.id)) throw new Error(`Duplicate node id "${node.id}".`);
    ids.add(node.id);
    if (!text(node.label, 50) || !text(node.operation, 60))
      throw new Error(`${path}: label and operation are required.`);
    if (
      !Array.isArray(node.dependsOn) ||
      !node.dependsOn.every((v) => typeof v === 'string') ||
      new Set(node.dependsOn).size !== node.dependsOn.length
    )
      throw new Error(`${path}: dependsOn must contain unique node ids.`);
    if (!integer(node.durationMs, 1, 60_000))
      throw new Error(`${path}: durationMs must be an integer from 1 to 60000.`);
    if (!integer(node.failUntilAttempt, 0, 8))
      throw new Error(`${path}: failUntilAttempt must be an integer from 0 to 8.`);
    if (typeof node.permanentFailure !== 'boolean')
      throw new Error(`${path}: permanentFailure must be a boolean.`);
    if (!Object.hasOwn(node, 'input') || !jsonValue(node.input))
      throw new Error(
        `${path}: input must be finite JSON, at most 20 levels deep, without reserved property names.`,
      );
    if (node.idempotencyKey !== undefined && !text(node.idempotencyKey, 100))
      throw new Error(
        `${path}: idempotencyKey must be a nonempty string of at most 100 characters.`,
      );
  }
  const result = value as unknown as Workflow;
  for (const node of result.nodes)
    for (const dep of node.dependsOn)
      if (!ids.has(dep)) throw new Error(`Node "${node.id}" depends on missing node "${dep}".`);
  topologicalOrder(result.nodes);
  return structuredClone(result);
}
export function parseWorkflow(source: string): Workflow {
  if (new TextEncoder().encode(source).length > MAX_BYTES)
    throw new Error('Workflow exceeds the 200 KB import limit.');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON. Check commas, quotation marks, and matching brackets.');
  }
  return validateWorkflow(value);
}
export function validateOptions(value: RunOptions): RunOptions {
  if (!integer(value.concurrency, 1, 4)) throw new Error('Concurrency must be between 1 and 4.');
  if (!integer(value.maxAttempts, 1, 6))
    throw new Error('Maximum attempts must be between 1 and 6.');
  if (!integer(value.baseDelayMs, 0, 5000))
    throw new Error('Base retry delay must be between 0 and 5000 ms.');
  if (
    typeof value.jitterFraction !== 'number' ||
    !Number.isFinite(value.jitterFraction) ||
    value.jitterFraction < 0 ||
    value.jitterFraction > 1
  )
    throw new Error('Jitter must be between 0 and 1.');
  if (!integer(value.seed, 0, 4294967295))
    throw new Error('Seed must be a 32-bit unsigned integer.');
  return { ...value };
}
