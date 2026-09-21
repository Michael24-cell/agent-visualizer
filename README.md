# Visual Multi-Agent Harness

Local-first control plane for planning, supervising, and verifying coding-agent work. This repository is currently at **Increment 2.5: Operational application shell**.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Develop

```bash
npm install
cp .env.example .env # optional
npm run dev
```

Open `http://127.0.0.1:5173`. The client proxies `/api` requests to the loopback-only service at `http://127.0.0.1:4317`. The root development command creates an unguessable per-launch session token and shares it with the service and development proxy without exposing it to client code. Browser origins are checked at the service boundary.

Local state is stored outside the repository in the operating system's user-data directory. Override it with an absolute `HARNESS_DATA_DIR` path when isolation is useful.

`npm run dev` sets `HARNESS_DEMO_PROJECT=1` so the service seeds one demo project ("Account preferences loop", two agents) the first time it starts against a data directory. The flag is off by default for `npm start`; without it the app opens on your own projects only.

## Verify

```bash
npm run verify
```

Run migrations directly with `npm run db:migrate`. Migrations are transactional and safe to run repeatedly.

The authenticated local service can execute deterministic development scenarios with `POST /api/simulated-runs` and retrieve the resulting authoritative projection with `GET /api/runs/:runId`. The visual product loop uses `POST /api/demo-runs`, typed advancement and approval commands, bounded cursor replay at `GET /api/runs/:runId/events`, and authoritative persisted-state refresh through `GET /api/workspace`. The replay endpoint returns events after a supplied cursor; it is useful recovery infrastructure, not an open live stream. The browser never owns execution status.

### Projects, conversations, and agents (Increment 2.6)

The product surface is a set of **conversations on one persisted project stream**: a coordinator thread and one thread per agent. `POST /api/projects` creates a project; `POST /api/projects/:id/threads/:ref/messages` posts to the coordinator or an agent (`intent: chat` never creates work, `start_work` does); `…/agents/:id/advance`, `…/agents/:id/stop`, `…/agents/:id/asks/:askId`, and `…/proposals/:id` drive work per agent; `…/method`, `…/method/overrides`, and `…/brief/fields/:fieldId` shape the project. Messages are read by cursor at `GET …/threads/:ref/messages` and events at `GET …/events`. Every mutating command carries a client `commandId` (retries are idempotent) and the `expectedSequence` of the thread, agent, proposal, brief, or method it targets. The coordinator and agents are deterministic simulators; see `docs/increment-2-6-handoff.md` for the event catalog, scripts, and keyword rules.

The Increment 2 demo run (`/api/workspace`, `/api/demo-runs`, the "Plan demo" menu in the client) is a **compatibility path** kept for its regression tests; new work does not use the run stream. Real repository scanning and a live provider remain the next seam; no live provider is connected.

### Live agents (Claude Agent SDK)

Agents run on Claude when `ANTHROPIC_API_KEY` is set in the shell that starts the service (`HARNESS_RUNTIME=simulated` forces the simulator; `HARNESS_RUNTIME=live` forces live). The key is read only for its presence; the SDK subprocess inherits it. In live mode a task starts a `query()` in the project's attached folder with the agent's chosen model (`…/agents/:id/model`), streams the SDK frames through `@harness/runtime-claude` into the same events the simulator emits (messages, checks from `Bash`, diff outputs from file edits, asks from permission prompts), pauses the run on an Ask until it is decided, and aborts it on Stop. Attaching a folder is required before live work starts; the coordinator stays simulated; plain chat on a live agent thread is not forwarded into a running task yet. Pay-per-token: the SDK bills the key directly.

### Local and hosted open models (OpenAI-compatible)

`HARNESS_RUNTIME=local` runs agent tasks on any OpenAI-compatible chat endpoint through `@harness/runtime-openai`, which owns a small tool loop (read, list, search, run command, edit, write; every path confined to the attached folder) and emits the same events as the other runtimes. Defaults target Ollama: `HARNESS_LOCAL_BASE_URL=http://127.0.0.1:11434/v1`, `HARNESS_LOCAL_MODEL=qwen2.5-coder:7b`; set `HARNESS_LOCAL_API_KEY` for hosted endpoints (Groq, Gemini, OpenRouter). All agents share the configured model; the pane header shows its name. Commands and file changes still ask first, and Stop aborts the run.

## Boundaries that must remain stable

- Tasks are durable; runtime processes are replaceable workers.
- Authoritative state comes from structured events and inspected system state, not agent prose.
- Writing work must not silently modify the user's original branch or working directory.
- Runtime/provider behavior stays behind adapters.
- Methodology and skill versions are pinned for active sessions.
- Permission or scope expansion, destructive actions, pushes, and deployments require visible gates.
- Completion requires evidence.
- Category color and execution status are separate visual dimensions.
- One agent is preferred unless parallel work is justified.

The workspaces form one deployable modular monolith. `apps/client` owns presentation, `apps/service` owns the local application boundary, `packages/domain` owns pure transitions and projections, and packages isolate contracts, configuration, persistence, and runtime adapters.
