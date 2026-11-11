# Architecture notes

## Boundary: model versus real automation

Relaylab is a deterministic discrete-event simulation. The most important boundary is that no operation performs a real effect. A payment node returns synthetic output. This keeps experiments reproducible and avoids giving a browser demo authority over an external service.

The application has three layers:

1. **Validation** accepts untrusted workflow JSON and returns an independent, bounded domain object.
2. **Simulation** receives a workflow, run options, and an optional starting ledger. It returns a complete immutable-by-convention run record without changing its arguments.
3. **Presentation** derives graph, inspector, counters, and trace rows from a selected event prefix.

The engine imports no React code, DOM APIs, network libraries, wall-clock time, or browser storage.

## Invariants worth preserving

| Invariant                                                            | Mechanism                                                       | Test coverage                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| A node runs only after every dependency succeeds or is reused.       | Ready-node predicate over topological order.                    | Two-parent join and blocked-descendant cases. |
| Simulated concurrent work never exceeds the configured worker count. | In-flight completion map owns slots.                            | Trace-based active-count assertion.           |
| Retry budget includes the first attempt.                             | Increment on `node.started`; compare before scheduling a retry. | Exact attempt sequence and exhausted budget.  |
| Reused keys cannot silently change operation or input.               | Canonical operation/input fingerprint.                          | Same key with changed payload or operation.   |
| Concurrent matching duplicates do not execute twice.                 | In-flight key ownership persists through backoff.               | Duplicate and retry ownership cases.          |
| A replay cannot execute work or mutate the original run.             | A fresh reducer state and cloned outputs.                       | Prefix reconstruction and output isolation.   |
| Equal configuration produces equal events.                           | Logical clock, lexical ties, seeded random sequence.            | Full record equality.                         |

## Scheduler decisions

`topologicalOrder` implements Kahn’s algorithm with a sorted ready queue. For the explicit 30-node bound, scans of the node list are easier to audit than a more complicated heap or adjacency index. The scheduler similarly scans a small bounded node set and chooses the next event from completion and retry times.

A production scheduler would need better indexing and persistence. Adding those here would obscure the failure semantics without changing the experiments supported by this version.

When several attempts complete at the same logical time, their completion events follow the deterministic topological order. Then the next loop admits newly ready work. Sequence numbers preserve the exact order of same-timestamp transitions.

## Ledger decisions

The ledger key is supplied by the caller. Identical payloads alone do not imply duplicate intent: a caller can intentionally perform the same operation twice using different keys. A key instead asserts that repeated deliveries represent one intended operation.

The fingerprint includes `operation` and `input`, but not the node identifier, retry settings, or duration. This lets a duplicate delivery appear under another graph node while still representing the same intent. Dependencies establish ordering; they do not modify payloads in this model.

Key ownership is held through transient retry waits. A successful result enters the ledger; a terminal error releases ownership without caching failure. Another matching delivery can then make its own attempt. That policy is explicit and can be changed in a future version.

The ledger is deliberately neither a cryptographic hash nor durable storage. Canonical JSON is retained for transparent comparison. JavaScript number representation applies; the system is not intended for exact decimal payment calculations.

## Replay decisions

The event log is the source of truth for inspection. The UI stores the cursor separately from the run. Metrics are calculated from the selected prefix, so “executed attempts” and “scheduled retries” describe what is visible at that cursor.

Changing a workflow node or run option clears the trace. This prevents an edited configuration from being displayed beside the outcome of an older configuration. The session ledger is separate so the user can intentionally test a second delivery against earlier successful work.

## Input boundaries

Workflow JSON has a version field, explicit allowlists, size and node limits, finite-number checks, limited nesting, and prohibited prototype-sensitive property names. The definition editor and file import use the same parser. Unknown fields are rejected rather than silently ignored.

Run configuration is validated again at the engine boundary. The UI does not provide authentication because it has no server or account operations. Imported strings are rendered through React text nodes; no raw HTML or evaluated code is accepted.

## UI and accessibility

The graph renders nodes as real buttons; SVG contains only decorative dependency edges. Selected state uses `aria-pressed`. Controls have labels, replay is a native range input, and the definition editor uses a native modal dialog with browser focus containment. A reduced-motion preference disables cosmetic transitions. Font families use local system fallbacks with no runtime font request.

## Verification scope

The domain suite covers the consequential engine behavior and boundary failures. TypeScript strict checks and the production build verify integration. Browser visual and interaction review is a separate publishing check. No production traffic, usage statistics, or employer-derived data is claimed.
