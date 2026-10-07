# Surface audit: does the layout play to the idea?

A read of the project screen against what we set out to build, what data we
already hold and never show, and what to build next.

Written 2026-10-06, after the Map / Changes / Loose ends / task-naming work.

## The idea, restated

Conversation is the spine. The visual layer is not a dashboard beside it —
it is synchronized context that answers six questions and nothing else:

1. What is happening now?
2. Why is this agent doing it?
3. What is blocked, or waiting on me?
4. What changed?
5. What evidence says it worked?
6. What shaped the result — which Method, plan line, decision, model?

Anything on screen that answers none of these is furniture.

## Scorecard

| Surface                               | Verdict                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Panes, composer, tool rows, ask cards | **Right.** Recognisable, plain, the thing people already know. Leave it alone.                                             |
| Documents (Brief, Method, Plan)       | **Right.** Editable three ways, provenance recorded, per-line actions.                                                     |
| Artifacts viewer                      | **Right.** A working surface; text and files, not decoration.                                                              |
| Conversation ⇄ Map switch             | **Wrong shape.** The Map _replaces_ the spine. It is the only view of structure, and it is hidden exactly while work runs. |
| Right panel                           | **Wrong shape.** A static drawer of six documents you must choose from. It never follows the work.                         |
| Sidebar                               | **Mixed.** Navigation and settings in one column; Loose ends live only on the Map.                                         |
| Header                                | **Mostly right.** `Refresh` is a developer control in a product about live work; the status word carries no magnitude.     |

### The one structural problem

The spine is correct and the layer around it is still **user-driven
furniture rather than work-driven context**. Every visual surface waits to
be clicked. Nothing in the layout changes because the work changed —
except a chip in the header.

The original direction note already decided against this: _"the right panel
shows one lifecycle stage at a time… it should not become another scrolling
dashboard."_ We built the dashboard.

What a stage would do, from state we already have:

| Project state | Stage                                           |
| ------------- | ----------------------------------------------- |
| intake        | the Brief, filling in                           |
| planning      | the plan and its rationale                      |
| working       | the Map, live                                   |
| needs_you     | the ask, its scope and consequences             |
| reviewing     | the failed check, its output, the repair        |
| complete      | evidence: files, checks, what the Plan now says |

With a pin to override it, because sometimes you want to read the Method
while an agent works.

## Data we hold and never show

Every event carries `occurredAt`. The log already records `task.tool_used`,
`check.started` / `check.finished`, `output.produced`, `ask.opened` /
`ask.decided`, `task.state_changed`, `agent.model_changed`,
`plan.section_edited`, `method.*`.

None of it is shown as quantity or time:

- **No time anywhere.** `ChangeEntry.at` is computed in
  [project-changes.ts:71](apps/client/src/project-changes.ts:71) and never
  rendered. The ledger is ordered but undated.
- **No effort per task** — tool calls, reads vs writes vs commands, how long
  it ran, how many turns it took.
- **No record per agent** — tasks finished / failed / stopped, check pass
  rate, how often you approved versus denied its asks, which model it ran
  on and whether the tier changed mid-project.
- **No project shape** — which files are touched most, which Plan sections
  churn, where asks cluster, how long from assignment to first passing
  check.
- **No "most done"** — tasks ranked by evidence (files + passing checks)
  against effort (tool calls + duration).

All of it is derivable client-side from `/events`, exactly the way
`buildChanges` and `buildProjectMap` already work. No new events, no new
persistence, no new writes.

**One honest gap:** token and cost usage are _not_ recorded. The runtimes
never report them. "Agent usage" in the money sense needs a new field on the
runner result and an event to carry it — a real change, not a derivation.
Everything else above is free.

## Visualization, per tab

The split the product needs: **working surfaces stay plain, reading
surfaces earn a picture.**

Leave as text — these are where work happens:

- the panes and their tool rows
- Artifacts (code, markdown, previews)
- Method and Brief (documents you edit)
- Raw events (a developer toggle, correctly)

Make visual — these are where you read what happened:

- **Agents** — today a list with a task title and a model name. Should be
  the usage view: per agent, a run strip, a tool mix, an evidence meter, an
  ask record.
- **Plan** — a coverage bar per section: how many lines have a task, how
  many hang. The unclaimed part _is_ the loose end, drawn.
- **Changes** — a time ruler. Group by day, stripe by who, show the gaps.
- **Map** — weight the nodes: size or ink by evidence, dashed for
  unverified. Right now every node looks equally important.

### Five designs that would earn their space

1. **Run strip** — a thin horizontal timeline per task: one tick per tool
   call, coloured by kind (read / search / write / command), checks as
   taller marks, failures in the failure colour. Reads like a heartbeat;
   answers "what did it actually do" without scrolling the transcript.
   Clicking a tick scrolls to that row.
2. **Evidence meter** — three segments per task: passed, failed, nothing
   run. The "Unverified" label we already compute, given size.
3. **Tool mix bar** — stacked per agent across all its tasks. An agent that
   only ever reads looks different from one that writes without checking,
   at a glance.
4. **File heat** — files ranked by writes, each with the tasks that touched
   it. Answers "what is this project actually changing" and finds
   contention between agents.
5. **Coverage bar** on each Plan section — filled where a task exists.

Not worth building: donut charts, sparkline soup, anything averaged across
projects, anything we cannot point at an event for. Fabricated activity is
the one thing that would break the product's claim.

## Flow problems observed in use

- **`folder_required` arrives after approval.** You plan, you approve, and
  _then_ it refuses because no folder is attached. Observed live this
  session. The check belongs at plan time, or the Plan card should say it.
- **Loose ends are only on the Map**, so the one surface that says "you
  dropped this" is invisible from where you work.
- **Refresh is manual.**
- **The trust select sits in the sidebar**, far from the ask cards it
  governs.

## Plan

Ordered by leverage, each a reviewable commit with tests, as before.

1. **The right panel becomes a stage.** Follows project state, pin to
   override. Pure client work over the summary we already compute. This is
   the single change that turns the layer from furniture into context.
2. **`buildUsage(events)`** — the derivation layer: per task (tools by kind,
   duration, checks, outputs, asks), per agent (tasks by outcome, pass rate,
   ask record, models used), per file (writes, tasks, last touched). Tested
   like `buildChanges`. Nothing visual yet; everything below depends on it.
3. **Agents tab becomes the usage view** — run strip, tool mix, evidence
   meter, ask record. The first real answer to "what has this agent done".
4. **Time in Changes** — render `at`, group by day, "since I last looked".
5. **Map weight and file heat** — nodes sized by evidence, a Files column
   that ranks by churn.
6. **Claude runtime parity** — Plan/Method tools over MCP, forwarded
   follow-ups through streaming input, diffs on writes. Still outstanding
   from the previous audit; needed before the paid path is honest.
7. **Flow fixes** — folder check at plan time, Loose ends in the sidebar,
   auto-refresh, trust where the asks are.

Items 1–5 need no new persistence. Item 6 is runtime work. Item 7 is small.

## Left off

- **Claude runtime parity** (above) — the one unfinished item from
  `audit-and-direction.md`.
- **`conversation-first-direction-decision.md`** has been sitting untracked
  at the repo root since before this session. It is the clearest statement
  of the product's spine and should live in `docs/`.
- **Element grounding is lexical** — it finds ids and classes in markup and
  stylesheets. It does not resolve a React component to its source. Fine
  for the preview case it was built for; worth knowing before trusting it
  on a component tree.
- **Trust is per project only** — no per-agent override, though the ask
  card's "Approve all for this task" covers most of the need.
- `.claude/launch.json` was added this session so the app can be launched
  from the editor's preview pane.
