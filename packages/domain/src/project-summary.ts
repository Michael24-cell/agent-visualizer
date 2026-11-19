import {
  AgentWorkStateSchema,
  BRIEF_REQUIRED_FIELDS,
  ProjectSummarySchema,
  type AgentWorkState,
  type AttentionItem,
  type Brief,
  type ProjectProjection,
  type ProjectStatus,
  type ProjectSummary,
} from '@harness/contracts';
import { isTerminalTaskState } from './project-transitions.js';

export function isBriefReady(brief: Brief): boolean {
  return BRIEF_REQUIRED_FIELDS.every((fieldId) =>
    ['confirmed', 'skipped', 'corrected'].includes(brief.fields[fieldId].state),
  );
}

// The latest required check for each (task, name) pair that has failed while
// its task is still open. Earlier failures replaced by a passing retry do not
// count.
function failedChecks(projection: ProjectProjection) {
  const latest = new Map<string, ProjectProjection['checks'][string]>();
  for (const check of Object.values(projection.checks).sort(
    (a, b) => a.startedAtSequence - b.startedAtSequence,
  )) {
    latest.set(`${check.taskId}:${check.name}`, check);
  }
  return [...latest.values()].filter((check) => {
    const task = projection.tasks[check.taskId];
    return (
      check.state === 'failed' &&
      task &&
      task.requiredChecks.includes(check.name) &&
      !isTerminalTaskState(task.state)
    );
  });
}

function deriveStatus(
  projection: ProjectProjection,
  counts: Record<AgentWorkState, number>,
  openAsks: number,
  openProposals: number,
  failed: number,
): ProjectStatus {
  const tasks = Object.values(projection.tasks);
  const agents = Object.values(projection.agents);
  if (openAsks > 0) return 'needs_you';
  if (failed > 0) return 'reviewing';
  if (counts.working > 0 || counts.waiting > 0) return 'working';
  if (openProposals > 0) return 'planning';
  if (tasks.length === 0) {
    return isBriefReady(projection.brief) ? 'idle' : 'intake';
  }
  const everyAgentSettled = agents.every((agent) =>
    ['idle', 'done', 'stopped', 'failed'].includes(agent.work),
  );
  if (everyAgentSettled && counts.stopped > 0) return 'partially_stopped';
  if (
    everyAgentSettled &&
    tasks.every((task) => task.state === 'done') &&
    counts.failed === 0
  ) {
    return 'complete';
  }
  return 'idle';
}

// The single thing to look at first, in priority order: an open ask, then an
// open proposal, then a failed check, then unfinished intake.
function deriveAttention(
  projection: ProjectProjection,
): AttentionItem | undefined {
  const ask = Object.values(projection.asks)
    .filter((candidate) => candidate.state === 'open')
    .sort((a, b) => a.openedAtSequence - b.openedAtSequence)[0];
  if (ask) {
    const agent = projection.agents[ask.agentId];
    return {
      kind: 'ask',
      label: `${agent?.name ?? 'An agent'} needs you: ${ask.action}`,
      askId: ask.id,
      agentId: ask.agentId,
      taskId: ask.taskId,
    };
  }
  const proposal = Object.values(projection.proposals)
    .filter((candidate) => candidate.state === 'open')
    .sort((a, b) => a.openedAtSequence - b.openedAtSequence)[0];
  if (proposal) {
    return { kind: 'proposal', label: proposal.title, proposalId: proposal.id };
  }
  const check = failedChecks(projection).sort(
    (a, b) => a.startedAtSequence - b.startedAtSequence,
  )[0];
  if (check) {
    const agent = projection.agents[check.agentId];
    return {
      kind: 'check_failed',
      label: `${agent?.name ?? 'An agent'} needs a fix: ${check.name} failed`,
      checkId: check.id,
      agentId: check.agentId,
      taskId: check.taskId,
    };
  }
  if (
    Object.keys(projection.tasks).length === 0 &&
    !isBriefReady(projection.brief)
  ) {
    return { kind: 'intake', label: 'Tell the planner what to build' };
  }
  return undefined;
}

// Service-authoritative "right now". Deterministic: same projection, same
// summary.
export function summarizeProject(
  projection: ProjectProjection,
): ProjectSummary {
  const counts = Object.fromEntries(
    AgentWorkStateSchema.options.map((state) => [state, 0]),
  ) as Record<AgentWorkState, number>;
  for (const agent of Object.values(projection.agents)) {
    counts[agent.work] += 1;
  }
  const openAskIds = Object.values(projection.asks)
    .filter((ask) => ask.state === 'open')
    .sort((a, b) => a.openedAtSequence - b.openedAtSequence)
    .map((ask) => ask.id);
  const openProposalIds = Object.values(projection.proposals)
    .filter((proposal) => proposal.state === 'open')
    .sort((a, b) => a.openedAtSequence - b.openedAtSequence)
    .map((proposal) => proposal.id);
  const failed = failedChecks(projection).length;
  const attention = deriveAttention(projection);
  return ProjectSummarySchema.parse({
    status: deriveStatus(
      projection,
      counts,
      openAskIds.length,
      openProposalIds.length,
      failed,
    ),
    briefReady: isBriefReady(projection.brief),
    agentCounts: counts,
    openAskIds,
    openProposalIds,
    ...(attention ? { attention } : {}),
    lastSequence: projection.lastSequence,
  });
}
