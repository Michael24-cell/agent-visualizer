import { useEffect, useState } from 'react';
import {
  AGENT_MODELS,
  BRIEF_REQUIRED_FIELDS,
  BriefFieldIdSchema,
  PLAN_SECTIONS,
  PlanSectionIdSchema,
  TOOL_POLICIES,
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
  editPlanSection,
  listMethods,
  overrideMethod,
  readEvents,
  resetMethod,
  updateBriefField,
} from './api';
import { ArtifactsView } from './artifacts';
import { DocumentSection } from './document-section';
import {
  documentChanges,
  editorLabel,
  type DocumentChange,
} from './project-notes';
export type DetailItem =
  'brief' | 'method' | 'plan' | 'agents' | 'artifacts' | 'history';
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
const sectionHints: Record<MethodSectionId, string> = {
  hardRules: 'Things agents must never do or always do.',
  preferences: 'How to lean when there is a choice.',
  promptGuidance: 'Extra instruction every agent gets.',
  skills: 'Named skills agents should apply.',
  outputExpectations: 'What a finished task hands back.',
  checks: 'Commands that must pass before done.',
  scopeRestrictions: 'Where agents may and may not write.',
};
// The coordinator phrase that edits each Method section.
const sectionExamples: Record<MethodSectionId, string> = {
  hardRules: 'Hard rules',
  preferences: 'Preferences',
  promptGuidance: 'Guidance',
  skills: 'Skills',
  outputExpectations: 'Outputs',
  checks: 'Method checks',
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
  const save = async (sectionId: MethodSectionId, value: string[]) => {
    if (!method) return;
    try {
      const result = await overrideMethod(
        projectId,
        method.lastSequence,
        sectionId,
        value,
      );
      onProject(result.project);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The override was not saved.',
      );
      throw error;
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
          <p className="field-state">
            Tools:{' '}
            {
              TOOL_POLICIES[method.definition.agentDefaults?.tools ?? 'full']
                .label
            }{' '}
            ·{' '}
            {
              TOOL_POLICIES[method.definition.agentDefaults?.tools ?? 'full']
                .note
            }
          </p>
          <DocumentChanges project={project} document="method" />
          <div className="doc">
            {MethodSectionIdSchema.options.map((sectionId) => {
              const override = [...method.overrides]
                .reverse()
                .find((o) => o.sectionId === sectionId);
              const example = `${sectionExamples[sectionId]}: …`;
              return (
                <DocumentSection
                  key={sectionId}
                  id={`method-${sectionId}`}
                  title={sectionLabels[sectionId]}
                  hint={sectionHints[sectionId]}
                  lines={resolved(sectionId)}
                  meta={
                    override
                      ? `${editorLabel(override.source)} · #${override.recordedAtSequence}`
                      : 'from catalog'
                  }
                  example={example}
                  busy={busy}
                  onSave={(lines) => save(sectionId, lines)}
                />
              );
            })}
          </div>
          <p className="detail-foot">
            Customizing changes future tasks only; tasks already assigned keep
            the Method they started with.
          </p>
          {method.overrides.length ? (
            <div className="ask-actions">
              <button
                type="button"
                className="secondary-action small"
                disabled={busy}
                onClick={() => {
                  void resetMethod(projectId, method.lastSequence)
                    .then((result) => onProject(result.project))
                    .catch((error: unknown) =>
                      onError(
                        error instanceof Error
                          ? error.message
                          : 'The Method was not reset.',
                      ),
                    );
                }}
              >
                Reset to catalog
              </button>
            </div>
          ) : null}
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
                <p className="field-state">
                  Tools:{' '}
                  {
                    TOOL_POLICIES[definition.agentDefaults?.tools ?? 'full']
                      .label
                  }
                  {definition.agentDefaults?.modelTier
                    ? ` · ${definition.agentDefaults.modelTier} model`
                    : ''}
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

function PlanView({ project, busy, onProject, onError }: DetailProps) {
  const projectId = project.projection.projectId;
  const doc = project.projection.planDocument;
  const plans = Object.values(project.projection.plans).sort(
    (a, b) => b.version - a.version,
  );
  const save = async (
    sectionId: (typeof PlanSectionIdSchema.options)[number],
    lines: string[],
  ) => {
    try {
      const result = await editPlanSection(
        projectId,
        doc.lastSequence,
        sectionId,
        lines,
      );
      onProject(result.project);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The section was not saved.',
      );
      throw error;
    }
  };
  return (
    <div className="plan-view">
      <p className="detail-lead">
        What the project should become, in your words. Edit any section, or tell
        the coordinator (“Features: offline sync”). Tasks below are the work
        derived from it.
      </p>
      <DocumentChanges project={project} document="plan" />
      <div className="doc">
        {PlanSectionIdSchema.options.map((sectionId) => {
          const section = doc.sections[sectionId];
          return (
            <DocumentSection
              key={sectionId}
              id={`plan-${sectionId}`}
              title={PLAN_SECTIONS[sectionId].title}
              hint={PLAN_SECTIONS[sectionId].hint}
              lines={section?.lines ?? []}
              meta={
                section
                  ? `${editorLabel(section.source)} · #${section.updatedAtSequence}`
                  : 'empty'
              }
              example={`${PLAN_SECTIONS[sectionId].title}: …`}
              busy={busy}
              onSave={(lines) => save(sectionId, lines)}
              footer={<SectionTasks project={project} sectionId={sectionId} />}
            />
          );
        })}
      </div>
      <h3 className="doc-tasks-title">Tasks</h3>
      {!plans.length ? (
        <p className="field-value muted">
          No tasks yet. Tell the coordinator what to build and it will propose
          them.
        </p>
      ) : null}
      {plans.map((plan) => {
        const status = plan.supersededByPlanId
          ? 'superseded'
          : plan.assignedAtSequence
            ? 'assigned'
            : 'proposed';
        return (
          <section key={plan.id} className={`plan-block plan-${status}`}>
            <div className="field-head">
              <strong>Tasks v{plan.version}</strong>
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
                      {row.sections?.length ? (
                        <>
                          {' · '}
                          {row.sections.map((id) => (
                            <a
                              key={id}
                              className="section-chip"
                              href={`#doc-plan-${id}`}
                            >
                              {PLAN_SECTIONS[id].title}
                            </a>
                          ))}
                        </>
                      ) : null}
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

// Tasks that implement a Plan section, with their state.
function SectionTasks({
  project,
  sectionId,
}: {
  project: ProjectResponse;
  sectionId: (typeof PlanSectionIdSchema.options)[number];
}) {
  const tasks = Object.values(project.projection.tasks)
    .filter((task) => task.sections?.includes(sectionId))
    .sort((a, b) => a.createdAtSequence - b.createdAtSequence);
  if (!tasks.length) return null;
  return (
    <p className="doc-section-tasks">
      {tasks.map((task, index) => {
        const agent = project.projection.agents[task.agentId];
        return (
          <span key={task.id} className={`doc-task task-${task.state}`}>
            {index > 0 ? ' · ' : ''}
            <span className={`cat-dot work-${task.state}`} aria-hidden="true" />
            {task.title.length > 48
              ? `${task.title.slice(0, 47)}…`
              : task.title}
            {agent ? ` — ${agent.name}` : ''} · {workLabels[task.state]}
          </span>
        );
      })}
    </p>
  );
}

// The last few edits to a document, with what each one added and removed.
function DocumentChanges({
  project,
  document,
}: {
  project: ProjectResponse;
  document: 'plan' | 'method';
}) {
  const [changes, setChanges] = useState<DocumentChange[]>();
  const [open, setOpen] = useState<number>();
  const projectId = project.projection.projectId;
  const lastSequence = project.projection.lastSequence;
  useEffect(() => {
    let active = true;
    void readEvents(projectId)
      .then((page) => {
        if (!active) return;
        const planTitles = Object.fromEntries(
          PlanSectionIdSchema.options.map((id) => [
            id,
            PLAN_SECTIONS[id].title,
          ]),
        );
        setChanges(
          documentChanges(page.events, {
            plan: planTitles,
            method: sectionLabels,
          }).filter((change) => change.document === document),
        );
      })
      .catch(() => {
        if (active) setChanges([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, lastSequence, document]);
  if (!changes?.length) return null;
  return (
    <ol className="doc-changes" aria-label="Recent changes">
      {changes.slice(0, 5).map((change) => (
        <li key={change.sequence}>
          <button
            type="button"
            className="doc-change"
            aria-expanded={open === change.sequence}
            onClick={() =>
              setOpen(open === change.sequence ? undefined : change.sequence)
            }
          >
            <span className="doc-change-section">{change.section}</span>
            <span className="doc-change-who">{editorLabel(change.source)}</span>
            <span className="doc-change-delta">
              {change.added.length ? `+${change.added.length}` : ''}
              {change.added.length && change.removed.length ? ' ' : ''}
              {change.removed.length ? `−${change.removed.length}` : ''}
              {!change.added.length && !change.removed.length
                ? 'reordered'
                : ''}
            </span>
          </button>
          {open === change.sequence ? (
            <ul className="doc-change-lines">
              {change.added.map((line) => (
                <li key={`+${line}`} className="added">
                  {line}
                </li>
              ))}
              {change.removed.map((line) => (
                <li key={`-${line}`} className="removed">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
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
  artifact,
  onSelectArtifact,
  onClose,
  ...props
}: DetailProps & {
  item: DetailItem;
  artifact?: string | undefined;
  onSelectArtifact?: ((path: string | undefined) => void) | undefined;
  onClose: () => void;
}) {
  const titles: Record<DetailItem, string> = {
    brief: 'Brief',
    method: 'Method',
    plan: 'Plan',
    agents: 'Agents',
    artifacts: 'Artifacts',
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
        {item === 'artifacts' ? (
          <ArtifactsView
            project={props.project}
            selected={artifact}
            onSelect={onSelectArtifact ?? (() => undefined)}
          />
        ) : null}
        {item === 'history' ? <HistoryView {...props} /> : null}
      </div>
    </aside>
  );
}
