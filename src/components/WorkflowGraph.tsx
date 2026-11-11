import { Check, Circle, Clock3, OctagonX, Play, RotateCw, ShieldCheck } from 'lucide-react';
import type { NodeStatus, ReplayState, Workflow } from '../domain/types';
import { topologicalOrder } from '../domain/validate';
const ICONS = {
  pending: Circle,
  running: Play,
  waiting: RotateCw,
  succeeded: Check,
  failed: OctagonX,
  blocked: OctagonX,
  cached: ShieldCheck,
};
const LABELS: Record<NodeStatus, string> = {
  pending: 'Ready to run',
  running: 'Running',
  waiting: 'Retry waiting',
  succeeded: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  cached: 'Reused result',
};
export function WorkflowGraph({
  workflow,
  state,
  selected,
  onSelect,
}: {
  workflow: Workflow;
  state: ReplayState;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const depth = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  const order = topologicalOrder(workflow.nodes);
  for (const node of order)
    depth.set(
      node.id,
      node.dependsOn.length ? Math.max(...node.dependsOn.map((id) => depth.get(id)!)) + 1 : 0,
    );
  const maxDepth = Math.max(...depth.values());
  const columns = Array.from({ length: maxDepth + 1 }, (_, d) =>
    order.filter((n) => depth.get(n.id) === d),
  );
  const maxRows = Math.max(...columns.map((c) => c.length));
  const width = Math.max(780, columns.length * 165 + 40);
  const rowPitch = 116;
  const height = Math.max(310, maxRows * rowPitch + 80);
  columns.forEach((column, c) =>
    column.forEach((node, row) =>
      positions.set(node.id, {
        x: 24 + (c * (width - 192)) / Math.max(maxDepth, 1),
        y: height / 2 + (row - (column.length - 1) / 2) * rowPitch - 37,
      }),
    ),
  );
  return (
    <div className="graph-scroll" aria-label="Workflow dependency graph">
      <div className="graph-canvas" style={{ width, height }}>
        <svg className="graph-lines" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0 0L5 2.5L0 5" fill="#607084" />
            </marker>
          </defs>
          {workflow.nodes.flatMap((node) =>
            node.dependsOn.map((dep) => {
              const a = positions.get(dep)!;
              const b = positions.get(node.id)!;
              const x = a.x + 145;
              const y = a.y + 38;
              const end = b.x - 5;
              return (
                <path
                  key={`${dep}-${node.id}`}
                  d={`M${x} ${y} C${(x + end) / 2} ${y},${(x + end) / 2} ${b.y + 38},${end} ${b.y + 38}`}
                  fill="none"
                  stroke={
                    state.nodes[dep] && ['succeeded', 'cached'].includes(state.nodes[dep].status)
                      ? '#49695e'
                      : '#364252'
                  }
                  strokeWidth="1.5"
                  markerEnd="url(#arrow)"
                />
              );
            }),
          )}
        </svg>
        {workflow.nodes.map((node) => {
          const p = positions.get(node.id)!;
          const current = state.nodes[node.id];
          const status = current?.status ?? 'pending';
          const Icon = ICONS[status];
          return (
            <button
              key={node.id}
              className={`graph-node ${status} ${selected === node.id ? 'selected' : ''}`}
              style={{ left: p.x, top: p.y }}
              onClick={() => onSelect(node.id)}
              aria-pressed={selected === node.id}
              aria-label={`${node.label}: ${LABELS[status]}`}
            >
              <span className="node-top">
                <span className="node-symbol">
                  <Icon size={13} />
                </span>
                <span>{node.operation}</span>
                {node.idempotencyKey ? <ShieldCheck size={11} className="node-key" /> : null}
              </span>
              <strong>{node.label}</strong>
              <span className="node-bottom">
                <span>{LABELS[status]}</span>
                <span>
                  <Clock3 size={10} /> {node.durationMs}ms
                </span>
              </span>
            </button>
          );
        })}
        <span className="graph-caption">DEPENDENCIES FLOW LEFT → RIGHT</span>
      </div>
    </div>
  );
}
