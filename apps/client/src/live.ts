import type {
  Agent,
  AgentWorkState,
  ProjectResponse,
  Thread,
} from '@harness/contracts';

export const workLabels: Record<AgentWorkState, string> = {
  idle: 'Idle',
  waiting: 'Waiting',
  working: 'Working',
  needs_you: 'Needs you',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
};

export type LiveTarget =
  | { kind: 'agent'; agent: Agent; thread: Thread }
  | { kind: 'coordinator'; thread: Thread };

export function liveTargets(project: ProjectResponse): LiveTarget[] {
  const threads = Object.values(project.projection.threads);
  const coordinator = threads.find((thread) => thread.kind === 'coordinator');
  const agents = Object.values(project.projection.agents)
    .sort((a, b) => a.createdAtSequence - b.createdAtSequence)
    .map((agent): LiveTarget | undefined => {
      const thread = project.projection.threads[agent.threadId];
      return thread ? { kind: 'agent', agent, thread } : undefined;
    })
    .filter((target): target is LiveTarget => Boolean(target));
  return coordinator
    ? [...agents, { kind: 'coordinator', thread: coordinator }]
    : agents;
}

export function liveTargetId(target: LiveTarget): string {
  return target.kind === 'agent' ? target.agent.id : 'coordinator';
}

export function liveTargetTitle(target: LiveTarget): string {
  return target.kind === 'agent' ? target.agent.name : 'Coordinator';
}

// Which conversation a project opens on: wherever the person's words
// went. Planning with no agent work yet means the coordinator; otherwise
// the agent that has (or last had) a task, else the first agent.
export function firstPane(project: ProjectResponse): string {
  const agents = liveTargets(project).filter(
    (target) => target.kind === 'agent',
  );
  const worked = agents.find(
    (target) => target.kind === 'agent' && target.agent.taskIds.length > 0,
  );
  if (worked) return liveTargetId(worked);
  const coordinator = Object.values(project.projection.threads).find(
    (thread) => thread.kind === 'coordinator',
  );
  // More than the opening greeting means the person spoke there.
  if (coordinator && coordinator.messageCount > 1) return 'coordinator';
  return agents[0] ? liveTargetId(agents[0]) : 'coordinator';
}
