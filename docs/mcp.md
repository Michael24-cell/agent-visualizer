# Use Harness from Claude Code, Codex or Cursor (MCP)

Harness includes a small MCP server. Once it is added to your agent tool,
that tool can ask the Harness Planner for a plan, take tasks from it one at
a time, and report each one back. You watch, steer and review in Harness;
the work happens in the tool you already use.

Everything stays on this computer. The tool starts the server itself and
talks to it through a pipe; the server passes calls to the Harness app over
`127.0.0.1`. There is nothing to host and no new database.

## Set it up

1. Start Harness (`npm start`) and make a project with your code's folder,
   or let `draft_plan` make one for the folder the tool works in.
2. Add the server to your tool, once. Use the full path to this repository.

Claude Code:

```bash
claude mcp add harness -- node /path/to/agent-visualizer/apps/mcp/bin/harness-mcp.mjs
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.harness]
command = "node"
args = ["/path/to/agent-visualizer/apps/mcp/bin/harness-mcp.mjs"]
```

Cursor (`.cursor/mcp.json` in your project, or the global one):

```json
{
  "mcpServers": {
    "harness": {
      "command": "node",
      "args": ["/path/to/agent-visualizer/apps/mcp/bin/harness-mcp.mjs"]
    }
  }
}
```

If you set `HARNESS_DATA_DIR` for Harness, set the same variable for the
server (`claude mcp add -e HARNESS_DATA_DIR=… harness -- …`).

3. In the tool, say something like: _"Ask Harness for a plan to add invoice
   downloads, then do the tasks."_

## The tools

| Tool           | What it does                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_overview` | Reads the project's Overview and Plan document. Read-only.                                                                                        |
| `get_plan`     | Reads the current plan and how far each task has got. Read-only.                                                                                  |
| `draft_plan`   | Sends a request to the Planner and returns the plan it drafts, or its change to the open plan.                                                    |
| `next_task`    | Gives the tool the next ready task. If the plan has not been started, this approves it and hands it to the tool.                                  |
| `report_task`  | Reports a task done or failed, with the checks run and the files changed. Harness compares the files with what git shows and puts them in Review. |

## What to know

- **The tool decides when to call these.** Harness cannot make it report,
  and cannot stop it from running something. Its own permission prompts
  are still what guards your files.
- **Git is the check.** Each report is compared with the files git shows
  changed since the task was taken. Files the tool did not mention, and files
  it mentioned but did not change, are said in the task's pane.
- **Done needs passing checks.** A task reported done without a passing
  check for each required one is recorded as failed, the same rule
  Harness's own agents follow.
- **Stop works from Harness.** Stopping the task in Harness makes the next
  report fail with "was stopped in Harness", so the tool knows to stop.
- **Finding the app.** Harness writes its address and session token to
  `connection.json` in its data folder (readable only by you) when it
  starts, and removes it when it stops. If Harness is not running, the
  tools say so.
