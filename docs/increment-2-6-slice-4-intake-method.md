# Increment 2.6 — Slice 4: intake, Brief, Method, and the project panel

Review checkpoint. Uncommitted. No reducer policy changed; no contract
changed. Slices 1–3 stand as reviewed.

## What works now, from the user's side

- **New project** in the left panel: type a name, press Enter. The
  coordinator opens with its first question and the Brief opens beside it.
- **Intake** is a conversation: the coordinator asks for one Brief field at
  a time (goal → scope → done means, then constraints, checks, audience).
  Answer in plain words, use `field: value` lines for several at once, say
  "skip", or say "yes" to confirm something it inferred. Three answers and
  the required fields are decided; the Brief panel updates live and the
  header moves from Getting started to Idle.
- **Brief panel**: each field with its state (Not yet decided / Inferred —
  confirm? / Confirmed / Skipped / Corrected), Confirm / Edit / Skip, the
  recorded requests, version and digest. Edits go through the same command
  the coordinator uses.
- **Method is offered once**, in chat, after the required fields are
  settled: "Default behavior is fine for most projects…" with Approve / Not
  now. Ignoring it never blocks anything.
- **Method panel**: "Default behavior" with the catalog (Evidence-led
  delivery, Fast prototype) and Apply; once applied, every section with its
  lines and **Customize** per section (project-local overrides, versioned).
  The panel says plainly that customizing changes future tasks only.
- **Pinned snapshots**: a task assigned (plan or `/start`) while a Method is
  applied pins it as it stands; later overrides bump the project's Method
  version and leave the snapshot alone. The Agents panel shows "Method …
  (pinned vN)" or "default behavior" per agent.
- **Plans panel**: every plan version with its status (proposed / assigned /
  superseded), rows with owner, dependencies, checks, model tier, rationale,
  and the live task state. **History panel**: the event log with source and
  adapter. **Project switcher** at the top of the panel.

## Files

| File                                       | Why                                                                                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/runtime-simulated/src/intake.ts` | `planIntake`, `pendingField`, `requiredFieldsSettled`, field priority/questions/prefix rules, `METHOD_CATALOG`, `findMethod`.                                                                                                                  |
| `apps/service/src/projects.ts`             | Coordinator `note` → intake while a field is pending; goal inferred from a work request; `offerMethodOnce`; `applyMethod`, `overrideMethod`, `updateBriefField`; `set_method` proposals apply from the catalog; `/start` tasks pin the Method. |
| `apps/service/src/project-routes.ts`       | `GET /api/methods`, `POST …/method`, `POST …/method/overrides`, `POST …/brief/fields/:fieldId`.                                                                                                                                                |
| `apps/service/src/intake.test.ts`          | 4 tests (below).                                                                                                                                                                                                                               |
| `apps/client/src/api.ts`                   | `listMethods`, `applyMethod`, `overrideMethod`, `updateBriefField`, `readEvents`.                                                                                                                                                              |
| `apps/client/src/project-panel.tsx`        | `ProjectPanel` (switcher, New project, section rows with honest notes) and `ProjectDetail` (Brief, Method, Plans, Agents, History).                                                                                                            |
| `apps/client/src/App.tsx`                  | Project list state, `openProject`, switcher and creation wiring; the fixture explorer remains only when no project exists.                                                                                                                     |
| `apps/client/src/styles.css`               | Panel styles; detail content no longer stretches to the column height.                                                                                                                                                                         |
| `apps/client/src/project-panel.test.tsx`   | 3 tests.                                                                                                                                                                                                                                       |

## Intake rules (documented)

Priority: goal, scope, doneMeans (required), constraints, checks, audience.
The pending field is the first by priority that is `missing` or `inferred`.

1. `goal:`, `scope:`, `done:` / `done means:`, `constraint(s):`, `check(s):`,
   `audience:` at the start of a line set that field — `confirmed` if it is
   the pending field (`corrected` if it was inferred), `inferred` otherwise.
2. No prefixes and the pending field is `inferred`: `yes / correct / right /
ok` → `confirmed`; `skip / none / no / n/a` → `skipped`; any other text →
   `corrected` with that text.
3. No prefixes and the pending field is `missing`: `skip` words → `skipped`;
   any other text → `confirmed` with that text (it answered the question).
4. The reply acknowledges what changed and asks the next question, or says
   "The Brief is ready" and points at agents.
5. A work request while the goal is `missing` infers the goal from its
   subject (`source: coordinator`) before proposing the plan.
6. Once the required fields are settled and no Method is applied, one
   `set_method` proposal is opened (never a second).

`source` on `brief.field_updated` is `coordinator` for inferred values and
`user` otherwise; `messageId` links the field to the message it came from.

## Method

Catalog is a fixture in `intake.ts`; a version's content never changes.
`method.applied` carries the full definition, so replay never depends on the
catalog. Overrides append (`method.override_recorded`), each bumps the
project's Method version; `resolveMethod` applies them in order. Snapshots
are pinned by `pinMethod` at every `task.assigned` (plan rows and `/start`)
when a Method is applied; the reducer verifies the snapshot equals the
resolved Method at that moment and refuses a second pin.

## Routes

| Method | Path                                      | Body                                                                          | Sequence checked              |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `GET`  | `/api/methods`                            | —                                                                             | —                             |
| `POST` | `/api/projects/:id/method`                | `{ commandId, expectedSequence, catalogId, catalogVersion }`                  | method (or project when none) |
| `POST` | `/api/projects/:id/method/overrides`      | `{ commandId, expectedSequence, sectionId, value[] }`                         | method                        |
| `POST` | `/api/projects/:id/brief/fields/:fieldId` | `{ commandId, expectedSequence, action: confirm \| correct \| skip, value? }` | brief                         |

## Validation

- `npm run verify` → exit 0: prettier, eslint (0 warnings), tsc ×7, vitest
  **19 files / 106 tests**, client build.
- Service tests: intake walk (confirmed answer, two prefixed fields with one
  inferred, correction, Method offered exactly once, skips, ready; identical
  renders; field edit outside chat changes the digest; stale brief sequence →
  409; a note after intake is a note); goal inferred from a work request;
  Method (catalog, override before apply → 400, unknown method → 404, task
  started before the Method has no snapshot, later task pins v1, override
  → v2 leaves the snapshot, a plan pins v2 on both rows, `pin_method`
  listed in consequences); offer → approve applies from the catalog.
- Client tests: panel notes and New project; Confirm sends the brief
  sequence; catalog shown while default.
- Browser (scratch data dir): New project → three intake answers → Brief
  ready, Method offered → approve → Method panel with sections → "Just do it:
  build the export job" → Agents panel shows both agents with "Method
  Evidence-led delivery (pinned v1)"; 375 — no horizontal scroll.

## Known limits (deliberate)

- Intake asks the optional fields too (constraints, checks, audience) until
  each is answered or skipped; the Brief is "ready" as soon as the required
  three are settled, and the header/panel say so.
- The coordinator's method offer uses one fixed catalog entry; choosing
  another is done from the Method panel.
- `set_method` proposals are the only Method change the coordinator makes;
  overrides are panel-only.
- Repository attachment remains the next seam: projects are still created
  from a name and all work is simulated.
