import {
  BRIEF_REQUIRED_FIELDS,
  type DocumentEditSource,
  type ProjectEvent,
  type ProjectResponse,
  type RuntimeSettings,
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

// What the app shows as running agents, from the saved settings.
export function runtimeFromSettings(
  settings: RuntimeSettings,
): ProjectResponse['runtime'] {
  switch (settings.kind) {
    case 'simulated':
      return { mode: 'simulated' };
    case 'claude':
      return { mode: 'live', provider: 'claude' };
    case 'chatgpt':
      return {
        mode: 'live',
        provider: 'chatgpt',
        model: settings.chatgpt.model,
      };
    default:
      return {
        mode: 'live',
        provider: 'openai',
        ...(settings.model ? { model: settings.model } : {}),
      };
  }
}

// What the header badge and hints call the runtime.
export function runtimeLabel(runtime: ProjectResponse['runtime']): string {
  if (runtime.mode !== 'live') return 'Practice agents';
  if (runtime.provider === 'chatgpt')
    return `ChatGPT plan · ${runtime.model ?? 'default model'}`;
  if (runtime.provider === 'openai') return runtime.model ?? 'Local model';
  return 'Claude';
}

export function runtimeNote(runtime: ProjectResponse['runtime']): string {
  if (runtime.mode !== 'live') {
    return 'Practice agents follow a script and use no model. Connect an account on the start screen.';
  }
  if (runtime.provider === 'chatgpt') {
    return `Agents run on ${runtime.model ?? 'your ChatGPT model'} through your ChatGPT plan — no API key; it counts against your plan's usage.`;
  }
  if (runtime.provider === 'openai') {
    return `Agents run on ${runtime.model ?? 'your model'}.`;
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
  readonly source: DocumentEditSource;
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
    let source: DocumentEditSource;
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

// Files agents wrote, newest first, from outputs that carry a location.
export function artifactPaths(project: ProjectResponse): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const output of Object.values(project.projection.outputs).sort(
    (a, b) => b.producedAtSequence - a.producedAtSequence,
  )) {
    if (!output.location || seen.has(output.location)) continue;
    seen.add(output.location);
    paths.push(output.location);
  }
  return paths;
}

export function artifactsNote(project: ProjectResponse): string {
  const count = artifactPaths(project).length;
  if (!count) return 'nothing written yet';
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

// Who made a document edit, as the UI names them.
export function editorLabel(source: DocumentEditSource | undefined): string {
  if (source === 'coordinator') return 'coordinator';
  if (source === 'agent') return 'agent';
  return 'you';
}

// Folders used by existing projects, most recently created first, so the
// start screen can offer them as one click.
export function recentFolders(
  projects:
    | ProjectResponse['projection']['project'][]
    | { project: ProjectResponse['projection']['project'] }[],
  limit = 5,
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  const list = projects.map((entry) =>
    'project' in entry ? entry.project : entry,
  );
  for (const project of [...list].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )) {
    const path = project.repository?.path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length >= limit) break;
  }
  return paths;
}
