import { useLayoutEffect, useRef, useState } from 'react';
import {
  PLAN_SECTIONS,
  type MessageContext,
  type ProjectResponse,
} from '@harness/contracts';
import { workLabels } from './live';
import {
  branchOf,
  buildLooseEnds,
  buildProjectMap,
  type ProjectMap,
} from './project-map';

// The shape of the work: ideas on the left, the tasks that took them,
// the files they produced. Connectors are drawn from where the cards
// actually land, so the layout stays honest as things are added.

interface Line {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly d: string;
}

function curve(a: DOMRect, b: DOMRect, origin: DOMRect): string {
  const x1 = a.right - origin.left;
  const y1 = a.top + a.height / 2 - origin.top;
  const x2 = b.left - origin.left;
  const y2 = b.top + b.height / 2 - origin.top;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function MapView({
  project,
  onOpenAgent,
  onOpenArtifact,
  onOpenSection,
  onAsk,
}: {
  project: ProjectResponse;
  onOpenAgent: (agentId: string) => void;
  onOpenArtifact: (path: string) => void;
  onOpenSection: () => void;
  onAsk: (context: MessageContext) => void;
}) {
  const map: ProjectMap = buildProjectMap(project);
  const looseEnds = buildLooseEnds(project);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [hovered, setHovered] = useState<string>();

  // Measure after every layout: the cards decide where the lines go.
  useLayoutEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const origin = canvas.getBoundingClientRect();
      setLines(
        map.edges
          .map((edge) => {
            const from = nodes.current.get(edge.from);
            const to = nodes.current.get(edge.to);
            if (!from || !to) return undefined;
            return {
              key: `${edge.from}->${edge.to}`,
              from: edge.from,
              to: edge.to,
              d: curve(
                from.getBoundingClientRect(),
                to.getBoundingClientRect(),
                origin,
              ),
            };
          })
          .filter((line): line is Line => Boolean(line)),
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener('resize', draw);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', draw);
    };
    // The edges are derived from the projection: its sequence is the
    // honest signal that they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projection.lastSequence, map.edges.length]);

  const branch = hovered ? branchOf(map, hovered) : undefined;
  const dim = (id: string) => (branch && !branch.has(id) ? 'is-dim' : '');
  const register = (id: string) => (element: HTMLElement | null) => {
    if (element) nodes.current.set(id, element);
    else nodes.current.delete(id);
  };

  if (!map.ideas.length && !map.tasks.length) {
    return (
      <div className="map-view">
        <div className="map empty">
          <p className="detail-lead">
            Nothing to map yet. Write the Plan, or give an agent work, and the
            shape of it appears here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-view">
      {looseEnds.length ? (
        <section className="loose-ends" aria-label="Loose ends">
          <h3>
            Loose ends <span>{looseEnds.length}</span>
          </h3>
          <ul>
            {looseEnds.map((end) => (
              <li key={end.id} className={`loose-${end.kind}`}>
                <span className="loose-title">{end.title}</span>
                <span className="loose-note">{end.note}</span>
                <span className="loose-actions">
                  {end.agentId ? (
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => onOpenAgent(end.agentId!)}
                    >
                      Open
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() =>
                      onAsk({
                        kind: end.context.kind,
                        label: end.context.label,
                        detail: end.context.detail.slice(0, 4_000),
                        ...(end.context.sectionId
                          ? { sectionId: end.context.sectionId }
                          : {}),
                        ...(end.context.path ? { path: end.context.path } : {}),
                      })
                    }
                  >
                    Pick it up
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="map" ref={canvasRef}>
        <svg className="map-lines" aria-hidden="true">
          {lines.map((line) => (
            <path
              key={line.key}
              d={line.d}
              className={
                branch && (!branch.has(line.from) || !branch.has(line.to))
                  ? 'is-dim'
                  : ''
              }
            />
          ))}
        </svg>

        <section className="map-column" aria-label="Ideas">
          <h3>Ideas</h3>
          {map.ideas.length === 0 ? (
            <p className="map-empty">The Plan is empty.</p>
          ) : null}
          {map.ideas.map((idea) => (
            <article
              key={idea.id}
              ref={register(idea.id)}
              className={`map-node map-idea ${idea.unclaimed ? 'is-unclaimed' : ''} ${dim(idea.id)}`}
              onMouseEnter={() => setHovered(idea.id)}
              onMouseLeave={() => setHovered(undefined)}
            >
              <header>
                <button
                  type="button"
                  className="map-title"
                  onClick={onOpenSection}
                >
                  {idea.title}
                </button>
                {idea.unclaimed ? (
                  <span className="map-flag">no task</span>
                ) : (
                  <span className="map-count">{idea.taskIds.length}</span>
                )}
              </header>
              <ul>
                {idea.lines.slice(0, 5).map((line, index) => (
                  <li key={`${index}-${line}`}>
                    <button
                      type="button"
                      title="Point your next message at this"
                      onClick={() =>
                        onAsk({
                          kind: 'plan',
                          label: `Plan · ${PLAN_SECTIONS[idea.sectionId].title}`,
                          detail: line,
                          sectionId: idea.sectionId,
                          line: index + 1,
                        })
                      }
                    >
                      {line}
                    </button>
                  </li>
                ))}
                {idea.lines.length > 5 ? (
                  <li className="map-more">+{idea.lines.length - 5} more</li>
                ) : null}
              </ul>
            </article>
          ))}
        </section>

        <section className="map-column" aria-label="Tasks">
          <h3>Tasks</h3>
          {map.tasks.length === 0 ? (
            <p className="map-empty">No work has started.</p>
          ) : null}
          {map.tasks.map((task) => (
            <article
              key={task.id}
              ref={register(task.id)}
              className={`map-node map-task work-${task.state} ${dim(task.id)}`}
              onMouseEnter={() => setHovered(task.id)}
              onMouseLeave={() => setHovered(undefined)}
            >
              <header>
                <button
                  type="button"
                  className="map-title"
                  title={`Open ${task.agentName}`}
                  onClick={() => onOpenAgent(task.agentId)}
                >
                  {task.title}
                </button>
                <span className={`pane-state work-${task.state}`}>
                  {workLabels[task.state]}
                </span>
              </header>
              <p className="map-meta">
                {task.agentName}
                {task.checksPassed || task.checksFailed
                  ? ` · ${task.checksPassed} passed${task.checksFailed ? `, ${task.checksFailed} failed` : ''}`
                  : ''}
                {task.unverified ? ' · unverified' : ''}
              </p>
            </article>
          ))}
        </section>

        <section className="map-column" aria-label="Files">
          <h3>Files</h3>
          {map.files.length === 0 ? (
            <p className="map-empty">Nothing written yet.</p>
          ) : null}
          {map.files.map((file) => (
            <article
              key={file.id}
              ref={register(file.id)}
              className={`map-node map-file ${dim(file.id)}`}
              onMouseEnter={() => setHovered(file.id)}
              onMouseLeave={() => setHovered(undefined)}
            >
              <button
                type="button"
                className="map-title"
                title="Open in Artifacts"
                onClick={() => onOpenArtifact(file.path)}
              >
                {file.path}
              </button>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
