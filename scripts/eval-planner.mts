// Scores the Planner on evals/planner/cases.json.
//
//   npm run eval:planner            built-in planner only (free, offline)
//   npm run eval:planner -- --model also the connected account's model
//
// --model makes one model call per case (12 today) on the account the app
// is set to use: your ChatGPT plan's allowance, or your API key's bill.
// Results print as a table; --json writes them to a file as well.
import { writeFileSync } from 'node:fs';
import { loadAppConfig } from '@harness/config';
import { ChatGptAuth } from '../apps/service/src/chatgpt-auth.js';
import { plannerFor } from '../apps/service/src/planners.js';
import {
  average,
  loadCases,
  runCase,
  type CaseResult,
} from '../apps/service/src/planner-eval.js';
import { loadEnvLocal } from './env-local.mjs';

loadEnvLocal();
const args = process.argv.slice(2);
const withModel = args.includes('--model');
const jsonAt = args[args.indexOf('--json') + 1];
const cases = loadCases('evals/planner/cases.json');

const builtIn: CaseResult[] = [];
for (const item of cases) builtIn.push(await runCase(item));

let model: CaseResult[] | undefined;
let label = '';
if (withModel) {
  const config = loadAppConfig();
  const chatgpt = new ChatGptAuth({ dataDirectory: config.dataDirectory });
  const planner = plannerFor(config.runtime, chatgpt);
  if (!planner) {
    console.error(
      'No model is connected (the app is on practice agents). Choose an account in the app first.',
    );
    process.exit(1);
  }
  label = planner.label;
  console.log(`Asking ${label} for ${cases.length} plans…\n`);
  model = [];
  for (const item of cases) {
    const result = await runCase(item, planner);
    model.push(result);
    process.stdout.write(result.source === 'model' ? '.' : 'x');
  }
  process.stdout.write('\n\n');
  chatgpt.close();
}

const pct = (value: number) => `${Math.round(value * 100)}%`.padStart(5);
const width = Math.max(...cases.map((item) => item.id.length));
console.log(`${'case'.padEnd(width)}  built-in${model ? `  ${label}` : ''}`);
cases.forEach((item, index) => {
  const a = builtIn[index]!;
  const b = model?.[index];
  console.log(
    `${item.id.padEnd(width)}  ${pct(a.score).padEnd(8)}${b ? `  ${pct(b.score)}${b.fallback ? '  (fell back)' : ''}` : ''}`,
  );
});
console.log(
  `${'average'.padEnd(width)}  ${pct(average(builtIn)).padEnd(8)}${model ? `  ${pct(average(model))}` : ''}`,
);

if (model) {
  const tokens = model.reduce(
    (sum, result) => ({
      input: sum.input + (result.usage?.inputTokens ?? 0),
      output: sum.output + (result.usage?.outputTokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
  const fell = model.filter((result) => result.fallback);
  console.log(
    `\n${label}: ${tokens.input.toLocaleString()} tokens in, ${tokens.output.toLocaleString()} out` +
      (fell.length ? `; ${fell.length} fell back:` : '.'),
  );
  for (const result of fell) console.log(`  ${result.id}: ${result.fallback}`);
  console.log('\nWhat each missed:');
  for (const result of model) {
    const missed = result.checks.filter((check) => !check.pass);
    if (missed.length) {
      console.log(
        `  ${result.id}: ${missed.map((check) => check.detail).join('; ')}`,
      );
    }
  }
}

if (args.includes('--json') && jsonAt) {
  writeFileSync(
    jsonAt,
    `${JSON.stringify({ ranAt: new Date().toISOString(), label, builtIn, model }, null, 2)}\n`,
  );
  console.log(`\nWrote ${jsonAt}`);
}
