# User flow plan

What a person does with the harness, from opening it to shipping a change,
and what to build or fix so each step is obvious. Written 2026-09-21 after
the first end-to-end runs on a free model (Groq `openai/gpt-oss-120b`).

The product, in one line: a Claude Code–style coding workspace first, with
planning, guidance, Method and multi-agent coordination layered over it.
Every step below is judged against that order.

## The flow as it exists today

1. **Start screen** — projects on the left, one composer. Typing creates a
   project and hands the words to the coordinator. A folder can be chosen
   before pressing Enter.
2. **Project screen** — a coordinator pane (plans with you) and agent panes
   (you type, they work). Left: conversations and the Project documents
   (Brief, Method, Plan, Agents, Artifacts, History). Right: the document
   you open.
3. **Giving work** — type into an idle agent pane and it starts. While it
   runs, messages are forwarded to it. `/chat` talks without starting,
   `/stop` stops. The coordinator can also propose a task plan that creates
   agents and assigns work.
4. **Watching work** — tool rows in the conversation (Read, Bash with its
   result, Write, Plan/Method edits), asks as cards (Approve, Approve all
   for this task, Deny), the model's summary at the end, "Unverified" when
   nothing was run.
5. **Documents** — Plan (sections) and Method (sections) are edited by you
   in place, by telling the coordinator, or by agents through tools. Every
   edit shows who made it; a changes strip lists what changed.
6. **Artifacts** — files agents wrote, rendered beside the conversation and
   refreshing while they work.

## Where people get lost (observed)

- **Which pane to type in.** The start composer goes to the coordinator,
  which plans instead of doing. Someone who wants "add a line to README"
  meets a two-task plan and sets it aside — then has no agent pane until
  they find _New agent_.
- **Folder is optional and easy to skip.** Live work needs one; the error
  arrives only when the first task starts.
- **The coordinator's plans read as scaffolding**, not as a real plan for
  the request ("Define the … experience", "Implement and verify the …
  service handoff"). They are simulator output and it shows.
- **Runtime setup is invisible.** Simulated vs live, which model, whether a
  key is set — only the badge says, and only after a project is open.
- **Method is a catalog with two fixture entries.** Applying one changes
  nothing visible until a task pins it.
- **"Done" is not the same as "worked".** The model's summary can claim
  verification; the harness shows the truth (failed checks, Unverified),
  but the two sit next to each other with equal weight.

## The flow we want

Each numbered step is a stage; the bullets are the changes that make it
obvious. Ordered by priority against the product definition.

### 1. Start: one decision, then typing

- The start composer asks one thing first: **where is the code?** Folder
  picker inline, recent folders as one-click chips, "no folder — just
  plan" as the explicit alternative. A project without a folder is
  visibly a planning project.
- Typing on the start screen **starts an agent**, not the coordinator,
  when a folder is attached. The coordinator stays one click away
  (sidebar) for people who want a plan first. Rationale: the workspace is
  the product; planning is layered.
- Runtime is shown on the start screen with a plain sentence and a link
  to fix it: "Agents run on gpt-oss-120b via Groq" / "Agents are
  simulated — add a key to run them". Setup happens in a small panel
  (`.env.local` fields), not in a terminal.

### 2. Project: the first pane is ready to type into

- Every project opens on an agent pane with the composer focused. New
  projects get one agent by default ("Agent 1", renamable inline by
  clicking the name).
- The header answers three questions at a glance: which folder, which
  model, what needs me. Nothing else.
- The sidebar lists conversations first, documents second, with honest
  notes ("empty", "2 sections", "1 file"). Same as today; keep it.

### 3. Work: give it, watch it, steer it

- Tool rows stay as they are. Add two things: a **diff view** on Write
  rows (what changed, not "Wrote README.md"), and a **"stop and tell me
  why"** when a task fails, pinned above the composer with the reason.
- **Trust** becomes a per-project setting as well as per-task: "always
  ask", "ask once per task", "ask for commands only". Default: ask once
  per task, because that is what people chose in the first runs.
- Follow-ups are forwarded (done). Show a small "handed to Agent 1"
  marker on the forwarded message so it is clear it was not a new task.
- Long runs: the pane shows elapsed time and the last tool, and the tab
  badge shows needs-you. Stop is always one click.

### 4. Plan: from words to work, and back

- The coordinator's task plan is rebuilt on the **Plan document**: the
  request populates Overview/Features first (simulator can do this by
  keyword; live models do it properly), then proposes tasks that
  reference sections. A plan that reads like the request is one people
  will approve.
- Tasks rows link to the sections they implement; a section shows which
  tasks touched it. This is the "visual planning" layer in the product
  definition, made from data that already exists.
- Agents update the Plan as they finish (done for the tools; add a nudge
  in the task prompt: "if the plan's Features no longer match, update
  them").

### 5. Method: rules you can feel

- Ship three real Methods, not two fixtures: _Careful_ (read before edit,
  tests before done, small diffs), _Fast prototype_ (write whole files,
  skip checks), _Docs only_ (no code changes). Applying one changes the
  next task's prompt and the tool set, visibly.
- Method edits by agents stay overrides (done). Add "reset to catalog".

### 6. Artifacts: see the result

- Viewer exists. Add: open a file from any tool row (Read too), a
  breadcrumb path, and a "reveal in Finder / open in editor" action.
- HTML artifacts preview live; markdown renders. Add image files.

### 7. Multi-agent: only when it earns it

- Keep agents side by side with per-agent Stop. Do not add "run all".
- When two agents write the same file, the harness says so in both panes
  (a conflict row) instead of last-write-wins silently.

## Runtime and model plan

- **Free path (default for now):** Groq free tier, `openai/gpt-oss-120b`,
  full tools. Ollama stays supported for offline use with whole-file
  writes.
- **Paid path:** Claude via the Agent SDK. Before switching on: expose the
  Plan/Method tools over MCP so the same rows appear; forward follow-ups
  through streaming input; verify the permission bridge with a real key.
- **Model picker:** per agent for Claude (Opus/Sonnet/Haiku, exists), a
  single configured model for OpenAI-compatible runtimes (exists). Add a
  runtime switch in the setup panel rather than env vars.

## Order of work

1. Start screen: folder first, typing starts an agent, runtime sentence
   and setup panel. (Removes the two biggest sources of confusion.)
2. Default agent per project; rename; diff view on Write rows; failure
   pinned above the composer.
3. Per-project trust setting; forwarded-message marker; elapsed time.
4. Plan rebuilt on the document; tasks linked to sections.
5. Three real Methods; reset to catalog.
6. Artifacts: open from any row, images, reveal in Finder.
7. Claude runtime parity (MCP tools, streaming follow-ups) when a key
   exists.

Each item is a reviewable commit with tests, as before. Nothing here adds
a surface that is not conversation, document, or artifact.
