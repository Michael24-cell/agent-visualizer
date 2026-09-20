# Increment 2.6 — Slice 1: foundation (contracts + domain)

Review checkpoint. Uncommitted. Nothing below touches the client, the
service, persistence, or the existing run stream.

## What this slice delivers

Validated contracts and a deterministic reducer for the conversation-first
model: **Project → Brief, optional Method, Threads (coordinator + one per
Agent), Agents, Tasks, Plans, Proposals, Asks, Checks, Outputs.** A
service-authoritative "right now" summary is derived from the projection.
Twenty-six focused tests cover every transition policy the implementation
prompt lists, plus replay equality. Codex's Slice 1 review fixes (exact plan
rows, reducer-derived target sequences, single-application scope proposals,
full message-reference validation) are included.

Slices 2–5 (persistence, receipts, routes, simulators, intake, UI wiring)
build on these without changing them.

## Files

| File                                             | Why                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/project-ids.ts`          | New branded ids: `agent_`, `thread_`, `message_`, `proposal_`, `plan_`, `ask_`, `check_`, `output_`, `method_`, `methodsnap_`, `request_`; `CommandId` = UUID. |
| `packages/contracts/src/project.ts`              | Entity schemas (below).                                                                                                                                        |
| `packages/contracts/src/project-events.ts`       | `ProjectEventSchema` (22 event types), `parseProjectEvent`, version gate.                                                                                      |
| `packages/contracts/src/project-projection.ts`   | `ProjectProjectionSchema`, `ProjectSummarySchema`, `AttentionItemSchema`, `ProjectStatusSchema`.                                                               |
| `packages/contracts/src/project-commands.ts`     | Command bodies, error codes, receipt, responses, message page/cursor shapes for Slice 2.                                                                       |
| `packages/contracts/src/index.ts`                | Re-exports.                                                                                                                                                    |
| `packages/domain/src/project-transitions.ts`     | Transition tables for task, ask, check, proposal, thread, brief field.                                                                                         |
| `packages/domain/src/project-projection.ts`      | `applyProjectEvent`, `replayProjectEvents`, `resolveMethod`.                                                                                                   |
| `packages/domain/src/project-summary.ts`         | `summarizeProject`, `isBriefReady`.                                                                                                                            |
| `packages/domain/src/project-projection.test.ts` | 26 tests.                                                                                                                                                      |
| `packages/domain/src/projections.ts`             | `ProjectionError` gains project-stream codes (additive).                                                                                                       |
| `packages/domain/src/transitions.ts`             | `TransitionError.entity` widened to accept project entities (type only).                                                                                       |
| `packages/domain/src/index.ts`                   | Re-exports.                                                                                                                                                    |

## Stream decision

**One event stream per Project; agent-scoped events inside it.** Chosen over
per-agent streams because:

- dispersal (proposal decision → agents → tasks → snapshots → plan assigned
  → coordinator message) and handoffs are single-stream, so one SQLite
  transaction and one sequence cover them — no cross-stream reconciliation;
- restart replay is one `replayProjectEvents` call per project;
- the existing `events` table pattern (append-only triggers, `UNIQUE(stream,
sequence)`, projection upsert) can be reused as-is for a `project_events`
  table in Slice 2.

**Per-target `expectedSequence`.** Each Thread, Agent, Proposal, the Brief,
and the Method carry `lastSequence` = the project sequence of the last event
that touched them. A command is checked against the sequence of the entity
it targets (documented per command schema). Typing into agent B is therefore
not rejected because agent A advanced. Project-wide stop is not forbidden by
anything here; it would be a batch of per-task stops.

**The reducer decides which targets an event touches**, from the payload:
a task event touches its task and that task's agent; a thread event touches
the thread and its agent; `plan.assigned` touches every agent that received
a row; a proposal event touches its thread (and, for `change_task_scope`,
the task's agent). Envelope `threadId` / `agentId` / `taskId` are optional
provenance; when present they must agree with the derived targets or the
event is rejected (`invalid_payload`). The three `task.*` change events
carry `taskId` in their payload for this reason.

## Entity and lifecycle boundaries

| Entity              | Lifetime                                                                          | State                                                                                       |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Project**         | forever                                                                           | none stored; status is derived (below)                                                      |
| **Thread**          | forever (`open` → `closed` only by explicit event; never closed by task outcomes) | `open \| closed`, `messageCount`, `lastSequence`                                            |
| **Agent**           | forever; `taskIds` is its history                                                 | `work` = current task's state, or `idle`; **derived in the reducer**, never set by an event |
| **Task**            | one piece of work                                                                 | `waiting \| working \| needs_you \| done \| stopped \| failed`                              |
| **Ask**             | belongs to one task                                                               | `open \| approved \| denied \| closed`                                                      |
| **Check**           | belongs to one task                                                               | `running \| passed \| failed \| stopped`                                                    |
| **Output**          | belongs to one task; retained forever                                             | —                                                                                           |
| **Plan**            | versioned record                                                                  | `supersededByPlanId?`, `assignedAtSequence?`, `proposalId?`                                 |
| **Proposal**        | one decision                                                                      | `open \| approved \| denied \| dismissed \| superseded`                                     |
| **Brief field**     | never terminal                                                                    | `missing \| inferred \| confirmed \| skipped \| corrected`                                  |
| **Method**          | project-level, versioned                                                          | definition + overrides; `null` = default behavior                                           |
| **Method snapshot** | pinned to one task                                                                | immutable                                                                                   |

`done`, `stopped`, `failed` end a **task**. The agent's `work` shows it, the
agent's thread stays open, its outputs stay, and `task.assigned` for that
agent moves it back to `working`/`waiting`. Tested explicitly
("keeps the conversation open after done, stopped, or failed").

**Messages never create work.** `message.posted` only increments the
thread's count. Intent is explicit on the message (`chat` default,
`start_work` user-only); the _service_ decides to emit `task.assigned` when
intent is `start_work`. No message body appears in the projection (tested by
string search).

## Event catalog (project stream, `version: 1`)

Base: `id, version, sequence, occurredAt, recordedAt, projectId, threadId?,
agentId?, taskId?, correlationId?, causationId?, source: user | coordinator
| agent | system, adapter?: { id, version, mode }, providerMetadata?`.

| Type                       | Payload                                                                  | Reducer policy                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.created`          | `{ project }`                                                            | first event, sequence 1, id matches                                                                                                                                                                                                                                                                                                            |
| `thread.opened`            | `{ thread }`                                                             | one coordinator thread; agent threads name an agent; one thread per agent; starts open/empty                                                                                                                                                                                                                                                   |
| `thread.closed`            | `{ threadId, reason }`                                                   | open → closed                                                                                                                                                                                                                                                                                                                                  |
| `message.posted`           | `{ message }`                                                            | thread open; agent authors only in own thread (coordinator thread accepts agent pointers); non-`chat` intents user-only; every ref (`taskId`, `proposalId`, `askId`, `checkId`, `outputId`, `fromThreadId`) must exist in this project, and an ask/check/output ref must belong to the referenced task when one is given                       |
| `brief.field_updated`      | `{ fieldId, to, value?, source, messageId? }`                            | field transition table; value required unless `skipped`; `brief.version++`                                                                                                                                                                                                                                                                     |
| `brief.request_recorded`   | `{ request }`                                                            | its `record_request` proposal must be approved; one request per proposal; text/category must match                                                                                                                                                                                                                                             |
| `method.applied`           | `{ definition, proposalId? }`                                            | if via proposal: approved `set_method` matching id/version; resets overrides; `method.version++`                                                                                                                                                                                                                                               |
| `method.override_recorded` | `{ sectionId, value }`                                                   | method must exist; appended; `version++`                                                                                                                                                                                                                                                                                                       |
| `method.snapshot_pinned`   | `{ snapshot }`                                                           | task exists, not terminal, has no snapshot; `resolved` must equal `resolveMethod(current)` and `methodVersion` must match → otherwise `snapshot_mismatch`                                                                                                                                                                                      |
| `agent.created`            | `{ agent }`                                                              | thread exists, is `agent` kind, names this agent; starts idle, no tasks                                                                                                                                                                                                                                                                        |
| `plan.recorded`            | `{ plan }`                                                               | version = count+1; no proposal/assignment yet; if a live (unassigned, unsuperseded) plan exists, must `supersedesPlanId` it (`plan_conflict`); superseding marks old plan and its open proposal `superseded`                                                                                                                                   |
| `plan.assigned`            | `{ planId, proposalId? }`                                                | not superseded, not already assigned; if the plan has a proposal, must go through it and it must be approved; every plan row (`planTaskIndex` 0..n-1) must be assigned exactly once — missing rows, duplicate rows, or extra tasks under the plan id are `plan_incomplete`                                                                     |
| `task.assigned`            | `{ task }`                                                               | agent must be `idle/done/stopped/failed` (`agent_busy`); starts `working` with no deps or `waiting` with deps; deps exist; if `planId` is set, `planTaskIndex` must name a real row of a current, unassigned, approved-if-proposed plan, the row must not already be taken, and the task's title/category must match the row (no substitution) |
| `task.state_changed`       | `{ taskId, from, to, reason }`                                           | transition table; `waiting → working` needs every dep in `inputsSatisfied` (`inputs_missing`); any terminal needs no open ask (`ask_open`); `done` needs latest check per `requiredChecks` passed (`completion_blocked`); records `endedAtSequence/endReason`                                                                                  |
| `task.input_satisfied`     | `{ taskId, upstreamTaskId, outputId }`                                   | task waiting; upstream is a dep; upstream `done` and output belongs to it; once per dep                                                                                                                                                                                                                                                        |
| `task.scope_changed`       | `{ taskId, proposalId, scope }`                                          | approved `change_task_scope` proposal for this task with identical scope; the proposal id must not already appear in the task's `scopeHistory` (so a proposal applies exactly once, even after a later proposal changed the scope again); task not terminal                                                                                    |
| `ask.opened`               | `{ ask }`                                                                | task `working`, same agent, no other open ask                                                                                                                                                                                                                                                                                                  |
| `ask.decided`              | `{ askId, from: open, to: approved \| denied \| closed, note? }`         | open only                                                                                                                                                                                                                                                                                                                                      |
| `check.started`            | `{ check }`                                                              | task `working`, same agent; `retryOf` must be an earlier check on the task                                                                                                                                                                                                                                                                     |
| `check.finished`           | `{ checkId, from: running, to, summary }`                                | running only                                                                                                                                                                                                                                                                                                                                   |
| `output.produced`          | `{ output }`                                                             | task not terminal, same agent                                                                                                                                                                                                                                                                                                                  |
| `proposal.opened`          | `{ proposal }`                                                           | thread open; `plan` kind links the plan (plan must be current and unlinked); `change_task_scope` needs a non-terminal task                                                                                                                                                                                                                     |
| `proposal.decided`         | `{ proposalId, from: open, to: approved \| denied \| dismissed, note? }` | open only                                                                                                                                                                                                                                                                                                                                      |

Plus the generic policies from the run stream: idempotent re-apply of an
applied event id, `sequence_collision`, `sequence_gap`, `project_mismatch`.

## Transition tables

```
task:     waiting → working | stopped
          working → needs_you | done | failed | stopped
          needs_you → working | failed | stopped
          done / stopped / failed → (terminal)
agent:    derived: idle when no current task, else the task's state
ask:      open → approved | denied | closed
check:    running → passed | failed | stopped
proposal: open → approved | denied | dismissed | superseded
thread:   open → closed
brief:    missing → inferred | confirmed | skipped
          inferred → confirmed | corrected | skipped
          confirmed → corrected
          skipped → inferred | confirmed | corrected
          corrected → confirmed | corrected
```

Stopping a task with an open ask: the service emits `ask.decided → closed`
first, then `task.state_changed → stopped`; the reducer refuses the stop
otherwise. The ask ends up `closed`, not actionable.

## Proposals

Strict union: `plan { planId }`, `set_method { catalogId, catalogVersion }`,
`record_request { text, category, keywordsMatched }`,
`change_task_scope { taskId, scope[] }`. Common fields include
`consequences.effects[]` (only effects the service performs),
`reversible`, `touchesRepository: false`. `dismissed` is first-class.
Scope/permission changes are only possible through an approved
`change_task_scope` proposal (tested: missing → `missing_entity`, open →
`not_approved`, applied twice → `duplicate_entity`, replayed after a later
proposal → `duplicate_entity`). Each application is recorded in the task's
`scopeHistory` (`proposalId, scope, appliedAtSequence`).

## Plan revision

`plan.recorded` v2 with `supersedesPlanId: v1` → v1 gets
`supersededByPlanId`, v1's open proposal becomes `superseded`; assigning v1
is refused (`plan_superseded`), assigning v2 needs its proposal approved
(`not_approved`) and all its tasks present (`plan_incomplete`). A plan
recorded without a proposal ("just do it") is assigned directly. Each
`PlanTask` carries title, objective, agent, category, whySeparate,
whyThisAgent, skills, scope, dependsOn (indexes), expectedOutputs,
requiredChecks, optional `modelTier` (data only).

## Method

`MethodDefinition` has title, purpose, whenToUse, hardRules, preferences,
promptGuidance, skills, outputExpectations, checks, scopeRestrictions, and
`agentDefaults.modelTier`. Catalog definitions are carried in full inside
`method.applied` so replay never depends on catalog code. `resolveMethod`
applies overrides in order (a section override replaces that section). A
snapshot is the resolved definition at pin time; later overrides bump
`method.version` and leave the snapshot untouched (tested).

## "Right now" summary (`summarizeProject`)

Status precedence: open ask → `needs_you`; failed latest required check on an
open task → `reviewing`; any agent working/waiting → `working`; open proposal
→ `planning`; no tasks → `intake` (brief not ready) or `idle`; every agent
settled and some stopped → `partially_stopped`; every task done → `complete`;
otherwise `idle`. Attention item: first open ask, else first open proposal,
else first failed check, else intake. Counts per agent work state, open ask
and proposal ids, `lastSequence`. Deterministic (tested by double call).

## Persistence recommendation (Slice 2)

- Additive migration v3: `project_events` (same shape and append-only
  triggers as `events`, keyed `project_id, sequence`), `project_projections`,
  `messages (id PK, project_id, thread_id, sequence, message_json)` with an
  index on `(thread_id, sequence)` for `before`/`after` cursors,
  `command_receipts (command_id PK, project_id, first_sequence,
last_sequence, created_ids_json, response_json?)`.
- Factor the generic append/upsert/replay of `SqliteEventStore` into a
  stream-store helper parameterized by table names, parser and reducer, and
  keep `SqliteEventStore`'s public API unchanged (its tests are the
  regression net).
- One `database.transaction` per command: events + messages + receipt +
  projection upsert. Receipt lookup happens before the stale-sequence check.

## Validation

- `npm run verify` → exit 0 (prettier, eslint `--max-warnings=0`, tsc for
  all seven workspaces, vitest 14 files / 75 tests, client build).
- New tests: 26 in `project-projection.test.ts` (basics, messages vs work,
  lifecycles, plans/proposals, brief/method, summary, replay, exact plan
  rows, reducer-owned target sequences, single-application scope proposals,
  message references).
- Existing Increment 0–2 tests unchanged and passing.

## Known limits / risks

- `appliedEventIds` grows with the stream (same as the run projection);
  acceptable for local SQLite, revisit if projections get large.
- Message duplicate ids are not checked in the reducer (no messages in the
  projection); the `messages` table primary key will enforce it in Slice 2.
- Agent `lastSequence` is touched by every event on one of its tasks (asks,
  checks, outputs, handoffs, scope changes); intentional so activity on the
  task counts as activity on the agent, which is what a pane shows.
