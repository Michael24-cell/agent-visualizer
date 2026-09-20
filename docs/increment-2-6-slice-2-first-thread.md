# Increment 2.6 — Slice 2: persistence and the first real thread

Review checkpoint. Uncommitted. Builds on Slice 1 without changing its
contracts or reducer policies (one additive tightening: plan-derived tasks
must match their plan row on every field, not just title/category).

## What works now, from the user's side

- Start the app (dev turns on `HARNESS_DEMO_PROJECT=1`) and the first pane
  is an **agent conversation on a persisted thread**: Interface systems.
  Backend orchestration and the project's Coordinator open from the header.
- Type into the agent: an ordinary message ("What changed?") gets a reply
  and creates nothing. `/start <request>` creates one task and the agent
  shows **Working** with the task in its header. Messages during work are
  steering, not new tasks. **Stop** (button or `/stop`) stops that agent
  only; its thread and messages stay, and it shows **Stopped**. `/start`
  again gives the same agent new work.
- Reload the page: everything is still there. Restart the service: same.
- The coordinator thread answers, but says plainly that it does not plan or
  disperse yet (Slice 3).
- Not connected yet: the left project panel (Brief / Method / Plan) still
  shows the fixture; the "Plan demo" menu still opens the Increment 2 demo
  run. Both are labeled and are replaced in Slices 3–4.

## Files

| File                                                       | Why                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/persistence/src/migrations.ts`                   | Migration 3 (additive): `project_events`, `project_projections`, `messages`, `command_receipts`, with the same append-only triggers as `events`.                                                                                                                |
| `packages/persistence/src/stream-store.ts`                 | Generic append-only stream store (events + materialized projection, idempotent re-append, replay). Parameterized by table names, parser, reducer.                                                                                                               |
| `packages/persistence/src/event-store.ts`                  | `SqliteEventStore` now delegates to the generic store. Public API unchanged; existing run tests are the regression net.                                                                                                                                         |
| `packages/persistence/src/project-store.ts`                | `SqliteProjectStore`: project stream, `messages` written on `message.posted` inside the same transaction, cursor pagination, receipts.                                                                                                                          |
| `packages/persistence/src/persistence.test.ts`             | Migration count → 3; **upgrade test**: a DB with a completed run is rolled back to v2 and re-migrated; run events and projection are byte-identical before/after and after rebuild.                                                                             |
| `packages/runtime-simulated/src/conversation.ts`           | Pure, deterministic `planAgentIntents` / `planCoordinatorIntents` and `titleFromRequest`. Keyword rules documented in code.                                                                                                                                     |
| `apps/service/src/brief.ts`                                | One Markdown renderer + sha256 digest for the Brief.                                                                                                                                                                                                            |
| `apps/service/src/projects.ts`                             | `ProjectService`: `ProjectBatch` (reduce-as-you-go, one transaction for events + messages + receipt), receipt-first idempotency, per-target sequence checks, commands: create project, create agent, post message (agent / coordinator), stop agent, demo seed. |
| `apps/service/src/project-routes.ts`                       | Routes (below). Boundary-validated in and out; `{ error, code }` on failure.                                                                                                                                                                                    |
| `apps/service/src/app.ts`                                  | Rebuilds project projections on start, seeds the demo project behind the flag, registers routes.                                                                                                                                                                |
| `apps/service/src/projects.test.ts`                        | 9 tests (below).                                                                                                                                                                                                                                                |
| `packages/config/src/index.ts`                             | `HARNESS_DEMO_PROJECT` → `config.demoProject` (default off).                                                                                                                                                                                                    |
| `packages/contracts/src/project-commands.ts`               | `CreateAgentCommandSchema`.                                                                                                                                                                                                                                     |
| `packages/domain/src/project-projection.ts`                | Plan-row match now covers objective, agent name, skills, scope, expected outputs, required checks, model tier, rationale, and dependencies mapped to the upstream rows' task ids.                                                                               |
| `apps/client/src/api.ts`                                   | `listProjects`, `readProject`, `createProject`, `readMessages`, `postMessage`, `stopAgent`; `ApiError.code`.                                                                                                                                                    |
| `apps/client/src/live.ts`, `live-pane.tsx`                 | The pane on a real thread: latest page on open, "Show earlier messages", newer-after-command, `/start`, `/stop`, Stop button, 409 → refresh and ask to resend.                                                                                                  |
| `apps/client/src/App.tsx`                                  | Loads the first project; its first agent is the default pane; live targets open from the header; fixture rooms stay behind "Plan demo".                                                                                                                         |
| `apps/client/src/panes.tsx`                                | `AddPaneMenu` takes a label.                                                                                                                                                                                                                                    |
| `apps/client/src/styles.css`                               | `.pane` gets an explicit `minmax(0,1fr)` column (phones no longer scroll sideways).                                                                                                                                                                             |
| `apps/client/src/live-pane.test.tsx`, `app-shell.test.tsx` | 2 new tests; shell tests mock the project API.                                                                                                                                                                                                                  |
| `scripts/dev.mjs`                                          | Sets `HARNESS_DEMO_PROJECT=1` for dev only.                                                                                                                                                                                                                     |

## Routes

| Method | Path                                      | Body / query                                                         | Sequence checked |
| ------ | ----------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| `GET`  | `/api/projects`                           | —                                                                    | —                |
| `POST` | `/api/projects`                           | `{ commandId, name }`                                                | — (new stream)   |
| `GET`  | `/api/projects/:id`                       | —                                                                    | —                |
| `GET`  | `/api/projects/:id/events`                | `?after=`                                                            | —                |
| `POST` | `/api/projects/:id/agents`                | `{ commandId, expectedSequence, name, category }`                    | project          |
| `GET`  | `/api/projects/:id/threads/:ref/messages` | `?before= \| ?after=`, `limit` 1–100 (default 50)                    | —                |
| `POST` | `/api/projects/:id/threads/:ref/messages` | `{ commandId, expectedSequence, body, intent?: chat \| start_work }` | thread           |
| `POST` | `/api/projects/:id/agents/:agentId/stop`  | `{ commandId, expectedSequence }`                                    | agent            |

`:ref` is `coordinator`, a thread id, or an agent id. Mutations return
`{ receipt, project }`; `receipt.replayed` is true on an idempotent retry
(HTTP 200 instead of 201) and its sequence range is the original one while
`project` is current. Errors: `stale_sequence`, `thread_closed`,
`invalid_transition` (stop with nothing in progress), `agent_busy`, `not_found`
→ 404/409; `message_empty`, `message_too_long`, `invalid_command` → 400.
A client-supplied `author` is rejected by the strict schema.

## Command receipts

Looked up **before** the sequence check. Persisted in the same transaction
as the events and messages (`ProjectBatch.commit` → `store.transaction`).
Injected failure on the receipt write leaves no events, no messages, no
receipt; the retry then commits once (tested).

## Ids

Deterministic from the command: `project_<commandId>`,
`thread_<commandId>` / `agent_<commandId>`, `task_<commandId>`,
`message_<commandId>_<n>`, `event_<projectId>_<sequence>`. Retrying a
command therefore cannot mint a second identity even without the receipt.

## Message pagination

Cursor = the `message.posted` event sequence. Default: latest `limit`
messages, oldest→newest, with `olderCursor` when more exist. `before=`
walks older; `after=` walks newer (reconnect / poll) and `newerCursor` is
always returned. Tested with 120 messages in pages of 50: no gaps, no
duplicates, bounds enforced, no bodies in the projection.

## Simulator scripts (Slice 2)

Agent, `chat`: status question (`what changed / status / progress / are you
done …`) → state summary; otherwise, while a task is active → "Noted for
'<task>'"; otherwise → "Noted. Nothing is in progress… use /start". Agent,
`start_work`: if active → refuse and suggest stop; else `assign_task`
(title = first line, ≤ 80 chars) + "Starting: …". Coordinator: acknowledges,
names available agents, says planning arrives later. Every simulated
message carries `adapter: { id: 'simulated-conversation', version,
mode: 'simulated' }`.

## Validation

- `npm run verify` → exit 0: prettier, eslint (0 warnings), tsc ×7, vitest
  **16 files / 93 tests**, client build.
- Service tests: create+retry, coordinator chat, agent lifecycle (chat → no
  task; start → one task; steer; busy start refused; stop keeps thread;
  start again; stop-nothing → 409), per-thread staleness + receipt wins,
  validation errors, pagination, restart replay equality (projection,
  messages, events → `replayProjectEvents` equal), demo flag on/off/restart,
  atomicity with injected failure.
- Browser (scratch data dir, never the default): 1440 — two live panes side
  by side, project panel; 800 — single pane; 375 — no horizontal scroll.
  Chat → no task; `/start` → Working + Stop; steer; reload persists; Backend
  `/start` while Interface Stop → only Interface stopped.

## Known limits (deliberate, next slices)

- No polling: replies are synchronous in the command response, which is
  true for the simulator. Slice 3's `advance` will need the same.
- On phones the header "Open" menu is hidden (same as the fixture menu), so
  only the default pane is reachable there. UI wiring is Slice 4.
- The coordinator does not plan or disperse; the fixture plan demo remains
  behind "Plan demo" until Slice 3 replaces it.
- Repository attachment stays a documented seam: projects are created from
  a name and all work is simulated.
