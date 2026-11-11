# Relaylab

**A workflow failure laboratory with a clock you can rewind.**

**[Live demo](https://relaylab-theta.vercel.app)** · [Project portfolio](https://brennan-portfolio-jade.vercel.app)

Relaylab is a browser application for exploring why a workflow retries, stalls, or repeats an effect. Edit a dependency graph, inject transient or permanent failures, change the worker limit, then inspect a deterministic event trace. No account, backend, API key, or subscription is required.

This is an AI-assisted personal software project by Brennan LeBlanc. It is a working v0.1 simulator deployed as a public demonstration. It does not execute real jobs or provide durable queue infrastructure. The bundled scenarios are synthetic.

## Why this project exists

Automation tutorials usually show the successful path. Real workflows have more interesting questions: Should one failed inspection block dispatch? Does retrying the entire flow repeat a successful payment? What happens when two deliveries arrive with the same key but different amounts?

Relaylab makes those questions visible. Its core is an independently testable TypeScript engine; the interface is an inspection tool around that engine.

## Try three scenarios

| Scenario          | Experiment                                       | Expected result                                                                                                  |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Order fulfillment | Run with two workers; payment fails once.        | Inventory and payment overlap. Payment retries; successful inventory is not rerun.                               |
| Quality gate      | Keep the inspection’s permanent failure enabled. | Inspection fails without retry. Release and dispatch are blocked. Archiving finishes independently.              |
| Duplicate webhook | Run all three synthetic deliveries.              | The matching duplicate reuses the first result. A delivery with a different amount is rejected before execution. |

A demonstration trace is loaded on first visit. Changing a setting clears the trace so the display cannot silently present an old run as a new result.

### Quick walkthrough

1. Open **Order fulfillment** and select **Authorize payment** in the graph.
2. Set transient failures to **First 2 attempts** and maximum attempts to **3**.
3. Run the simulation. Inspect the two retry events and the growing delay.
4. Click a trace row or drag the replay handle to inspect state at that event.
5. Enable **Reuse on next run**. Run again to see matching idempotency keys reuse results.
6. Export the trace to retain the workflow, options, events, and ledger.

## Run locally

Use Node.js 22.12 or newer; Node.js 24 is recommended.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```bash
npm run check
npm run preview
```

`check` performs TypeScript validation, the domain test suite, and a Vite production build. There are **35 focused tests** covering validation, scheduling, retries, concurrency, idempotency, and replay.

The repository includes a Vercel configuration for Vite. Import the repository as a project and use the existing `npm run build` command and `dist` output directory. Relative asset paths also support serving the built app from a subdirectory.

## What the engine actually does

### Dependency scheduling

A workflow is a directed acyclic graph of at most 30 nodes. The validator checks unique identifiers, dependency existence, duplicate edges, field types, bounded durations, and cycles. Ready nodes are considered in a deterministic topological order, with lexical node identifiers resolving ties.

The scheduler keeps a logical clock and an in-flight completion map. It advances to the next scheduled completion or retry time; it never sleeps. A concurrency slot is occupied only while an attempt runs. Waiting retries release a worker slot but retain ownership of their idempotency key.

### Retry policy

A transient failure is controlled by `failUntilAttempt`. For example, `2` makes attempts one and two fail; attempt three can succeed. `maxAttempts` includes the initial attempt. Permanent failures bypass retry policy.

```text
delay = round(baseDelayMs × 2^(attempt - 1) × (1 + random × jitterFraction))
```

`random` comes from a seeded 32-bit linear congruential generator. Jitter is an additive, nonnegative fraction; this is intentionally **not** a full-jitter implementation. The same validated workflow, options, seed, and starting ledger produce the same trace. A failed node blocks descendants while unrelated branches continue.

### Idempotency

Each caller-supplied key is associated with canonical JSON of the node’s `operation` and `input`. Object key order does not affect identity; array order does. Matching intent reuses the recorded output. A different operation or payload with the same key produces a conflict.

Concurrent duplicates wait behind the key owner. A successful attempt records a result; a failed attempt does not. This is an in-memory model of the intent checks discussed in [AWS’s explanation of idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/). It is not a distributed transaction implementation.

### Replay

Replay folds an immutable prefix of the event log into fresh node state. Clicking a row does not rerun the scheduler or perform side effects. Events include a sequence number because several state transitions may share the same timestamp.

## Workflow format

The editor validates the same format as file import. A minimal example:

```json
{
  "schemaVersion": 1,
  "name": "One step",
  "description": "A synthetic workflow for inspection.",
  "nodes": [
    {
      "id": "reserve",
      "label": "Reserve inventory",
      "operation": "reserve_stock",
      "dependsOn": [],
      "durationMs": 200,
      "input": { "sku": "DEMO-1", "quantity": 2 },
      "failUntilAttempt": 1,
      "permanentFailure": false,
      "idempotencyKey": "reservation:DEMO-1"
    }
  ]
}
```

Workflow import is limited to 200 KB. Unknown fields, nonfinite values, reserved object properties, and nesting beyond 20 input levels are rejected. **Export workflow** creates an importable workflow; **Export trace** creates a run record for inspection. Run records are not accepted as workflow imports.

## Project layout

```text
src/domain/types.ts       Domain contracts
src/domain/validate.ts    Runtime schema checks and topological ordering
src/domain/engine.ts      Scheduler, canonical identity, and replay
src/domain/fixtures.ts    Synthetic demonstration graphs
src/domain/engine.test.ts Behavioral tests
src/components/          Dependency map and event log
src/App.tsx              Lab controls, inspector, and import/export
```

Read [the architecture notes](docs/architecture.md) for invariants and tradeoffs.

## Deliberate limitations

- Operations produce deterministic synthetic results. They do not call real services or transform upstream payloads.
- State and ledger entries live in the current tab’s memory. Reloading clears them; there is no crash durability, database, cross-tab coordination, key expiry, or exactly-once delivery guarantee.
- The simulator models failure before a successful result is recorded. It does not model an external effect succeeding before its acknowledgement is lost.
- Workflows are acyclic. There are no conditional branches, cancellations, human approvals, or compensation steps.
- The graph uses a simple layered layout and horizontal scrolling; it is designed for small inspectable workflows.
- Imported workflow definitions are supported; imported event traces are not yet supported.

## Next useful work

1. Add an explicit “effect succeeded, acknowledgement lost” failure mode and demonstrate why durable atomic recording matters.
2. Validate and import saved traces, including event-sequence and timestamp checks.
3. Add a comparison view for two policies using the same workflow and seed.
4. Add cancellation and compensation events while preserving replay invariants.

## License

MIT. See [LICENSE](LICENSE).
