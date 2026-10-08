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
- **No cost.** Both runtimes hand us token usage on every finish and we
  drop it. See "Cost and model fit" below.

All of it is derivable client-side from `/events`, exactly the way
`buildChanges` and `buildProjectMap` already work. No new events, no new
persistence, no new writes.

**One correction to the first draft of this audit:** token usage is not
missing, it is discarded. Both runtimes already receive it and throw it
away, so cost tracking is a small change, not instrumentation work — see
"Cost and model fit" below. Everything else above is a pure derivation.

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
6. **Cost and model fit** — record real token usage, price it, show it, and
   say when a task belonged on a different model. Specified below.
7. **Claude runtime parity** — Plan/Method tools over MCP, forwarded
   follow-ups through streaming input, diffs on writes. Still outstanding
   from the previous audit; needed before the paid path is honest.
8. **Flow fixes** — folder check at plan time, Loose ends in the sidebar,
   auto-refresh, trust where the asks are.

Items 1–5 need no new persistence. Items 6–7 are runtime work. Item 8 is
small.

## Cost and model fit (plan item 6)

The audit said token usage is not recorded. It is, however, _handed to us
and dropped_ — both runtimes already receive it:

- **Claude.** The Agent SDK's `result` message carries `usage`,
  `modelUsage` (per-model totals; the SDK's own docs call this "the correct
  field for token/cost accounting"), `total_cost_usd`, `duration_ms` and
  `num_turns`. [mapper.ts](packages/runtime-claude/src/mapper.ts) reads
  `subtype` and the result text and ignores all of it.
- **OpenAI-compatible (Groq, Ollama).** The endpoint returns a standard
  `usage` object. Our `ChatCompletion` interface in
  [runner.ts:51](packages/runtime-openai/src/runner.ts:51) simply does not
  declare the field, so it is parsed away.

So this is not instrumentation work. It is picking up two numbers we are
already being given.

### Prices

Anthropic first-party rates, per million tokens. Your recollection was
right about Haiku and close on Sonnet — Sonnet 5 is $2 in, $10 out.

| Model                       | Input | Output | Context |
| --------------------------- | ----- | ------ | ------- |
| Claude Haiku 4.5            | $1.00 | $5.00  | 200K    |
| Claude Sonnet 5             | $2.00 | $10.00 | 1M      |
| Claude Sonnet 4.6           | $3.00 | $15.00 | 1M      |
| Claude Opus 5               | $5.00 | $25.00 | 1M      |
| Claude Opus 4.8 / 4.7 / 4.6 | $5.00 | $25.00 | 1M      |

The three tiers we expose today are Haiku, Sonnet 5 and Opus 5, so the
spread that matters is **5× on input and 5× on output between Haiku and
Opus**, with Sonnet at 2×/2× over Haiku.

Two discounts change the arithmetic more than model choice usually does:

- **Prompt caching** — a cache read costs roughly a tenth of an input
  token; writing the cache costs about 1.25×. A long system prompt or a big
  file read repeatedly is the cheapest thing in the project if it is cached
  and the most expensive if it is not.
- **Batch** — 50% off, for work that does not need to be interactive.

These are first-party rates. Bedrock and Vertex are partner-operated and
priced separately; Groq's free tier is $0, which makes it the baseline to
compare _against_, not a number to display as a win.

### What to build

1. **A price table in contracts**, beside `AGENT_MODELS`: input, output,
   cache-read and cache-write rates per model id, with the date the rates
   were read. Prices change; a stale number presented as fact is the kind
   of thing this product exists to avoid, so it carries its date.
2. **Record usage.** Both runtimes return `{ inputTokens, outputTokens,
cacheReadTokens, cacheWriteTokens, modelId, durationMs, turns }` on
   finish; a `task.usage_reported` event carries it; the projection sums it
   per task and per agent. One event, one reducer case.
3. **Price it in the derivation layer** (`buildUsage`, item 2): cost per
   task, per agent, per project, computed from recorded tokens and the
   table — never from a vendor total alone, so the arithmetic is
   inspectable. Where Claude gives `total_cost_usd`, show both and say
   which is the vendor's estimate.
4. **Show it where the decision is made.** The model picker beside Send
   already names the model; it should name the price (`Haiku · $1/$5 per
M`). The Agents tab shows spend per agent and per task. The project
   header shows the run total, because a number you never see is a number
   you never manage.
5. **Say when the model was wrong — from the recorded shape, not vibes.**
   The honest form is a counterfactual on real token counts: _"this task
   used 180K in / 12K out, all reads and one small edit, no failed checks.
   On Haiku that is $0.24 instead of $1.20."_ Rules worth encoding, each
   derived from data we already keep:
   - a task whose tools were all `Read` / `Grep` / `Glob` with no failed
     check did not need the deep tier;
   - a task that failed the same check twice, or was stopped and
     restarted, is evidence for raising the tier, not lowering it;
   - a long Opus task with a small diff is the expensive shape;
   - cache-read share near zero on a repeated-context agent is a bigger
     saving than any model swap.

   Shown as a note on the task, with the numbers behind it, and never
   applied automatically — the model is the user's choice.

**Honest limits to state in the UI.** Token counts are not strictly
comparable across models (Opus 4.7 and later use a different tokenizer, so
a counterfactual is an estimate, not a quote). `total_cost_usd` is the
SDK's own estimate, not a bill. And nothing here knows about your plan,
rate limits, or discounts — it prices list rates against recorded tokens.

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
