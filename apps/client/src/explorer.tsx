import type { DemoRunSnapshot, WorkspaceFixture } from '@harness/contracts';
import { CapabilityAtlas } from './capability-atlas';
import { phaseLabel } from './conversation';
import type { FixtureTaskKey, TaskViewModel } from './model';
import { HistorySurface } from './operational-surfaces';
import { BriefStage, MethodStage, StagePanel } from './shell';
import { currentStageFor, type Stage } from './stages';

export type ExplorerItem = 'brief' | 'method' | 'plan' | 'agents' | 'history';

export function ProjectExplorer({
  workspace,
  snapshot,
  selected,
  onSelect,
}: {
  workspace: WorkspaceFixture;
  snapshot?: DemoRunSnapshot | undefined;
  selected: ExplorerItem | undefined;
  onSelect: (item: ExplorerItem | undefined) => void;
}) {
  const runs = snapshot ? 1 : 0;
  const planNote = !snapshot ? 'ready to start' : phaseLabel(snapshot.phase);
  const rows: Array<{ id: ExplorerItem; label: string; note: string }> = [
    { id: 'brief', label: 'Brief', note: 'what we are building' },
    {
      id: 'method',
      label: 'Method',
      note: `${workspace.context.methodology.name} v${workspace.context.methodology.version}`,
    },
    { id: 'plan', label: 'Plan', note: planNote },
    {
      id: 'agents',
      label: 'Agents & skills',
      note: `${workspace.capabilities.filter((c) => c.availability === 'active').length} active`,
    },
    {
      id: 'history',
      label: 'History',
      note: runs ? 'latest work' : 'nothing yet',
    },
  ];
  return (
    <nav className="explorer" aria-label="Project">
      <div className="explorer-project">
        <strong>{workspace.project.name}</strong>
        <small>
          {workspace.project.repository} · {workspace.project.branch}
        </small>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              aria-pressed={selected === row.id}
              onClick={() => onSelect(selected === row.id ? undefined : row.id)}
            >
              <span>{row.label}</span>
              <small>{row.note}</small>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ExplorerDetail({
  item,
  workspace,
  tasks,
  selectedTask,
  snapshot,
  busy,
  stage,
  onStage,
  onSelectTask,
  onLaunch,
  onClose,
}: {
  item: ExplorerItem;
  workspace: WorkspaceFixture;
  tasks: TaskViewModel[];
  selectedTask: FixtureTaskKey;
  snapshot?: DemoRunSnapshot | undefined;
  busy: boolean;
  stage: Stage | undefined;
  onStage: (stage: Stage) => void;
  onSelectTask: (task: FixtureTaskKey) => void;
  onLaunch: () => void;
  onClose: () => void;
}) {
  const titles: Record<ExplorerItem, string> = {
    brief: 'Brief',
    method: 'Method',
    plan: 'Plan',
    agents: 'Agents & skills',
    history: 'History',
  };
  return (
    <aside
      className={`detail detail-${item}`}
      role="complementary"
      aria-label={titles[item]}
    >
      <header className="detail-header">
        <strong>{titles[item]}</strong>
        <button
          type="button"
          className="pane-close"
          aria-label={`Close ${titles[item]}`}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="detail-body">
        {item === 'brief' ? <BriefStage workspace={workspace} /> : null}
        {item === 'method' ? <MethodStage workspace={workspace} /> : null}
        {item === 'plan' ? (
          <StagePanel
            stages={['plan', 'run', 'review']}
            stage={stage ?? currentStageFor(snapshot)}
            current={currentStageFor(snapshot)}
            workspace={workspace}
            tasks={tasks}
            selected={selectedTask}
            snapshot={snapshot}
            busy={busy}
            onStage={onStage}
            onSelect={onSelectTask}
            onLaunch={onLaunch}
          />
        ) : null}
        {item === 'agents' ? (
          <CapabilityAtlas capabilities={workspace.capabilities} />
        ) : null}
        {item === 'history' ? <HistorySurface snapshot={snapshot} /> : null}
      </div>
    </aside>
  );
}
