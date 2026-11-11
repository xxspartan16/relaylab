import type { Workflow, WorkflowNode } from './types';
function node(
  id: string,
  label: string,
  dependsOn: string[],
  durationMs: number,
  extra: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id,
    label,
    operation: id,
    dependsOn,
    durationMs,
    input: { batch: 'SAMPLE-1042' },
    failUntilAttempt: 0,
    permanentFailure: false,
    ...extra,
  };
}
export const FIXTURES: { id: string; eyebrow: string; workflow: Workflow }[] = [
  {
    id: 'fulfillment',
    eyebrow: '01 / transient failure',
    workflow: {
      schemaVersion: 1,
      name: 'Order fulfillment',
      description:
        'A payment step fails once while inventory runs in parallel. Watch the retry recover without restarting successful work.',
      nodes: [
        node('receive', 'Receive order', [], 120, { input: { order: 'DEMO-1042', amount: 84 } }),
        node('validate', 'Validate payload', ['receive'], 180),
        node('inventory', 'Reserve inventory', ['validate'], 500, {
          idempotencyKey: 'inventory:DEMO-1042',
        }),
        node('payment', 'Authorize payment', ['validate'], 300, {
          failUntilAttempt: 1,
          idempotencyKey: 'payment:DEMO-1042',
          input: { amount: 84, currency: 'USD' },
        }),
        node('pack', 'Create shipment', ['inventory', 'payment'], 220),
        node('notify', 'Send confirmation', ['pack'], 100, {
          idempotencyKey: 'confirmation:DEMO-1042',
        }),
      ],
    },
  },
  {
    id: 'quality',
    eyebrow: '02 / permanent failure',
    workflow: {
      schemaVersion: 1,
      name: 'Quality gate',
      description:
        'A failed inspection is permanent. Release and dispatch should be blocked, while independent documentation can finish.',
      nodes: [
        node('sample', 'Collect sample', [], 160),
        node('inspect', 'Inspect tolerance', ['sample'], 400, {
          permanentFailure: true,
          input: { diameter: 25.09, upperLimit: 25.05 },
        }),
        node('document', 'Archive readings', ['sample'], 300),
        node('release', 'Release batch', ['inspect', 'document'], 200),
        node('dispatch', 'Dispatch batch', ['release'], 150),
      ],
    },
  },
  {
    id: 'duplicate',
    eyebrow: '03 / duplicate delivery',
    workflow: {
      schemaVersion: 1,
      name: 'Duplicate webhook',
      description:
        'Two deliveries share a key and payload. The second waits for the first result; a third with a changed amount is rejected.',
      nodes: [
        node('receive', 'Webhook received', [], 100),
        node('delivery_a', 'First delivery', ['receive'], 350, {
          operation: 'capture',
          idempotencyKey: 'capture:DEMO-208',
          input: { amount: 42 },
        }),
        node('delivery_b', 'Duplicate delivery', ['receive'], 350, {
          operation: 'capture',
          idempotencyKey: 'capture:DEMO-208',
          input: { amount: 42 },
        }),
        node('delivery_c', 'Conflicting delivery', ['delivery_b'], 350, {
          operation: 'capture',
          idempotencyKey: 'capture:DEMO-208',
          input: { amount: 99 },
        }),
        node('audit', 'Archive first result', ['delivery_a'], 150),
      ],
    },
  },
];
