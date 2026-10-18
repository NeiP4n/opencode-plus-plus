# OpenCode++ Infrastructure Hardening Plan

Status: implementation roadmap for the `lan-rooms` line. This document is a plan, not a claim that every capability below already exists.

## Operating rules

1. Preserve existing package boundaries and public contracts. Prefer extending the current implementation over introducing a parallel registry, permission engine, event bus, or provider router.
2. Treat the current `lan-rooms` branch as the requested base. Review open PRs before touching overlapping code; do not silently duplicate or overwrite their work.
3. Make each change small enough to review, with regression tests and an explicit acceptance criterion.
4. Fail closed for authorization and privacy decisions. Do not silently downgrade sandboxing or access controls.
5. Never retry a tool with side effects unless the operation is known to be idempotent or has a durable deduplication key.
6. Report validation accurately. A code review is not a test run; CI is not passed until its result is visible.

## Target request lifecycle

```text
UI / CLI
  -> Client + Protocol + Schema (validated request, stable operation/session IDs)
  -> Server (authentication, room membership, authorization, request limits)
  -> Core runtime (provider selection, model call, tool permission, execution)
  -> Durable task/session state (checkpoint, cancellation, idempotency)
  -> Event stream (ordered events, bounded history, reconnect/replay)
  -> UI / CLI (same terminal outcome for every authorized participant)
```

The diagram is a target contract, not a claim that each box is a separate service today.

Every operation should have a traceable identity and explicit terminal state. Distinguish successful completion, user cancellation, permission denial, provider rate limiting, quota exhaustion, authentication failure, network failure, and internal error. Do not collapse these into a generic retry loop.

## Workstream 1 — Security and room privacy

### Build
- Inventory every entry point that can read room state, stream events, invoke tools, access history, or return paths/screenshots.
- Apply the same authorization decision at the server boundary and at the underlying operation; UI hiding is not authorization.
- Keep room restrictions stricter than personal trust or saved approvals. Scope approvals to the intended user, project, room, action, and resource.
- Redact credentials and sensitive paths in logs, events, prompts, history, and tool output where those surfaces can reach other participants.
- For outbound restrictions, document the limits of command filtering and use an OS-level sandbox/firewall where the threat model requires network isolation.
- Re-evaluate live room policy for long-running streams and tool continuations.

### Tests / acceptance
- Guest cannot access another room's sessions, files, events, screenshots, or tool results by changing identifiers.
- A saved approval in one scope does not authorize another scope.
- Policy changes take effect for an already-open room.
- Deny-by-default behavior is tested for missing identity, invalid membership, and ambiguous policy.
- Secret/path redaction is covered across every relevant response type.

### Dependencies
Coordinate with the existing room privacy/permission PRs (#10 and #11); review their latest diffs before modifying overlapping files.

## Workstream 2 — Tools and Plugins

### Build
- First map the existing tool catalogs, hub commands, MCP integrations, GUI extensions, and plugin loading paths. They are related but not interchangeable registries.
- Define one inventory view over existing sources rather than creating a competing source of truth.
- Separate discovery, availability, enablement, permission, execution, and health. A tool being installed must not imply it is authorized.
- Give every tool a stable identity, validated input/output schema, cancellation/timeout behavior, and structured error category.
- Add lifecycle states for plugin loading/unloading and isolate plugin failures so one broken integration does not corrupt the entire runtime.
- Keep generated client code generated; if public Protocol/HttpApi changes, run the repository's client generation workflow.

### Tests / acceptance
- Installed, missing, disabled, unauthorized, timed-out, and crashed tools produce distinguishable states.
- A tool is not exposed to a model if policy disallows its use.
- Plugin failure is contained and diagnosable.
- Registry views are deterministic and do not duplicate entries from multiple sources.
- Cross-platform shell/MCP paths retain explicit platform-specific behavior.

## Workstream 3 — Rate limits and provider resilience

### Build
- Centralize provider error classification without hiding provider-specific details.
- Parse and honor `Retry-After` when supplied; otherwise use bounded exponential backoff with jitter only for errors known to be transient.
- Distinguish temporary request throttling from account quota exhaustion, invalid credentials, policy denial, model unavailability, and network/server failure.
- Track temporary cooldown by the narrowest correct scope (provider/account/model/credential/egress identity as supported); expire cooldown automatically and avoid duplicate UI entries.
- Persist only the minimum state needed for reliable cooldown behavior. Do not expose internal account/IP rotation details to other room members.
- Preserve the interrupted session/task context and show a clear continue/retry action only when continuation is safe.
- Never rotate credentials, IPs, or accounts to evade provider limits or access controls. Respect upstream limits and quota policy.

### Tests / acceptance
- A throttled request observes the server's retry delay and does not create a tight retry loop.
- Quota/auth/policy errors are not treated as short cooldowns.
- Cooldowns expire and do not grow without bound.
- Reconnect/continue resumes the correct project, room, session, and task without duplicating side effects.
- UI exposes a recoverable action only when there is a valid continuation path.

## Workstream 4 — LAN Rooms and Mesh

### Build
- Treat room membership, role, session ownership, and event visibility as server-enforced rules.
- Make event sequence/replay semantics explicit: cursor, bounded retention, stale cursor handling, and reconnect behavior.
- Define Mesh node identity, leader/owner lease, quorum, committed index, persistence format, and recovery rules before claiming failover support.
- Persist replicated state and implement authenticated RPCs before exposing automatic failover in UI/CLI.
- Add split-brain, network partition, delayed/reordered/duplicated message, restart, and stale-node tests.
- Keep a room usable in degraded mode only when its consistency and authority guarantees are clear; otherwise stop writes rather than accept conflicting owners.

### Tests / acceptance
- A reconnecting client gets an ordered replay or an explicit resynchronization response.
- Unauthorized guests never receive hidden events.
- A minority partition cannot independently commit conflicting state.
- Restart restores the last committed state without inventing acknowledgements.
- UI does not claim Mesh failover is available before the persistence/RPC/partition-test gate is met.

### Dependencies
PR #6 is foundational helper work only; its own scope notes that persistent server RPC, CLI/UI integration, and partition tests remain future work.

## Workstream 5 — Durable tasks and crash recovery

### Build
- Model task lifecycle explicitly: queued -> admitted -> running -> waiting-for-permission/provider -> completed/failed/cancelled.
- Persist the stable task ID, owning project/room/session, original prompt reference, last durable checkpoint, and terminal result.
- Make transitions atomic where possible and use idempotency keys for replayable admissions.
- On startup, reconcile durable task records against message history and execution records before deciding whether to resume, replay, or mark failed.
- Never infer completion from an empty transcript or from an unrelated queued completion.
- Add cancellation propagation and ensure stale workers cannot commit after ownership has changed.

### Tests / acceptance
- Fault injection at every transition boundary does not lose work or duplicate side effects.
- Restart resumes the correct task and stable message identity.
- Two workers cannot both commit the same task result.
- Cancellation and permission denial reach a stable terminal state.
- Recovery is observable through structured diagnostics.

### Dependencies
Review PR #1's crash-window fixes before touching Orchestra recovery.

## Workstream 6 — Performance, observability, and releases

### Build
- Use structured logs with correlation IDs for request, session, room, task, provider, and tool; never log secrets or raw sensitive payloads.
- Add health/readiness diagnostics for server, provider connectivity, event stream, task recovery, and optional integrations.
- Bound event queues, caches, waiter counts, retries, and retained presence/task metadata; define pruning and backpressure behavior.
- Measure allocation and latency before optimizing hot paths. Keep optimizations behavior-preserving.
- Make CI gates explicit: formatting/lint, typecheck, unit tests, package/contract tests, security scans, and platform-specific integration/E2E tests.
- Track build/release metadata and document which checks ran for each release.

### Tests / acceptance
- Stress tests establish bounded memory and predictable behavior under slow consumers.
- Event fan-out and reconnect do not create unbounded queues or duplicate event processing.
- Health output distinguishes degraded optional integrations from a failed core server.
- CI failures block promotion; release notes identify skipped or unavailable checks.

## Implementation order and gates

1. **Baseline and overlap review:** record branch head, open PRs, CI status, package scripts, and known test limitations.
2. **Security boundaries:** verify room/tool entry points and merge/reconcile existing permission work before adding parallel rules.
3. **Shared error and lifecycle contracts:** standardize operation IDs, structured errors, cancellation, and state transitions.
4. **Provider resilience:** rate-limit classification and safe continuation, using the lifecycle contract.
5. **Durable task recovery:** idempotency, checkpoints, startup reconciliation, and fault-injection tests.
6. **Room replay and Mesh durability:** persistence/RPC/partition testing before advertising failover.
7. **Tool/plugin lifecycle:** unified inventory view and failure isolation on top of existing registries.
8. **Operations and performance:** bounded resources, diagnostics, stress tests, and release gates.
9. **End-to-end verification:** run affected package tests and full CI where available; resolve regressions before declaring completion.

Security and performance reviews run continuously rather than waiting for the final phase.

## Definition of done for each change

- The current implementation and overlapping PRs were reviewed.
- The change is scoped to the correct package and preserves existing public contracts unless an explicit migration is included.
- Regression tests cover the reported bug and at least one negative/failure path.
- Typecheck/lint/tests have been run where the environment permits; unavailable checks are explicitly listed.
- CI status is checked before merge.
- Documentation describes actual shipped behavior, not future intent.
- No credentials, personal data, or unnecessary telemetry are introduced.
