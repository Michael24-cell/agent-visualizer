import {
  BRIEF_REQUIRED_FIELDS,
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

export function methodNote(project: ProjectResponse): string {
  const method = project.projection.method;
  return method
    ? `${method.definition.title} · v${method.version}`
    : 'default · customize';
}

export function planNote(project: ProjectResponse): string {
  const plans = Object.values(project.projection.plans);
  const current = plans
    .filter((plan) => !plan.supersededByPlanId)
    .sort((a, b) => b.version - a.version)[0];
  if (!current) return 'none yet';
  return current.assignedAtSequence
    ? `v${current.version} · assigned`
    : `v${current.version} · proposed`;
}

export function agentsNote(project: ProjectResponse): string {
  const counts = project.summary.agentCounts;
  const total = Object.values(project.projection.agents).length;
  const active = counts.working + counts.waiting + counts.needs_you;
  return total ? `${total} · ${active} active` : 'none yet';
}
