import type { AgentTask, MethodDefinition } from '@harness/contracts';

// What a live agent is told about its task. Kept plain so the same text
// can be shown to the user as "what the agent was asked".

function list(label: string, items: readonly string[]): string {
  if (items.length === 0) return '';
  return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}\n\n`;
}

export function buildTaskPrompt(task: AgentTask): string {
  return (
    `${task.title}\n\n${task.objective}\n\n` +
    list('Scope', task.scope) +
    list('Expected outputs', task.expectedOutputs) +
    list('Checks that must pass', task.requiredChecks) +
    'Work only inside the current folder. When you are done, reply with a short summary of what changed and how it was verified.'
  ).trim();
}

export function buildSystemPrompt(input: {
  readonly projectName: string;
  readonly agentName: string;
  readonly method?: MethodDefinition | undefined;
}): string {
  const method = input.method;
  return (
    `You are ${input.agentName}, one agent working on the project "${input.projectName}" inside a coding harness. ` +
    'Other agents may be working in parallel on other tasks; stay inside your task and its scope. ' +
    'Ask before destructive or wide-reaching actions. Prefer small, verifiable changes and run the relevant checks.\n\n' +
    (method
      ? `Method: ${method.title}. ${method.purpose}\n\n` +
        list('Hard rules', method.hardRules) +
        list('Preferences', method.preferences) +
        list('Guidance', method.promptGuidance) +
        list('Output expectations', method.outputExpectations) +
        list('Scope restrictions', method.scopeRestrictions)
      : '')
  ).trim();
}
