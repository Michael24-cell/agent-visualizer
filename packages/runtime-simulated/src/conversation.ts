import type {
  AdapterProvenanceSchema,
  Agent,
  AgentTask,
  Brief,
} from '@harness/contracts';
import type { z } from 'zod';

// Deterministic, scripted replies for the coordinator and agent threads.
// These are pure: they return intents, and the service turns intents into
// events with ids, sequences, and timestamps inside its transaction.
//
// Increment 2.6 Slice 2 covers direct agent conversation. Planning,
// dispersal, intake questions, checks, and asks arrive in later slices and
// extend these unions rather than replacing them.

export const SIMULATED_CONVERSATION_ADAPTER: z.infer<
  typeof AdapterProvenanceSchema
> = {
  id: 'simulated-conversation',
  version: '0.1.0',
  mode: 'simulated',
};

export type AgentIntent =
  | { readonly kind: 'reply'; readonly body: string }
  | {
      readonly kind: 'assign_task';
      readonly title: string;
      readonly objective: string;
    };

export type CoordinatorIntent = {
  readonly kind: 'reply';
  readonly body: string;
};

export interface AgentConversationInput {
  readonly agent: Agent;
  readonly currentTask: AgentTask | undefined;
  readonly intent: 'chat' | 'start_work';
  readonly body: string;
}

const TASK_TITLE_MAX = 80;

// First line of the request, trimmed to a title.
export function titleFromRequest(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const flat = firstLine.replace(/\s+/g, ' ');
  if (flat.length <= TASK_TITLE_MAX) return flat;
  return `${flat.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…`;
}

// Keyword rules, documented so behavior is predictable:
//   status question → summarize state ("what changed", "status", "where are you", "done?")
//   anything else while working → acknowledged as steering for the current task
//   anything else while idle/terminal → offer to start work
const STATUS_QUESTION =
  /\b(what(?:'s| is| has)? (?:changed|done|left|the status)|status|where are you|progress|are you done|finished\?)/i;

function describeWork(agent: Agent, task: AgentTask | undefined): string {
  if (!task) return `${agent.name} has nothing in progress.`;
  switch (task.state) {
    case 'waiting':
      return `"${task.title}" is waiting on an upstream output before it can start.`;
    case 'working':
      return `"${task.title}" is in progress.`;
    case 'needs_you':
      return `"${task.title}" is paused on a decision from you.`;
    case 'done':
      return `"${task.title}" is done.`;
    case 'stopped':
      return `"${task.title}" was stopped. Its outputs are kept.`;
    case 'failed':
      return `"${task.title}" failed.`;
  }
}

export function planAgentIntents(
  input: AgentConversationInput,
): readonly AgentIntent[] {
  const { agent, currentTask, intent, body } = input;
  const active =
    currentTask &&
    ['waiting', 'working', 'needs_you'].includes(currentTask.state);

  if (intent === 'start_work') {
    if (active && currentTask) {
      return [
        {
          kind: 'reply',
          body: `I'm still on "${currentTask.title}". Stop it first, or send this as a note and I'll fold it in.`,
        },
      ];
    }
    const title = titleFromRequest(body);
    return [
      { kind: 'assign_task', title, objective: body },
      {
        kind: 'reply',
        body: `Starting: ${title}. I'll post progress here and ask before anything that needs a decision.`,
      },
    ];
  }

  if (STATUS_QUESTION.test(body)) {
    return [{ kind: 'reply', body: describeWork(agent, currentTask) }];
  }
  if (active && currentTask) {
    return [
      {
        kind: 'reply',
        body: `Noted for "${currentTask.title}". I'll take that into account.`,
      },
    ];
  }
  return [
    {
      kind: 'reply',
      body: `Noted. Nothing is in progress for ${agent.name} — use "Start work" (or /start) when you want me to take this on.`,
    },
  ];
}

export function coordinatorGreeting(projectName: string): string {
  return `What are we building in ${projectName}? Tell me in a sentence or two. You can also type straight into an agent pane to start work without a plan.`;
}

export interface CoordinatorConversationInput {
  readonly projectName: string;
  readonly brief: Brief;
  readonly body: string;
  readonly agentNames: readonly string[];
}

// Slice 2: the coordinator acknowledges and points at the agents. Intake
// and planning replace this in later slices.
export function planCoordinatorIntents(
  input: CoordinatorConversationInput,
): readonly CoordinatorIntent[] {
  const agents = input.agentNames.length
    ? `Agents available now: ${input.agentNames.join(', ')}.`
    : 'No agents yet — add one to start work directly.';
  return [
    {
      kind: 'reply',
      body: `Noted. I don't plan or disperse work yet in this build, so ${agents} Type into an agent pane to give it work.`,
    },
  ];
}
