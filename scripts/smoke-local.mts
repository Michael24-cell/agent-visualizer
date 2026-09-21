// Smoke-tests the OpenAI-compatible runtime against a throwaway folder.
// Usage (from the repo root): npx tsx scripts/smoke-local.mts
// Reads HARNESS_LOCAL_BASE_URL / HARNESS_LOCAL_MODEL / HARNESS_LOCAL_TOOLS
// like the app does. Nothing outside the temp folder is touched.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt, buildTaskPrompt } from '@harness/runtime-claude';
import {
  LOCAL_AGENT_TOOLS,
  LOCAL_AGENT_TOOLS_FULL,
  runOpenAiTask,
} from '@harness/runtime-openai';
import { loadEnvLocal } from './env-local.mjs';

loadEnvLocal();

const cwd = mkdtempSync(join(tmpdir(), 'harness-smoke-'));
mkdirSync(join(cwd, 'src'));
writeFileSync(
  join(cwd, 'src', 'math.js'),
  'export function add(a, b) {\n  return a + b;\n}\n',
);
writeFileSync(
  join(cwd, 'test.js'),
  'import { add } from "./src/math.js";\nif (add(2, 3) !== 5) throw new Error("add broken");\nconsole.log("ok");\n',
);
writeFileSync(
  join(cwd, 'package.json'),
  '{"name":"smoke","type":"module","scripts":{"test":"node test.js"}}\n',
);

const model = process.env.HARNESS_LOCAL_MODEL ?? 'qwen2.5-coder:7b';
const baseUrl =
  process.env.HARNESS_LOCAL_BASE_URL ?? 'http://127.0.0.1:11434/v1';
console.log(`model ${model} at ${baseUrl}\nfolder ${cwd}\n`);

const task = {
  id: 'task_smoke',
  projectId: 'project_smoke',
  agentId: 'agent_smoke',
  title: 'Add a subtract function',
  objective:
    'Add a subtract(a, b) function to src/math.js next to add and export it. Add a check for it in test.js. Run npm test and make sure it passes.',
  category: 'interface',
  skills: [],
  scope: [],
  scopeHistory: [],
  dependsOn: [],
  inputsSatisfied: [],
  expectedOutputs: ['subtract in src/math.js', 'a passing test'],
  requiredChecks: [],
  state: 'working',
  createdAtSequence: 1,
} as never;

const started = Date.now();
const stamp = () => `[${((Date.now() - started) / 1000).toFixed(1)}s]`;
const run = runOpenAiTask(
  {
    cwd,
    model: 'sonnet',
    systemPrompt: buildSystemPrompt({
      projectName: 'Smoke',
      agentName: 'Interface systems',
    }),
    prompt: buildTaskPrompt(task),
  },
  {
    emit(intents) {
      for (const intent of intents)
        console.log(stamp(), JSON.stringify(intent).slice(0, 240));
      return true;
    },
    async ask(ask) {
      console.log(
        stamp(),
        'ASK',
        ask.action,
        '→',
        ask.scope,
        '(auto-approved for the smoke test)',
      );
      return 'approved';
    },
  },
  {
    baseUrl,
    apiKey: process.env.HARNESS_LOCAL_API_KEY,
    model,
    maxTurns: 20,
    tools:
      process.env.HARNESS_LOCAL_TOOLS === 'full'
        ? LOCAL_AGENT_TOOLS_FULL
        : LOCAL_AGENT_TOOLS,
  },
);
await run.done;
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(
  '--- src/math.js\n' + readFileSync(join(cwd, 'src', 'math.js'), 'utf8'),
);
console.log('--- test.js\n' + readFileSync(join(cwd, 'test.js'), 'utf8'));
