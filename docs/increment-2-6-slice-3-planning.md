# Increment 2.6 — Slice 3: planning, dispersal, and independent advancement

Review checkpoint. Uncommitted. Builds on Slices 1–2; no reducer policy
changed. One contract addition: `Plan.request` (the request a plan answers,
so a revision can re-derive it).

## What works now, from the user's side

- Open the **Coordinator** pane and say what to build ("Build the account
  preferences form"). The coordinator posts a **plan card**: numbered tasks,
  owner, dependencies, required checks, model tier, why this many, and what
  assigning will do. **Assign to agents**, **Edit**, or **Not now**.
- **Edit** puts the change in the same conversation: "combine into one
  agent", "split into two agents", "add checks", "assign <task> to <agent>".
  Plan v2 replaces v1 (v1's card disappears; history keeps it). A change the
  coordinator cannot make is said plainly.
- "Just do it: build X" skips the card and assigns straight away.
- **Assign** creates any missing agents, gives each its task, and each agent
  pane shows "Assigned: …". Everything in one command; if any agent is busy,
  nothing is assigned.
- Each agent pane has **Next step**. Interface: contract → check → done.
  Backend: **Ask** (card with Approve / Deny) → failed check ("Needs a fix" in
  the header) → repaired check + diff → done. When Interface finishes,
  Backend's pane says "Received Interface contract… Starting" — the handoff
  is real and gated on the output.
- Deny an ask → only that task fails; `/start` the same agent again later.
  Stop with an open ask → the ask is closed, not left hanging.
- Scope/permission language in the coordinator ("only touch apps/client")
  becomes a **Record in Brief** card; approving appends to the Brief.
- The header shows the service's **right now**: status and the one thing to
  look at (an ask, a plan, a failed check), clickable to the right pane.

## Files

| File                                             | Why                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/runtime-simulated/src/planning.ts`     | `classifyCoordinatorMessage`, `planFromRequest`, `revisePlan`, `nextAgentStep`. Pure; keyword tables exported.                                                                                                                           |
| `packages/contracts/src/project.ts`              | `Plan.request`.                                                                                                                                                                                                                          |
| `apps/service/src/projects.ts`                   | Coordinator handling (`note`, `record_request`, `edit_plan`, `request_work`, `direct_work`), `recordPlan`, `proposePlan`, `disperse` (atomic), `pinMethod`, `decideProposal`, `advanceAgent`, `materializeStep`, `handOff`, `decideAsk`. |
| `apps/service/src/project-routes.ts`             | `POST …/proposals/:id`, `POST …/agents/:id/advance`, `POST …/agents/:id/asks/:askId`.                                                                                                                                                    |
| `apps/service/src/planning.test.ts`              | 6 tests (below).                                                                                                                                                                                                                         |
| `apps/client/src/api.ts`                         | `advanceAgent`, `decideAsk`, `decideProposal`.                                                                                                                                                                                           |
| `apps/client/src/live-pane.tsx`                  | `ProposalCard`, `AskCard`, Next step, Edit hint; ask messages render as the card, not prose.                                                                                                                                             |
| `apps/client/src/App.tsx`                        | Right-now status label and attention chip from `project.summary`.                                                                                                                                                                        |
| `apps/client/src/styles.css`                     | Plan rows wrap (title, then owner line); small header buttons stay on one line.                                                                                                                                                          |
| `packages/domain/src/project-projection.test.ts` | Fixture gains `request`.                                                                                                                                                                                                                 |

## Coordinator classification (documented keyword rules)

Checked in this order:

1. **record_request** — scope: `only touch`, `don't touch`, `do not touch`,
   `stay out of`, `only in`; permission: `permission`, `allow`, `read-only`,
   `read only`, `no writes`; dependency: `depends on`, `after the`,
   `blocked by`, `wait for`.
2. **edit_plan** (only while a plan proposal is open) — `combine`, `merge`,
   `one agent`, `single agent`, `split`, `two agents`, `separate`,
   `add a check`, `add checks`, `assign`, `reorder`, `swap`, `remove`, `drop`.
   Rules that produce a change: combine/merge/one agent/single agent → one
   task; split/two agents/separate → two tasks; add a check(s) →
   `experience-check` on every task; `assign <task words> to <agent name>` →
   that row's owner. Anything else is answered as "could not turn that into a
   plan change" with the options.
3. **direct_work** — a work verb plus `just do it`, `go ahead`, `no need to
confirm`, `don't ask`, `do not ask`, `skip the plan`; or a direct phrase
   alone while a plan proposal is open (assigns that plan and marks its
   proposal approved "in chat").
4. **request_work** — `build`, `implement`, `add`, `create`, `ship`, `make`,
   `write`, `fix`, `refactor`, `design`, `set up`.
5. **note** — anything else (Slice 2 acknowledgement; intake in Slice 4).

Subject = text after the first work verb, articles stripped, ≤ 60 chars.
Default plan: two rows — "Define the <subject> experience" (Interface
systems, `contract-check`, standard) → "Implement and verify the <subject>
service handoff" (Backend orchestration, `experience-check`, deep, depends on
row 0). Every row carries objective, whySeparate, whyThisAgent, skills,
scope, expectedOutputs, requiredChecks, modelTier.

## Dispersal (one transaction)

For each row in order: find the agent by name or create it (thread + agent);
refuse with `agent_busy` if it is `waiting/working/needs_you` (the whole
batch is discarded, nothing partial — tested with a busy row 1 and with an
injected storage failure); `task.assigned` with `planId`, `planTaskIndex`,
the row verbatim, `dependsOn` mapped to earlier rows' task ids;
`method.snapshot_pinned` when a Method is applied; a coordinator message in
the agent's thread. Then `plan.assigned` and one summary message in the
coordinator thread.

## Per-agent step table (`nextAgentStep`)

Derived from the task's own evidence, so it is replay-safe. Refused (409
`invalid_transition`) when the task is `waiting`, `needs_you`, or terminal.

| Category          | Condition                                                  | Step                                                    |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| orchestration     | no ask yet                                                 | `ask.opened` + `working → needs_you` + "Needs you: …"   |
| orchestration     | no outputs, no checks                                      | say; `check` failed; say                                |
| orchestration     | a required check not passed                                | `check` passed (`retryOf` previous) + diff output + say |
| orchestration     | all passed                                                 | `done` + say                                            |
| interface / other | no output                                                  | contract (interface) or note output + say               |
| interface / other | a required check not passed, or none required and none run | `check` passed + say                                    |
| interface / other | otherwise                                                  | `done` + say                                            |

**Handoff** (`handOff`): when a task reaches `done`, every `waiting` task
that depends on it gets `task.input_satisfied` with the finished task's
latest output; if all its inputs are in, `waiting → working` and its agent
posts "Received <output> from <agent>. Starting …". Otherwise "Still waiting
on other inputs."

**Asks**: approve → `ask.decided approved`, `needs_you → working`; deny →
`ask.decided denied`, `needs_you → failed`, agent explains. Deciding twice →
409 `ask_not_open`. Stop with an open ask closes it first (Slice 2).

## Proposal decisions

`POST /api/projects/:id/proposals/:proposalId` `{ commandId,
expectedSequence (proposal.lastSequence), decision: approved | denied |
dismissed, note? }`. Approved: `plan` → dispersal; `record_request` →
`brief.request_recorded`; `change_task_scope` → `task.scope_changed`;
`set_method` → refused until Slice 4. Denied / dismissed → a coordinator
message; the proposal keeps that state. Already decided or superseded →
409 `already_decided`.

## Validation

- `npm run verify` → exit 0: prettier, eslint (0 warnings), tsc ×7, vitest
  **17 files / 99 tests**, client build.
- New service tests: plan proposal with rationale → edit supersedes →
  superseded cannot be decided → unrecognised edit leaves it alone → approve
  assigns exactly the current version → second approve 409; "just do it"
  creates agents and assigns directly; scope request dismissed then approved
  → Brief; dispersal refused by a busy row and by an injected failure leaves
  nothing partial and retries cleanly; full two-agent walk (waiting refused,
  three Interface steps, handoff message, ask, decide twice, failed check →
  reviewing, repaired with `retryOf`, complete) and restart equality; deny
  fails one task only, restart the agent, stop closes the open ask.
- Browser (scratch data dir): 1440 with three panes — the whole loop above,
  header chip moved Getting started → Plan ready → Working → Needs you →
  Needs a fix → Complete; 375 — no horizontal scroll.

## Known limits (deliberate)

- Plan edits beyond the four documented rules are refused with guidance;
  no free-form plan editor. Reorder/remove are recognised as edit intent but
  not yet applied (they fall into the "could not turn that into a change"
  reply). Adding them is a script change, not a model change.
- The left project panel still shows the fixture Brief/Method/Plan; it is
  rewired in Slice 4 together with New project and intake.
- No polling; every reply is synchronous in the command response.
