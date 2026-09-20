# Increment 2.6 — Projects, coordinator and agent conversations, proposals

Final handoff. The tree is **uncommitted** and **not pushed**, as required.
Slice reports with full detail: [Slice 1](increment-2-6-slice-1-foundation.md)
(contracts, reducer, policies), [Slice 2](increment-2-6-slice-2-first-thread.md)
(persistence, receipts, first thread), [Slice 3](increment-2-6-slice-3-planning.md)
(planning, dispersal, advancement), [Slice 4](increment-2-6-slice-4-intake-method.md)
(intake, Brief, Method, project panel). This document consolidates them.

## 1. What now works, from the user's side

- **Projects**: create one by name from the left panel; switch between them;
  the newest opens first. The demo project exists only behind
  `HARNESS_DEMO_PROJECT=1` (dev sets it).
- **Conversation first**: the default pane is an agent conversation on a
  persisted thread; the Coordinator is one click away. Up to three panes side
  by side on desktop, tabs on phones — every conversation reachable on every
  width.
- **Direct work**: type to an agent (`chat`, never creates work); `/start …`
  gives it a task; steer it while it works; **Stop** stops only that agent and
  keeps its outputs; `/start` again later on the same conversation.
- **Dispersed work**: tell the Coordinator what to build → plan card with
  tasks, owners, dependencies, checks, model tier, and rationale → **Assign
  to agents** (one transaction, creates missing agents), **Edit** (combine /
  split / add checks / assign X to Y → new plan version supersedes the old),
  or **Not now**. "Just do it: …" assigns straight away.
- **Per-agent progress**: **Next step** in each pane; Interface: contract →
  check → done; Backend: **Ask** (Approve / Deny) → failed check → repaired
  check + diff → done; a finished task hands its output to whoever waits on it.
- **Intake and Brief**: a new project starts with the Coordinator asking one
  field at a time; `field: value` lines, "skip", "yes" all work; the Brief
  panel shows every field's state and lets you confirm, edit, or skip; the
  Markdown and digest are deterministic.
- **Method, optional**: offered once in chat after the required fields are
  settled; or apply from the catalog in the Method panel; customize sections
  per project; every task assigned from then on pins the Method as it stood.
- **Right now**: the header shows the service's status (Getting started, Plan
  ready, Working, Needs you, Needs a fix, Complete, Partly stopped, Idle) and
  the one thing to look at, clickable to the right pane.
- **Recovery**: restart the service or wipe the projection tables and every
  project, thread, agent, task, plan, proposal, ask, check, output, Brief,
  Method, and snapshot is identical; retried commands are idempotent even
  when their sequence is stale.

Not real yet, said plainly in the UI: repository attachment, live providers,
diffs, terminals. Projects are created from a name and all work is simulated.

## 2. Event and command catalog

Project stream event envelope: `id, version: 1, sequence, occurredAt,
recordedAt, projectId, threadId?, agentId?, taskId?, correlationId?,
causationId?, source: user | coordinator | agent | system, adapter?, providerMetadata?`.
Envelope ids are provenance only; the reducer derives the affected thread /
agent / task from the payload and rejects an envelope id that disagrees.

| Event                                  | Payload                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `project.created`                      | `{ project }`                                                                             |
| `thread.opened` / `thread.closed`      | `{ thread }` / `{ threadId, reason }`                                                     |
| `message.posted`                       | `{ message }` (body lives in `messages`, never in the projection)                         |
| `brief.field_updated`                  | `{ fieldId, to, value?, source, messageId? }`                                             |
| `brief.request_recorded`               | `{ request }`                                                                             |
| `method.applied`                       | `{ definition, proposalId? }` (full definition inline)                                    |
| `method.override_recorded`             | `{ sectionId, value[] }`                                                                  |
| `method.snapshot_pinned`               | `{ snapshot }`                                                                            |
| `agent.created`                        | `{ agent }`                                                                               |
| `plan.recorded` / `plan.assigned`      | `{ plan }` / `{ planId, proposalId? }`                                                    |
| `task.assigned`                        | `{ task }`                                                                                |
| `task.state_changed`                   | `{ taskId, from, to, reason }`                                                            |
| `task.input_satisfied`                 | `{ taskId, upstreamTaskId, outputId }`                                                    |
| `task.scope_changed`                   | `{ taskId, proposalId, scope[] }`                                                         |
| `ask.opened` / `ask.decided`           | `{ ask }` / `{ askId, from: open, to: approved \| denied \| closed, note? }`              |
| `check.started` / `check.finished`     | `{ check }` / `{ checkId, from: running, to, summary }`                                   |
| `output.produced`                      | `{ output }`                                                                              |
| `proposal.opened` / `proposal.decided` | `{ proposal }` / `{ proposalId, from: open, to: approved \| denied \| dismissed, note? }` |

Commands (all behind the existing session + origin hook; bodies and
responses Zod-validated; errors `{ error, code }`):

| Method | Path                                                                                       | Body                                                                 | Sequence checked         |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------ |
| `GET`  | `/api/projects` · `/api/projects/:id` · `/api/projects/:id/events?after=` · `/api/methods` | —                                                                    | —                        |
| `POST` | `/api/projects`                                                                            | `{ commandId, name }`                                                | —                        |
| `POST` | `/api/projects/:id/agents`                                                                 | `{ commandId, expectedSequence, name, category }`                    | project                  |
| `GET`  | `/api/projects/:id/threads/:ref/messages`                                                  | `?before= \| ?after=`, `limit` 1–100                                 | —                        |
| `POST` | `/api/projects/:id/threads/:ref/messages`                                                  | `{ commandId, expectedSequence, body, intent?: chat \| start_work }` | thread                   |
| `POST` | `/api/projects/:id/agents/:agentId/advance` · `/stop`                                      | `{ commandId, expectedSequence }`                                    | agent                    |
| `POST` | `/api/projects/:id/agents/:agentId/asks/:askId`                                            | `{ …, decision: approved \| denied, note? }`                         | agent                    |
| `POST` | `/api/projects/:id/proposals/:proposalId`                                                  | `{ …, decision: approved \| denied \| dismissed, note? }`            | proposal                 |
| `POST` | `/api/projects/:id/method`                                                                 | `{ …, catalogId, catalogVersion }`                                   | method (project if none) |
| `POST` | `/api/projects/:id/method/overrides`                                                       | `{ …, sectionId, value[] }`                                          | method                   |
| `POST` | `/api/projects/:id/brief/fields/:fieldId`                                                  | `{ …, action: confirm \| correct \| skip, value? }`                  | brief                    |

`:ref` is `coordinator`, a thread id, or an agent id. Mutations return
`{ receipt, project }`. Error codes: `stale_sequence`, `already_decided`,
`agent_busy`, `ask_not_open`, `plan_superseded`, `invalid_transition`,
`thread_closed`, `not_found` (409/404); `message_empty`, `message_too_long`,
`invalid_command` (400). A client-supplied `author` is rejected.

## 3. How Agent, Conversation, Task, and Work are separated

- **Agent**: durable; `taskIds` is its history; `work` is **derived** in the
  reducer from its current task (`idle` when none), never set by an event.
- **Conversation (thread)**: durable; only `thread.closed` closes it (nothing
  emits that today). Task outcomes never touch it.
- **Task**: `waiting | working | needs_you | done | stopped | failed`; the
  three terminal states end the task, not the agent. `task.assigned` on an
  agent whose work is `idle/done/stopped/failed` starts new work; on a busy
  agent it is `agent_busy`.
- **Messages never create work**: intent is explicit (`chat` default,
  `start_work` user-only); the service creates a task only for `start_work`
  on an agent with nothing active, otherwise it replies and declines.
- **Stop** with an open ask: the ask is `closed` first (reducer refuses a
  terminal transition while an ask is open).

## 4. Plan revision and supersession

Plans are versioned records (`plan.recorded`, version = count + 1, with the
originating `request`). A new plan must `supersedesPlanId` the live
(unassigned, unsuperseded) one; the reducer marks the old plan and its open
proposal `superseded`. Only an approved, current plan assigns; every plan
row must be assigned exactly once (`planTaskIndex`), the task must match the
row on every field, and dependencies map to earlier rows' task ids.
Rules that revise: combine/merge/one agent → one task; split/two agents →
two tasks; add a check(s) → `experience-check` everywhere; `assign <task> to
<agent>` → owner change. Anything else is answered as not understood.

## 5. Deterministic scripts and classification phrases

- **Coordinator classification**, in order: record_request (scope: `only
touch`, `don't touch`, `do not touch`, `stay out of`, `only in`; permission:
  `permission`, `allow`, `read-only`, `read only`, `no writes`; dependency:
  `depends on`, `after the`, `blocked by`, `wait for`) → edit_plan (only with
  an open plan proposal: `combine`, `merge`, `one agent`, `single agent`,
  `split`, `two agents`, `separate`, `add a check`, `add checks`, `assign`,
  `reorder`, `swap`, `remove`, `drop`) → direct_work (a work verb plus `just
do it`, `go ahead`, `no need to confirm`, `don't ask`, `do not ask`, `skip
the plan`; or a direct phrase alone with an open proposal) → request_work
  (`build`, `implement`, `add`, `create`, `ship`, `make`, `write`, `fix`,
  `refactor`, `design`, `set up`) → note.
- **Intake** (notes while a Brief field is pending): priority goal, scope,
  doneMeans, constraints, checks, audience; `goal:` / `scope:` / `done:` /
  `constraints:` / `checks:` / `audience:` prefixes; `yes` confirms an
  inferred value, `skip / none / no / n/a` skips, other text answers or
  corrects. A work request with the goal missing infers the goal from its
  subject. The Method is offered once when the required fields are settled.
- **Agent chat**: status questions (`what changed`, `status`, `progress`,
  `where are you`, `are you done`) → state summary; other text while active →
  "Noted for …"; while idle → offer `/start`.
- **Agent steps** (`nextAgentStep`, derived from the task's evidence):
  orchestration: ask → failed check → repaired check + diff → done;
  interface/other: contract or note → check → done. Refused when
  `waiting`, `needs_you`, or terminal.
- Every simulated message and generated event carries
  `adapter: { id: 'simulated-conversation', version: '0.1.0', mode: 'simulated' }`.

## 6. Streams, tables, and transactions

One append-only stream per Project (`project_events`, keyed
`project_id, sequence`, append-only triggers), a materialized
`project_projections` row, `messages` (written on `message.posted` in the
same transaction, indexed by `thread_id, sequence`), and `command_receipts`.
Migration 3 is additive and idempotent; an upgrade test rolls a run-bearing
database back to v2, re-migrates, and proves run events and projections are
byte-identical. `SqliteEventStore` (run stream) and `SqliteProjectStore`
share one generic `SqliteStreamStore`; the run stream is the compatibility
path for the Increment 2 demo. Every command is one `ProjectBatch`: events
are reduced as they are produced (an invalid step fails before any write),
then events + messages + receipt commit in one `database.transaction`.
Dispersal and handoffs are single-stream, so no cross-stream reconciliation
exists or is needed. Tested: a busy row and an injected storage failure
during dispersal leave nothing behind and retry cleanly.

## 7. Command receipts

Looked up **before** the sequence check; stored with `first/lastSequence`
and `createdIds`. A retry returns HTTP 200 with `receipt.replayed: true`,
the original range, and the **current** project (never presented as the
historical one). Entity ids derive from the `commandId`
(`project_<cmd>`, `agent_<cmd>`, `task_<cmd>`, `message_<cmd>_<n>`), so a
retry cannot mint a second identity. Tested across every mutating command
with a stale `expectedSequence`.

## 8. Method structure and snapshot rules

`MethodDefinition`: id, version, title, purpose, whenToUse, hardRules,
preferences, promptGuidance, skills, outputExpectations, checks,
scopeRestrictions, agentDefaults.modelTier. Catalog versions are immutable
fixtures; `method.applied` carries the definition inline. Project-local
overrides append and bump the project's Method version; `resolveMethod`
applies them in order. A snapshot is pinned per task at `task.assigned`
(plan rows and `/start`); the reducer verifies it equals the resolved Method
at that moment, refuses a second pin, and later overrides never touch it.
`method: null` is the default and the whole scenario runs without one.

## 9. Message pagination and cursors

Cursor = the `message.posted` sequence (unique, monotonic per project).
Default: latest `limit` (1–100, default 50), oldest→newest, `olderCursor`
when more exist; `before=` walks older; `after=` walks newer and
`newerCursor` is always returned; `before` and `after` together → 400.
Tested with 120 messages: no gaps, no duplicates, bounds enforced.

## 10. "Right now" derivation (`summarizeProject`)

Status precedence: open ask → `needs_you`; failed latest required check on an
open task → `reviewing`; any agent working/waiting → `working`; open proposal
→ `planning`; no tasks → `intake` or `idle` by Brief readiness; all agents
settled with some stopped → `partially_stopped`; every task done →
`complete`; else `idle`. Attention: first open ask, else first open
proposal, else first failed check, else intake. Plus counts per work state,
open ask/proposal ids, `lastSequence`. Deterministic; the client renders it
and never derives its own.

## 11. Every file changed

New: `packages/contracts/src/{project-ids,project,project-events,project-projection,project-commands}.ts`;
`packages/domain/src/{project-transitions,project-projection,project-summary}.ts` + test;
`packages/persistence/src/{stream-store,project-store}.ts`;
`packages/runtime-simulated/src/{conversation,planning,intake}.ts`;
`apps/service/src/{brief,projects,project-routes}.ts` + `projects/planning/intake/recovery.test.ts`;
`apps/client/src/{live,live-pane,project-panel}.tsx/.ts` + tests;
`docs/increment-2-6-*.md`.
Modified: `packages/contracts/src/index.ts` (exports); `packages/domain/src/index.ts`,
`projections.ts` (error codes), `transitions.ts` (error entity type);
`packages/persistence/src/event-store.ts` (delegates to the generic store),
`index.ts`, `migrations.ts` (v3), `persistence.test.ts` (count, upgrade test);
`packages/runtime-simulated/src/index.ts`; `packages/config/src/index.ts`
(demo flag); `apps/service/src/app.ts` (project store, seed, routes),
`app.test.ts` / `demo-run.test.ts` (config field, migration count);
`apps/client/src/App.tsx` (projects, live panes, panel, right-now chip,
small-screen tab strip), `api.ts`, `panes.tsx` (menu label), `styles.css`,
`app-shell.test.tsx` (mock); `scripts/dev.mjs` (flag); `README.md`.

## 12. Validation performed

- `npm run verify` → exit 0: prettier, eslint `--max-warnings=0`, tsc on all
  seven workspaces, vitest **20 files / 112 tests** (was 14 / 75), client
  build. Existing Increment 0–2 tests unchanged and passing.
- Acceptance evidence from the implementation prompt, by number: 1 ordinary
  question → no task (`projects.test`); 2 explicit work → exactly one task
  (`projects.test`); 3 done/stopped/failed keeps the conversation, later
  `/start` works (`projects.test`, `planning.test`); 4 stop keeps outputs and
  closes the open ask (`planning.test`, domain); 5 revision supersedes,
  only the current version assigns (`planning.test`, domain); 6 rows carry
  rationale, skills, deps, evidence, tier (`planning.test`); 7 snapshot pinned
  at start, later Method changes leave it (`intake.test`, domain); 8 latest
  page, older/newer cursors gap- and duplicate-free (`projects.test`); 9
  right-now summary through working → needs you → reviewing → complete and
  partially stopped (`planning.test`, `recovery.test`, domain); 10 stale
  retry succeeds for every mutating command (`recovery.test`); 11 injected
  failure in dispersal leaves no partial state (`planning.test`,
  `projects.test`); 12 restart, projection wipe, and replay identical across
  every entity (`recovery.test`); 13 existing tests valid; 14 verify passes.
- Post-review regressions also cover direct orchestration check repair,
  duplicate-owner plan edits, direct Method application closing its open
  offer, cross-project receipt rejection, and required-only failed-check
  attention.
- Browser (always a scratch `HARNESS_DATA_DIR`, never the default directory):
  1440 with three panes, 800, 768, 375 (no horizontal scroll at any width;
  all conversations reachable via the tab strip on narrow screens). Flows
  driven end to end: direct work + stop; plan → edit → assign → steps →
  handoff → ask → failed check → repair → complete; new project → intake →
  Method offer → apply → customize → assign → pinned snapshots in Agents.

## 13. Remaining risk

- `appliedEventIds` grows with the stream (same pattern as the run
  projection); fine locally, revisit if projections get large.
- Plan edits are four documented rules; reorder/remove are recognised as
  intent but not applied. Script-only change when wanted.
- No polling: every reply is synchronous in the command response, which is
  true for the simulator and will not be for a live provider.
- The Increment 2 demo run remains as a compatibility path ("Plan demo" in
  the header, `/api/workspace`, `/api/demo-runs`); the fixture explorer is
  shown only when no project exists.

## 14. What the client changed (for the next increment)

`api.ts` gained: `listProjects`, `readProject`, `createProject`,
`readMessages`, `postMessage`, `stopAgent`, `advanceAgent`, `decideAsk`,
`decideProposal`, `listMethods`, `applyMethod`, `overrideMethod`,
`updateBriefField`, `readEvents`; `ApiError.code`. The UI gained `LivePane`
(real thread, cards for asks and proposals, Next step, Stop, `/start`,
`/stop`), `ProjectPanel` / `ProjectDetail` (switcher, New project, Brief,
Method, Plans, Agents, History), the right-now chip, and the small-screen
conversation strip. Nothing in the client owns lifecycle state; every
change comes back from the service.

## 15. Exact next step

Wire the remaining fixture surfaces off (the "Plan demo" path can be retired
once Codex agrees the run stream is no longer needed for regression), then
open the next major bridge as its own increment: **attach a local folder or
repository** to a Project (a documented seam today — `Project` has no
repository field on purpose), and behind it a **live provider adapter** that
produces the same `message.posted` / `output.produced` / `check.*` / `ask.*`
events the simulator does, with polling or a stream for asynchronous
replies. The conversation model, per-agent lifecycle, receipts, pagination,
and the right-now summary do not need to change for that.
