import { useEffect, useState } from 'react';
import {
  AGENT_MODELS,
  BRIEF_REQUIRED_FIELDS,
  BriefFieldIdSchema,
  agentModel,
  MethodSectionIdSchema,
  type BriefFieldId,
  type MethodDefinition,
  type MethodSectionId,
  type ProjectEvent,
  type ProjectResponse,
} from '@harness/contracts';
import {
  applyMethod,
  listMethods,
  overrideMethod,
  readEvents,
  updateBriefField,
} from './api';
export type DetailItem = 'brief' | 'method' | 'plan' | 'agents' | 'history';
import { workLabels } from './live';

// The left panel for a persisted project: switch projects, start a new one,
// and open the Brief, Method, Plans, Agents, or History beside the panes.
// Everything shown here is the service's projection; edits go through
// commands and the returned project replaces the current one.

const fieldLabels: Record<BriefFieldId, string> = {
  goal: 'Goal',
  scope: 'Scope',
  constraints: 'Constraints',
  doneMeans: 'Done means',
  checks: 'Checks',
  audience: 'Audience',
};

const fieldStateLabels = {
  missing: 'Not yet decided',
  inferred: 'Inferred — confirm?',
  confirmed: 'Confirmed',
  skipped: 'Skipped',
  corrected: 'Corrected',
} as const;

const sectionLabels: Record<MethodSectionId, string> = {
  hardRules: 'Hard rules',
  preferences: 'Preferences',
  promptGuidance: 'Prompt guidance',
  skills: 'Skills',
  outputExpectations: 'Output expectations',
  checks: 'Checks',
  scopeRestrictions: 'Scope restrictions',
};

// ---------------------------------------------------------------------------

function BriefView({ project, busy, onProject, onError }: DetailProps) {
  const [editing, setEditing] = useState<BriefFieldId>();
  const [draft, setDraft] = useState('');
  const brief = project.projection.brief;
  const projectId = project.projection.projectId;
  const run = async (
    fieldId: BriefFieldId,
    action: 'confirm' | 'correct' | 'skip',
    value?: string,
  ) => {
    try {
      const result = await updateBriefField(
        projectId,
        brief.lastSequence,
        fieldId,
        action,
        value,
      );
      onProject(result.project);
      setEditing(undefined);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The Brief was not updated.',
      );
    }
  };
  return (
    <div className="brief-view">
      <p className="detail-lead">
        {project.summary.briefReady
          ? 'Required fields are decided. Agents read this before they start.'
          : 'Answer the coordinator, or fill in fields here. Goal, scope, and done means are required.'}
      </p>
      <ul className="field-list">
        {BriefFieldIdSchema.options.map((fieldId) => {
          const field = brief.fields[fieldId];
          const required = BRIEF_REQUIRED_FIELDS.includes(fieldId);
          return (
            <li key={fieldId} className={`field-row state-${field.state}`}>
              <div className="field-head">
                <strong>{fieldLabels[fieldId]}</strong>
                <span className="field-state">
                  {fieldStateLabels[field.state]}
                  {required && field.state === 'missing' ? ' · required' : ''}
                </span>
              </div>
              {editing === fieldId ? (
                <form
                  className="field-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (draft.trim())
                      void run(fieldId, 'correct', draft.trim());
                  }}
                >
                  <textarea
                    autoFocus
                    rows={2}
                    value={draft}
                    aria-label={`${fieldLabels[fieldId]} value`}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="ask-actions">
                    <button
                      type="submit"
                      className="primary-action small"
                      disabled={busy}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="secondary-action small"
                      onClick={() => setEditing(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {field.value ? (
                    <p className="field-value">{field.value}</p>
                  ) : null}
                  <div className="ask-actions">
                    {field.state === 'inferred' ? (
                      <button
                        type="button"
                        className="primary-action small"
                        disabled={busy}
                        onClick={() => void run(fieldId, 'confirm')}
                      >
                        Confirm
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-action small"
                      disabled={busy}
                      onClick={() => {
                        setDraft(field.value ?? '');
                        setEditing(fieldId);
                      }}
                    >
                      {field.value ? 'Edit' : 'Write'}
                    </button>
                    {field.state === 'missing' || field.state === 'inferred' ? (
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={busy}
                        onClick={() => void run(fieldId, 'skip')}
                      >
                        Skip
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {brief.requests.length ? (
        <section className="brief-requests">
          <h3>Requests</h3>
          <ul>
            {brief.requests.map((request) => (
              <li key={request.id}>
                <span className="field-state">{request.category}</span>{' '}
                {request.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="detail-foot">
        Brief v{brief.version} ·{' '}
        <code>{project.brief.digest.slice(0, 19)}…</code>
      </p>
    </div>
  );
}

function MethodView({ project, busy, onProject, onError }: DetailProps) {
  const [catalog, setCatalog] = useState<MethodDefinition[]>();
  const [editing, setEditing] = useState<MethodSectionId>();
  const [draft, setDraft] = useState('');
  const method = project.projection.method;
  const projectId = project.projection.projectId;
  useEffect(() => {
    let active = true;
    void listMethods()
      .then((methods) => {
        if (active) setCatalog(methods);
      })
      .catch(() => {
        if (active) setCatalog([]);
      });
    return () => {
      active = false;
    };
  }, []);
  const resolved = (sectionId: MethodSectionId): string[] => {
    if (!method) return [];
    const override = [...method.overrides]
      .reverse()
      .find((entry) => entry.sectionId === sectionId);
    return override ? override.value : method.definition[sectionId];
  };
  const pinned = Object.values(project.projection.methodSnapshots).length;
  const apply = async (definition: MethodDefinition) => {
    try {
      const result = await applyMethod(
        projectId,
        method?.lastSequence ?? project.projection.lastSequence,
        { catalogId: definition.id, catalogVersion: definition.version },
      );
      onProject(result.project);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The Method was not applied.',
      );
    }
  };
  const save = async (sectionId: MethodSectionId) => {
    if (!method) return;
    const value = draft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      const result = await overrideMethod(
        projectId,
        method.lastSequence,
        sectionId,
        value,
      );
      onProject(result.project);
      setEditing(undefined);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The override was not saved.',
      );
    }
  };
  return (
    <div className="method-view">
      {method ? (
        <>
          <p className="detail-lead">
            <strong>{method.definition.title}</strong> v
            {method.definition.version} · project version {method.version} ·
            pinned to {pinned} {pinned === 1 ? 'task' : 'tasks'}
          </p>
          <p className="field-value">{method.definition.purpose}</p>
          <p className="field-state">
            When to use: {method.definition.whenToUse}
          </p>
          <ul className="field-list">
            {MethodSectionIdSchema.options.map((sectionId) => {
              const overridden = method.overrides.some(
                (o) => o.sectionId === sectionId,
              );
              const lines = resolved(sectionId);
              return (
                <li key={sectionId} className="field-row">
                  <div className="field-head">
                    <strong>{sectionLabels[sectionId]}</strong>
                    <span className="field-state">
                      {overridden ? 'customized here' : 'from catalog'}
                    </span>
                  </div>
                  {editing === sectionId ? (
                    <form
                      className="field-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(sectionId);
                      }}
                    >
                      <textarea
                        autoFocus
                        rows={4}
                        value={draft}
                        aria-label={`${sectionLabels[sectionId]} lines`}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <div className="ask-actions">
                        <button
                          type="submit"
                          className="primary-action small"
                          disabled={busy}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="secondary-action small"
                          onClick={() => setEditing(undefined)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      {lines.length ? (
                        <ul className="field-lines">
                          {lines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="field-value muted">Nothing here.</p>
                      )}
                      <div className="ask-actions">
                        <button
                          type="button"
                          className="secondary-action small"
                          disabled={busy}
                          onClick={() => {
                            setDraft(lines.join('\n'));
                            setEditing(sectionId);
                          }}
                        >
                          Customize
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="detail-foot">
            Customizing changes future tasks only; tasks already assigned keep
            the Method they started with.
          </p>
        </>
      ) : (
        <>
          <p className="detail-lead">
            <strong>Default behavior.</strong> Agents work the way the model
            does, with no extra rules, skills, or checks. Apply a Method if you
            want to shape how they work in this project.
          </p>
          {!catalog ? (
            <p className="field-state">Loading the catalog…</p>
          ) : null}
          <ul className="field-list">
            {(catalog ?? []).map((definition) => (
              <li key={definition.id} className="field-row">
                <div className="field-head">
                  <strong>{definition.title}</strong>
                  <span className="field-state">v{definition.version}</span>
                </div>
                <p className="field-value">{definition.purpose}</p>
                <p className="field-state">
                  When to use: {definition.whenToUse}
                </p>
                <div className="ask-actions">
                  <button
                    type="button"
                    className="primary-action small"
                    disabled={busy}
                    onClick={() => void apply(definition)}
                  >
                    Apply
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PlanView({ project }: DetailProps) {
  const plans = Object.values(project.projection.plans).sort(
    (a, b) => b.version - a.version,
  );
  if (!plans.length) {
    return (
      <p className="detail-lead">
        No plan yet. Tell the coordinator what to build and it will propose one.
      </p>
    );
  }
  return (
    <div className="plan-view">
      {plans.map((plan) => {
        const status = plan.supersededByPlanId
          ? 'superseded'
          : plan.assignedAtSequence
            ? 'assigned'
            : 'proposed';
        return (
          <section key={plan.id} className={`plan-block plan-${status}`}>
            <div className="field-head">
              <strong>Plan v{plan.version}</strong>
              <span className="field-state">{status}</span>
            </div>
            <p className="field-value">{plan.request}</p>
            <ol className="plan-tasks">
              {plan.tasks.map((row, index) => {
                const task = Object.values(project.projection.tasks).find(
                  (candidate) =>
                    candidate.planId === plan.id &&
                    candidate.planTaskIndex === index,
                );
                return (
                  <li key={index} className={`category-${row.category}`}>
                    <span className="cat-dot" aria-hidden="true" />
                    <span className="plan-task-index">{index + 1}</span>
                    <span className="plan-task-title">
                      {row.title}
                      {task ? ` · ${workLabels[task.state]}` : ''}
                    </span>
                    <span className="plan-task-agent">
                      {row.agentName}
                      {row.dependsOn.length
                        ? ` · after ${row.dependsOn.map((d) => d + 1).join(', ')}`
                        : ''}
                      {row.requiredChecks.length
                        ? ` · checks: ${row.requiredChecks.join(', ')}`
                        : ''}
                      {row.modelTier ? ` · ${row.modelTier} model` : ''}
                      <br />
                      {row.whySeparate} {row.whyThisAgent}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="plan-why">{plan.whyThisMany}</p>
          </section>
        );
      })}
    </div>
  );
}

function AgentsView({ project }: DetailProps) {
  const agents = Object.values(project.projection.agents).sort(
    (a, b) => a.createdAtSequence - b.createdAtSequence,
  );
  if (!agents.length) {
    return (
      <p className="detail-lead">
        No agents yet. Assign a plan, or open one from the header to start work
        directly.
      </p>
    );
  }
  return (
    <ul className="field-list">
      {agents.map((agent) => {
        const task = agent.currentTaskId
          ? project.projection.tasks[agent.currentTaskId]
          : undefined;
        const snapshot = task?.methodSnapshotId
          ? project.projection.methodSnapshots[task.methodSnapshotId]
          : undefined;
        return (
          <li key={agent.id} className={`field-row category-${agent.category}`}>
            <div className="field-head">
              <span className="cat-dot" aria-hidden="true" />
              <strong>{agent.name}</strong>
              <span className={`pane-state work-${agent.work}`}>
                {workLabels[agent.work]}
              </span>
            </div>
            <p className="field-value">
              {task ? task.title : 'Nothing in progress.'}
            </p>
            <p className="field-state">
              {agent.taskIds.length}{' '}
              {agent.taskIds.length === 1 ? 'task' : 'tasks'} so far
              {` · ${AGENT_MODELS[agentModel(agent)].label}`}
              {task?.skills.length
                ? ` · skills: ${task.skills.join(', ')}`
                : ''}
              {task?.modelTier ? ` · ${task.modelTier} model` : ''}
              {snapshot
                ? ` · Method ${snapshot.resolved.title} (pinned v${snapshot.methodVersion})`
                : task
                  ? ' · default behavior'
                  : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryView({ project }: DetailProps) {
  const [events, setEvents] = useState<ProjectEvent[]>();
  const projectId = project.projection.projectId;
  const lastSequence = project.projection.lastSequence;
  useEffect(() => {
    let active = true;
    void readEvents(projectId)
      .then((page) => {
        if (active) setEvents(page.events);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, lastSequence]);
  if (!events) return <p className="field-state">Loading history…</p>;
  return (
    <ol className="history-list">
      {[...events].reverse().map((event) => (
        <li key={event.id}>
          <span className="history-seq">{event.sequence}</span>
          <code>{event.type}</code>
          <span className="field-state">
            {event.source}
            {event.adapter ? ` · ${event.adapter.id}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface DetailProps {
  project: ProjectResponse;
  busy: boolean;
  onProject: (next: ProjectResponse) => void;
  onError: (message: string) => void;
}

export function ProjectDetail({
  item,
  onClose,
  ...props
}: DetailProps & { item: DetailItem; onClose: () => void }) {
  const titles: Record<DetailItem, string> = {
    brief: 'Brief',
    method: 'Method',
    plan: 'Plans',
    agents: 'Agents',
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
        {item === 'brief' ? <BriefView {...props} /> : null}
        {item === 'method' ? <MethodView {...props} /> : null}
        {item === 'plan' ? <PlanView {...props} /> : null}
        {item === 'agents' ? <AgentsView {...props} /> : null}
        {item === 'history' ? <HistoryView {...props} /> : null}
      </div>
    </aside>
  );
}
