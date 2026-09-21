import {
  BRIEF_REQUIRED_FIELDS,
  type ProjectEvent,
  type ProjectResponse,
} from '@harness/contracts';

// Short, honest one-liners about a project for sidebars and lists, plus the
// project name derived from a first request. No components here so hot
// reload stays clean.

export const statusLabels: Record<
  ProjectResponse['summary']['status'],
  string
> = {
  intake: 'Getting started',
  planning: 'Plan ready',
  idle: 'Idle',
  working: 'Working',
  needs_you: 'Needs you',
  reviewing: 'Needs a fix',
  complete: 'Complete',
  partially_stopped: 'Partly stopped',
};

export const statusNotes: Record<string, string> = {
  intake: 'getting started',
  planning: 'plan ready',
  idle: 'idle',
  working: 'working',
  needs_you: 'needs you',
  reviewing: 'needs a fix',
  complete: 'complete',
  partially_stopped: 'partly stopped',
};

// A project name from the first line of the request: short, no trailing
// punctuation, capitalised.
export function nameFromRequest(body: string): string {
  const line = (body.split(/\r?\n/, 1)[0] ?? '').replace(/\s+/g, ' ').trim();
  const cleaned = line
    .replace(/^(just do it[:,]?\s*|please\s+)/i, '')
    .replace(
      /^(build|create|make|add|implement|ship|write|design|set up|setup)\s+(the|a|an|me|us)?\s*/i,
      '',
    )
    .replace(/[.!?]+$/, '')
    .trim();
  const short =
    cleaned.length > 60 ? `${cleaned.slice(0, 59).trimEnd()}…` : cleaned;
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : 'New project';
}

export function briefNote(project: ProjectResponse): string {
  if (project.summary.briefReady) return 'ready';
  const settled = BRIEF_REQUIRED_FIELDS.filter((id) =>
    ['confirmed', 'skipped', 'corrected'].includes(
      project.projection.brief.fields[id].state,
    ),
  ).length;
  return `${settled} of ${BRIEF_REQUIRED_FIELDS.length} decided`;
}

// What the header badge and hints call the runtime.
export function runtimeLabel(runtime: ProjectResponse['runtime']): string {
  if (runtime.mode !== 'live') return 'Simulated';
  if (runtime.provider === 'openai') return runtime.model ?? 'Local model';
  return 'Claude';
}

export function runtimeNote(runtime: ProjectResponse['runtime']): string {
  if (runtime.mode !== 'live') {
    return 'Agents are simulated. Set ANTHROPIC_API_KEY for Claude, or HARNESS_RUNTIME=local for a local model.';
  }
  if (runtime.provider === 'openai') {
    return `Agents run on ${runtime.model ?? 'a local model'} through your OpenAI-compatible endpoint.`;
  }
  return 'Agents run on Claude with your API key.';
}

export function methodNote(project: ProjectResponse): string {
  const method = project.projection.method;
  return method
    ? `${method.definition.title} · v${method.version}`
    : 'default · customize';
}

export function planNote(project: ProjectResponse): string {
  const sections = Object.values(
    project.projection.planDocument.sections,
  ).filter((section) => section.lines.length > 0).length;
  const plans = Object.values(project.projection.plans);
  const current = plans
    .filter((plan) => !plan.supersededByPlanId)
    .sort((a, b) => b.version - a.version)[0];
  const doc = sections
    ? `${sections} ${sections === 1 ? 'section' : 'sections'}`
    : 'empty';
  if (!current) return `${doc} · no tasks yet`;
  return `${doc} · tasks v${current.version} ${
    current.assignedAtSequence ? 'assigned' : 'proposed'
  }`;
}

// The edit history of the Plan and Method documents, newest first, with
// what each edit added and removed compared to the previous state.
export interface DocumentChange {
  readonly sequence: number;
  readonly document: 'plan' | 'method';
  readonly section: string;
  readonly source: 'user' | 'coordinator';
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export function documentChanges(
  events: readonly ProjectEvent[],
  titles: {
    readonly plan: Readonly<Record<string, string>>;
    readonly method: Readonly<Record<string, string>>;
  },
): DocumentChange[] {
  const state = new Map<string, readonly string[]>();
  const changes: DocumentChange[] = [];
  for (const event of events) {
    let key: string;
    let document: 'plan' | 'method';
    let lines: readonly string[];
    let section: string;
    let source: 'user' | 'coordinator';
    if (event.type === 'plan.section_edited') {
      document = 'plan';
      key = `plan:${event.payload.sectionId}`;
      lines = event.payload.lines;
      section = titles.plan[event.payload.sectionId] ?? event.payload.sectionId;
      source = event.payload.source;
    } else if (event.type === 'method.override_recorded') {
      document = 'method';
      key = `method:${event.payload.sectionId}`;
      lines = event.payload.value;
      section =
        titles.method[event.payload.sectionId] ?? event.payload.sectionId;
      source = event.payload.source ?? 'user';
    } else if (event.type === 'method.applied') {
      // Applying a Method resets every section to the catalog text.
      for (const sectionId of Object.keys(titles.method)) {
        const value =
          event.payload.definition[
            sectionId as keyof typeof event.payload.definition
          ];
        if (Array.isArray(value)) state.set(`method:${sectionId}`, value);
      }
      continue;
    } else {
      continue;
    }
    const previous = state.get(key) ?? [];
    state.set(key, lines);
    changes.push({
      sequence: event.sequence,
      document,
      section,
      source,
      added: lines.filter((line) => !previous.includes(line)),
      removed: previous.filter((line) => !lines.includes(line)),
    });
  }
  return changes.reverse();
}

export function agentsNote(project: ProjectResponse): string {
  const counts = project.summary.agentCounts;
  const total = Object.values(project.projection.agents).length;
  const active = counts.working + counts.waiting + counts.needs_you;
  return total ? `${total} · ${active} active` : 'none yet';
}
