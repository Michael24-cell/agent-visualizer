# Product audit: from working MVP to something people can use

Two audits and the plan that follows from them. Written 2026-11-12 from a
first-run walk of the production build on an empty data folder, plus the
code. Items marked **fixed** were fixed in the same change as this
document.

## Part 1 — Does it flow as a consumer product?

Judged as a stranger would meet it: no knowledge of the repo, the
vocabulary, or what happened in earlier sessions.

### The first five minutes, as observed

| Step                      | What happens                                                                                                                                            | Verdict                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Get it running            | Clone, `npm install`, `npm run dev`, open a port. `npm start` ran the API with no interface.                                                            | **Fixed:** `npm start` builds once, serves the app, opens the browser. Still needs Node and a terminal. |
| First screen              | Empty sidebar, "Where is the code?", a text box, a line about "your OpenAI-compatible endpoint".                                                        | Nothing says what this is or what happens next.                                                         |
| Type a request, no folder | The hint promised the coordinator. The app opened an empty agent pane reading "Nothing yet." The message and the plan were in a pane that was not open. | **Fixed:** a project opens on the conversation your words went to.                                      |
| Press "Assign to agents"  | Nothing visible happened. A grey line at the bottom said a folder was needed.                                                                           | **Fixed:** the card says so before the click, and the button opens the folder picker.                   |
| Choose a folder           | Lists your home folder. No way to make a new one, though the card says an empty folder is fine.                                                         | Open.                                                                                                   |
| Service restarts          | Full-screen "not answering" with a button.                                                                                                              | **Fixed:** retries by itself every few seconds and says how to restart.                                 |

### What still makes it feel like a developer tool

1. **Vocabulary.** Coordinator, Method, Brief, Plan, Artifacts, runtime,
   endpoint, "Asks: Ask every time". Seven nouns before any work is done.
   Each is defensible; together they are a manual. A consumer product
   names things by what you do: _Chat_, _Plan_, _Files_, _Rules_.
2. **Setup is a form about infrastructure.** Base URL, API key, model id,
   "allow search-and-replace edits". The right first question is "which
   account do you have?" — ChatGPT, Claude key, or neither (free) — and
   everything else follows from the answer.
3. **Nothing explains itself on first use.** Review has a guide; the rest
   of the app does not. An empty project should show what the three
   modes are for, once.
4. **Projects cannot be renamed, archived, or deleted.** The list fills
   with "Hi", "hi", "Hi" and stays that way.
5. **No way back.** An agent's change can be reviewed and questioned but
   not undone. For a consumer this is the difference between trying it
   and trusting it.
6. **You have to watch it.** No sound, no tab title change, no
   notification when an agent needs approval or finishes. `Refresh` is
   still a button.
7. **Money is recorded but invisible while it is being spent.** Tokens
   and list price exist per task (Review → Sessions); nothing shows a
   running total, a budget, or "this will use your plan".
8. **Six documents in a sidebar.** The right panel is still a drawer you
   open, not a panel that follows the work (see `surface-audit.md`).
9. **Dense, small, dark-only.** 11–13px text throughout, no light theme,
   and narrow widths were not re-checked in this pass.

### The consumer flow to aim for

1. Open the app. One sentence says what it does; one question: _What do
   you want to build or change?_ and _Where?_ (a folder, a new folder, or
   "just plan it").
2. If no model is connected: _Use your ChatGPT plan · Use a Claude key ·
   Try it free_ — one click each, no form.
3. Your words go to one place and the answer appears there.
4. A plan card you can read in ten seconds, with what it will cost in
   words ("about 2 tasks · uses your ChatGPT plan").
5. Work runs; you are told when it needs you and when it is done.
6. Review what changed, ask about any line, undo anything.

Steps 3 and 4's dead ends are fixed. Steps 1, 2, 5 and 6 are the work.

## Part 2 — From MVP to a full project

### What is solid

- An event-sourced core: every change is an event, replay rebuilds
  everything, commands are idempotent, restarts recover honestly.
- Three real runtimes (Claude, any OpenAI-compatible endpoint, ChatGPT
  plan) plus a simulator, behind one interface.
- Permission gating, folder confinement, loopback-only service, origin
  and now host checks, tokens kept out of the browser.
- 39 test files, typed contracts end to end, lint and format enforced, CI
  workflow present.
- Review, Map, Changes, Loose ends: the product's own idea, working.

### What is missing, by how much it blocks real use

**Blocks anyone but you from using it**

1. **Distribution.** There is no installer. Today: Node 22, git, a
   terminal. Next: a published `npx` package; then a desktop wrapper
   (Tauri or Electron) so it is a double-click.
2. **The coordinator is a keyword simulator.** Plans, intake and document
   edits are pattern matches. On a live runtime the coordinator should be
   the model, with the simulator as the offline fallback. This is the
   largest gap between what the product claims and what it does.
3. **ChatGPT plan with tools is unproven.** Built to spec and tested
   against a fake server; never run against OpenAI. One real sign-in
   settles it.
4. **Claude runtime parity.** No Plan/Method tools, no forwarded
   follow-ups, no write diffs, effort never set. Outstanding since
   `audit-and-direction.md`.

**Blocks trusting it with real work**

5. **Undo.** Snapshot a file before each agent write (or use git when
   the folder is a repository) so any step in Review can be reverted.
6. **Agents share one working folder.** Two agents can overwrite each
   other; Review flags it after the fact. Git worktrees per agent, merged
   on approval, is the real fix.
7. **No budget or stop conditions.** A run can spend until `maxTurns`.
   A per-task and per-project ceiling, in dollars or plan percentage.
8. **Model choice is by lane, not by task.** The triage design from the
   last discussion — a cheap call that predicts tools and difficulty,
   recorded against what happened — is specified and not built.

**Hygiene a real project needs**

9. **Stale documentation.** The README still says "Increment 2.5" and
   "no live provider is connected". It should describe the product.
10. **Dead code.** Roughly half the stylesheet's 583 classes are never
    named in the client (some are composed at runtime, so the true figure
    is lower), plus the demo-run compatibility path, its routes and
    tests. One collision with a leftover class already cost time.
11. **No end-to-end test.** Every test is unit or service-level. One
    browser test of the first-run flow would have caught both dead ends
    fixed here.
12. **No licence, no changelog, no versioning.** `0.0.0`, private.
13. **Secrets in a dotfile.** API keys live in `.env.local`; the ChatGPT
    tokens in an owner-only file. The OS keychain is the right home.
14. **Loose files.** `conversation-first-direction-decision.md` is still
    untracked at the repository root.

### What to cut, not build

- The demo-run path and the fixture shell it served.
- The Brief as a separate document: fold its six fields into Plan →
  Overview. One fewer noun.
- "Method catalog" as a concept: keep three presets under _Rules_.

## The order from here

Each is one reviewable change with tests.

1. ~~One-command start, first-run dead ends, self-healing error screen~~
   — done with this document.
2. **First-run in plain words**: the account question instead of the
   runtime form; rename the surfaces; "New folder" in the picker; rename,
   archive and delete for projects.
3. **Tell me when it needs me**: tab title and optional notification on
   ask / done / failed; drop the Refresh button.
4. **Undo from Review**: snapshot before write, revert a step.
5. **The model as coordinator** on live runtimes, simulator as fallback.
6. **Triage and model fit**, with the toggle, recorded against outcomes.
7. **Running cost and a ceiling.**
8. **Claude parity**, then **worktrees per agent**.
9. **Clean-out**: dead CSS and the demo path, README rewritten, one
   end-to-end test in CI.
10. **Package it**: `npx`, then a desktop app.

Items 2–4 make it a product a stranger can use. Items 5–8 make it good.
Items 9–10 make it shippable.
