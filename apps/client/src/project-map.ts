import {
  PLAN_SECTIONS,
  PlanSectionIdSchema,
  type AgentTaskState,
  type PlanSectionId,
  type ProjectResponse,
} from '@harness/contracts';

// The shape of the work, derived from the projection: ideas become
// tasks, tasks produce files. Nothing here is stored; it is a reading of
// what the stream already holds.

export interface MapIdea {
  readonly id: string;
  readonly sectionId: PlanSectionId;
  readonly title: string;
  readonly lines: readonly string[];
  // Tasks that say they implement this section.
  readonly taskIds: readonly string[];
  // A section with lines and no task is work nobody has taken.
  readonly unclaimed: boolean;
}

export interface MapTask {
  readonly id: string;
  readonly title: string;
  readonly state: AgentTaskState;
  readonly agentId: string;
  readonly agentName: string;
  readonly sectionIds: readonly PlanSectionId[];
  readonly fileIds: readonly string[];
  readonly checksPassed: number;
  readonly checksFailed: number;
  // Files changed with nothing to prove they work.
  readonly unverified: boolean;
}

export interface MapFile {
  readonly id: string;
  readonly path: string;
  readonly taskIds: readonly string[];
  readonly lastSequence: number;
}

export interface ProjectMap {
  readonly ideas: readonly MapIdea[];
  readonly tasks: readonly MapTask[];
  readonly files: readonly MapFile[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

export function buildProjectMap(project: ProjectResponse): ProjectMap {
  const projection = project.projection;
  const tasks = Object.values(projection.tasks).sort(
    (a, b) => a.createdAtSequence - b.createdAtSequence,
  );

  const files = new Map<
    string,
    { path: string; taskIds: string[]; lastSequence: number }
  >();
  for (const output of Object.values(projection.outputs)) {
    const path = output.location ?? output.title;
    const id = `file:${path}`;
    const entry = files.get(id) ?? { path, taskIds: [], lastSequence: 0 };
    if (!entry.taskIds.includes(output.taskId))
      entry.taskIds.push(output.taskId);
    entry.lastSequence = Math.max(
      entry.lastSequence,
      output.producedAtSequence,
    );
    files.set(id, entry);
  }

  const mapTasks: MapTask[] = tasks.map((task) => {
    const checks = Object.values(projection.checks).filter(
      (check) => check.taskId === task.id,
    );
    const fileIds = [...files.entries()]
      .filter(([, entry]) => entry.taskIds.includes(task.id))
      .map(([id]) => id);
    const passed = checks.filter((check) => check.state === 'passed').length;
    const failed = checks.filter((check) => check.state === 'failed').length;
    return {
      id: task.id,
      title: task.title,
      state: task.state,
      agentId: task.agentId,
      agentName: projection.agents[task.agentId]?.name ?? 'Agent',
      sectionIds: task.sections ?? [],
      fileIds,
      checksPassed: passed,
      checksFailed: failed,
      unverified: fileIds.length > 0 && passed === 0,
    };
  });

  const ideas: MapIdea[] = PlanSectionIdSchema.options
    .map((sectionId) => {
      const lines = projection.planDocument.sections[sectionId]?.lines ?? [];
      const taskIds = mapTasks
        .filter((task) => task.sectionIds.includes(sectionId))
        .map((task) => task.id);
      return {
        id: `idea:${sectionId}`,
        sectionId,
        title: PLAN_SECTIONS[sectionId].title,
        lines,
        taskIds,
        unclaimed: lines.length > 0 && taskIds.length === 0,
      };
    })
    .filter((idea) => idea.lines.length > 0 || idea.taskIds.length > 0);

  const edges: { from: string; to: string }[] = [];
  for (const idea of ideas) {
    for (const taskId of idea.taskIds)
      edges.push({ from: idea.id, to: taskId });
  }
  for (const task of mapTasks) {
    for (const fileId of task.fileIds)
      edges.push({ from: task.id, to: fileId });
  }

  return {
    ideas,
    tasks: mapTasks,
    files: [...files.entries()]
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => b.lastSequence - a.lastSequence),
    edges,
  };
}

// Everything connected to one node, for highlighting a branch.
export function branchOf(map: ProjectMap, nodeId: string): Set<string> {
  const branch = new Set<string>([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of map.edges) {
      if (branch.has(edge.from) && !branch.has(edge.to)) {
        branch.add(edge.to);
        grew = true;
      }
      if (branch.has(edge.to) && !branch.has(edge.from)) {
        branch.add(edge.from);
        grew = true;
      }
    }
  }
  return branch;
}

// What is hanging: ideas nobody took, work that stopped, files nothing
// proved, decisions that closed a door. Each carries the one thing to
// point at when you pick it up again.
export interface LooseEnd {
  readonly id: string;
  readonly kind: 'idea' | 'task' | 'file' | 'ask';
  readonly title: string;
  readonly note: string;
  readonly context: {
    readonly kind: 'plan' | 'file' | 'message';
    readonly label: string;
    readonly detail: string;
    readonly sectionId?: string;
    readonly path?: string;
  };
  readonly agentId?: string;
}

export function buildLooseEnds(project: ProjectResponse): LooseEnd[] {
  const projection = project.projection;
  const map = buildProjectMap(project);
  const ends: LooseEnd[] = [];

  for (const idea of map.ideas) {
    if (!idea.unclaimed) continue;
    ends.push({
      id: `loose:${idea.id}`,
      kind: 'idea',
      title: `${idea.title}: ${idea.lines.length} ${idea.lines.length === 1 ? 'idea' : 'ideas'} with no task`,
      note: idea.lines.slice(0, 2).join(' · '),
      context: {
        kind: 'plan',
        label: `Plan · ${idea.title}`,
        detail: idea.lines.join('\n'),
        sectionId: idea.sectionId,
      },
    });
  }

  for (const task of map.tasks) {
    if (task.state !== 'failed' && task.state !== 'stopped') continue;
    const record = projection.tasks[task.id];
    ends.push({
      id: `loose:${task.id}`,
      kind: 'task',
      title: `${task.state === 'failed' ? 'Failed' : 'Stopped'}: ${task.title}`,
      note: record?.endReason ?? task.agentName,
      context: {
        kind: 'message',
        label: `Task · ${task.title}`,
        detail: record?.objective ?? task.title,
      },
      agentId: task.agentId,
    });
  }

  for (const task of map.tasks) {
    if (!task.unverified) continue;
    for (const fileId of task.fileIds) {
      const file = map.files.find((entry) => entry.id === fileId);
      if (!file) continue;
      ends.push({
        id: `loose:verify:${file.id}`,
        kind: 'file',
        title: `${file.path} changed, nothing ran`,
        note: task.title,
        context: {
          kind: 'file',
          label: file.path,
          detail: `Changed by “${task.title}” with no passing check.`,
          path: file.path,
        },
        agentId: task.agentId,
      });
    }
  }

  for (const ask of Object.values(projection.asks)) {
    if (ask.state !== 'denied') continue;
    ends.push({
      id: `loose:${ask.id}`,
      kind: 'ask',
      title: `You declined: ${ask.action}`,
      note: ask.reason,
      context: {
        kind: 'message',
        label: `Declined · ${ask.action}`,
        detail: `${ask.reason} Scope: ${ask.scope}.`,
      },
      agentId: ask.agentId,
    });
  }

  return ends;
}
