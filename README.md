# Visual Multi-Agent Harness

Local-first control plane for planning, supervising, and verifying coding-agent work. This repository is currently at **Increment 0: Repository foundation**.

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

## Verify

```bash
npm run verify
```

Run migrations directly with `npm run db:migrate`. Migrations are transactional and safe to run repeatedly.

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

The workspaces form one deployable modular monolith. `apps/client` owns presentation, `apps/service` owns the local application boundary, and packages isolate contracts, configuration, and persistence dependencies.
