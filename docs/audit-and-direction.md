# Audit and direction

Where the harness stands after the point-and-prompt work, and what is
left to finish the thing we set out to build: a Claude Code–style
workspace where the work is **visible**, ideas are **organized**, changes
are **tracked**, and nothing is lost in a scrolling feed.

Written 2026-09-25.

## What exists, honestly

**The stream.** One append-only event log per project, replayed into a
projection; every command carries an expected sequence, retries are
idempotent, and a restart rebuilds from events alone. Entities: brief,
method (+ snapshots pinned per task), threads, agents, tasks, plan
document, task plans, proposals, asks, checks, outputs, activities.

**Conversation.** A pane per agent plus a coordinator, side by side.
Typing into an idle agent starts work; while it runs, messages are
forwarded into it. Tool rows (Read / Grep / Glob / Bash with its result /
Write with a diff / Plan / Method) render inline, asks are cards with a
trust choice, failures pin above the composer, and elapsed time and the
last tool show in the header.

**Runtimes.** Simulated, Claude via the Agent SDK, and any
OpenAI-compatible endpoint (Groq free tier, Ollama). Per-agent model
selection beside Send. Method tool policies narrow what an agent may use.
Rate limits are waited out; a restart stops in-flight tasks honestly.

**Documents.** Plan (overview, features, ui, visual, data, risks) and
Method are sectioned documents that you, the coordinator, and agents all
edit, with who-changed-what recorded and a per-document changes strip.
Tasks reference the sections they implement.

**Artifacts.** Files agents wrote, rendered (markdown, code, images,
sandboxed HTML), live-refreshing, editable by hand with a save that
refuses stale writes; any file in the folder can be opened by path.

**Pointing.** A message can point at a Plan/Method line, a file range, a
picked HTML element, or an earlier message. Chips sit above the composer,
are recorded on the message, and reach the agent as context. Element
chips are grounded: the service finds where that selector lives and hands
the agent file:line candidates.

163 tests, `npm run verify` green, everything above exercised live on a
free model.

## What is weak

1. **Everything is a list.** Conversations scroll. Documents are
   sections. Artifacts are chips. There is no view where a person sees
   the shape of the work: which idea became which task, which agent took
   it, which files came out, what is still unclaimed. The product is
   called a visualizer and has no map.
2. **Change is scattered.** A file diff lives in a tool row, a plan edit
   in the document's changes strip, a check in another row, task state in
   the header. There is no single "what changed, by whom, since when".
3. **Ideas can still fall out.** Add to Plan exists, but an idea
   mentioned mid-run that nobody files is gone once the feed scrolls.
   Nothing surfaces "you said this and never placed it".
4. **History is developer output.** `event.type` rows with sequence
   numbers. Correct, unreadable.
5. **The coordinator's task plans are still simulator-shaped.** The Plan
   _document_ now reads like the request; the task rows still say
   "Define the … experience".
6. **Claude runtime lags the open one**: no Plan/Method tools (needs
   MCP), no forwarded follow-ups, no write diffs.

## Direction: three surfaces, one stream

Nothing below needs new persistence. It is all derivable from the
projection and the event log.

### A. Map — see it branch out

A full-width view beside the conversation (a mode switch in the header,
not a fourth panel). Columns, left to right, with drawn connectors:

```
Ideas (Plan sections → lines) → Tasks → Agents → Files/Checks
```

- Every node is the real entity: a Plan line, a task, an agent, an
  output file, a check.
- Edges come from data already recorded: `task.sections` (which idea a
  task implements), `task.agentId`, outputs and checks by `taskId`, and
  message `context` (what you pointed at when you asked).
- State is colour: idle / working / needs you / done / failed, the same
  vocabulary as the panes.
- Clicking a node acts: open that conversation, open that document
  section, open that file, or attach it as context to what you are
  typing. Hovering highlights its whole branch.
- Unclaimed ideas (a Features line no task references) are visibly
  hanging — that is the point. So are orphan files (written but not tied
  to any idea).

This answers "see it all branch out, and interact with it" with the data
we already keep, and it makes the two gaps above visible rather than
hidden.

### B. Changes — one ledger

A reverse-chronological ledger across the whole project: plan and method
edits (with added/removed lines), file writes (with their diffs), checks
with outcomes, task state changes, asks decided, model and trust changes.
Filter by who (you / coordinator / agent), by what (ideas / files /
checks), and by time ("since I last looked"). Clicking an entry opens the
thing it changed. This replaces the raw History list, which becomes a
developer toggle inside it.

### C. Loose ends — nothing gets lost

A small, honest list derived from the stream, shown on the map and in the
sidebar when non-empty:

- Ideas with no task.
- Tasks that failed or were stopped and never restarted.
- Files written but never verified by a check.
- Asks you denied, with what was abandoned.
- Messages you sent that produced no work (chat to a busy agent, or a
  request the coordinator turned into a plan you never assigned).

Each with the one action that clears it: assign, restart, verify, dismiss.

## Order of work

1. **Map view** — columns, connectors, state colour, click-to-act,
   hanging ideas visible.
2. **Changes ledger** — one timeline, filters, click-through; History
   folded in as a raw toggle.
3. **Loose ends** — derived list plus its actions, surfaced on the map.
4. **Task plans that read like the request** — the coordinator names
   tasks from the Plan document's own lines instead of its templates.
5. **Claude runtime parity** — Plan/Method tools over MCP, forwarded
   follow-ups through streaming input, diffs on writes.

Each is a reviewable commit with tests, as before. After 1–3 the product
matches its name: the work is visible, organized, tracked, and
interactive — and the conversation is one view of it, not the only one.
