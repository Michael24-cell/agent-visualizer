import { PLAN_SECTIONS, type ProjectEvent } from '@harness/contracts';

// One ledger for the whole project: what changed, who changed it, and
// what it changed from. Derived by walking the event log, so it agrees
// with history by construction.

export type ChangeKind =
  'idea' | 'file' | 'check' | 'task' | 'decision' | 'setting';
export type ChangeWho = 'you' | 'coordinator' | 'agent' | 'harness';

export interface ChangeEntry {
  readonly id: string;
  readonly sequence: number;
  readonly at: string;
  readonly kind: ChangeKind;
  readonly who: ChangeWho;
  readonly title: string;
  readonly detail?: string;
  readonly added?: readonly string[];
  readonly removed?: readonly string[];
  // What to open when the entry is clicked.
  readonly target?:
    | { readonly kind: 'plan' }
    | { readonly kind: 'method' }
    | { readonly kind: 'file'; readonly path: string }
    | { readonly kind: 'agent'; readonly agentId: string };
}

const METHOD_TITLES: Record<string, string> = {
  hardRules: 'Hard rules',
  preferences: 'Preferences',
  promptGuidance: 'Guidance',
  skills: 'Skills',
  outputExpectations: 'Output expectations',
  checks: 'Checks',
  scopeRestrictions: 'Scope restrictions',
};

function who(event: ProjectEvent): ChangeWho {
  switch (event.source) {
    case 'user':
      return 'you';
    case 'coordinator':
      return 'coordinator';
    case 'agent':
      return 'agent';
    default:
      return 'harness';
  }
}

function diff(before: readonly string[], after: readonly string[]) {
  return {
    added: after.filter((line) => !before.includes(line)),
    removed: before.filter((line) => !after.includes(line)),
  };
}

export function buildChanges(events: readonly ProjectEvent[]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  // Section contents as the walk sees them, so an edit can be described
  // by what it added and removed rather than by its whole new value.
  const sections = new Map<string, readonly string[]>();
  const taskTitles = new Map<string, string>();
  const agentNames = new Map<string, string>();

  for (const event of events) {
    const base = {
      id: event.id,
      sequence: event.sequence,
      at: event.occurredAt,
      who: who(event),
    };
    switch (event.type) {
      case 'plan.section_edited': {
        const key = `plan:${event.payload.sectionId}`;
        const before = sections.get(key) ?? [];
        sections.set(key, event.payload.lines);
        entries.push({
          ...base,
          kind: 'idea',
          title: `Plan · ${PLAN_SECTIONS[event.payload.sectionId].title}`,
          ...diff(before, event.payload.lines),
          target: { kind: 'plan' },
        });
        break;
      }
      case 'method.override_recorded': {
        const key = `method:${event.payload.sectionId}`;
        const before = sections.get(key) ?? [];
        sections.set(key, event.payload.value);
        entries.push({
          ...base,
          kind: 'idea',
          title: `Playbook · ${METHOD_TITLES[event.payload.sectionId] ?? event.payload.sectionId}`,
          ...diff(before, event.payload.value),
          target: { kind: 'method' },
        });
        break;
      }
      case 'method.applied':
        for (const [id, value] of Object.entries(event.payload.definition)) {
          if (Array.isArray(value)) {
            sections.set(`method:${id}`, value as string[]);
          }
        }
        entries.push({
          ...base,
          kind: 'setting',
          title: `Playbook: ${event.payload.definition.title}`,
          detail: event.payload.definition.purpose,
          target: { kind: 'method' },
        });
        break;
      case 'method.overrides_cleared':
        entries.push({
          ...base,
          kind: 'setting',
          title: 'Playbook reset to its catalog entry',
          target: { kind: 'method' },
        });
        break;
      case 'output.produced': {
        const output = event.payload.output;
        const path = output.location ?? output.title;
        entries.push({
          ...base,
          kind: 'file',
          title: path,
          ...(output.diff || !/^sha256:/.test(output.digest)
            ? { detail: output.diff ?? output.digest }
            : {}),
          target: { kind: 'file', path },
        });
        break;
      }
      case 'check.started':
        taskTitles.set(
          event.payload.check.id,
          event.payload.check.command ?? event.payload.check.name,
        );
        break;
      case 'check.finished': {
        const command = taskTitles.get(event.payload.checkId) ?? 'check';
        entries.push({
          ...base,
          kind: 'check',
          title: `${event.payload.to === 'passed' ? 'Passed' : 'Failed'}: ${command}`,
          detail: event.payload.summary,
        });
        break;
      }
      case 'task.assigned': {
        const task = event.payload.task;
        taskTitles.set(task.id, task.title);
        entries.push({
          ...base,
          kind: 'task',
          title: task.outside
            ? `Handed “${task.title}” to ${task.outside.client}`
            : `Started “${task.title}”`,
          ...(agentNames.get(task.agentId)
            ? { detail: agentNames.get(task.agentId)! }
            : {}),
          target: { kind: 'agent', agentId: task.agentId },
        });
        break;
      }
      case 'task.taken':
        entries.push({
          ...base,
          kind: 'task',
          title: `${event.payload.client} took “${taskTitles.get(event.payload.taskId) ?? 'a task'}”`,
        });
        break;
      case 'task.state_changed': {
        const title = taskTitles.get(event.payload.taskId) ?? 'a task';
        if (event.payload.to === 'working') break;
        entries.push({
          ...base,
          kind: 'task',
          title: `${event.payload.to === 'done' ? 'Finished' : event.payload.to === 'failed' ? 'Failed' : 'Stopped'} “${title}”`,
          detail: event.payload.reason,
        });
        break;
      }
      case 'ask.decided':
        entries.push({
          ...base,
          kind: 'decision',
          title: `Ask ${event.payload.to}`,
          ...(event.payload.note ? { detail: event.payload.note } : {}),
        });
        break;
      case 'proposal.decided':
        entries.push({
          ...base,
          kind: 'decision',
          title: `Proposal ${event.payload.to}`,
          ...(event.payload.note ? { detail: event.payload.note } : {}),
        });
        break;
      case 'agent.created':
        agentNames.set(event.payload.agent.id, event.payload.agent.name);
        break;
      case 'agent.renamed':
        entries.push({
          ...base,
          kind: 'setting',
          title: `Renamed ${agentNames.get(event.payload.agentId) ?? 'an agent'} to ${event.payload.name}`,
          target: { kind: 'agent', agentId: event.payload.agentId },
        });
        agentNames.set(event.payload.agentId, event.payload.name);
        break;
      case 'agent.model_changed':
        entries.push({
          ...base,
          kind: 'setting',
          title: `${agentNames.get(event.payload.agentId) ?? 'An agent'} runs on ${event.payload.endpointModel ?? event.payload.model}`,
          target: { kind: 'agent', agentId: event.payload.agentId },
        });
        break;
      case 'project.trust_changed':
        entries.push({
          ...base,
          kind: 'setting',
          title: `Asks: ${event.payload.trust}`,
        });
        break;
      case 'project.repository_attached':
        entries.push({
          ...base,
          kind: 'setting',
          title: `Folder: ${event.payload.repository.name}`,
          detail: event.payload.repository.path,
        });
        break;
      default:
        break;
    }
  }
  return entries.reverse();
}
