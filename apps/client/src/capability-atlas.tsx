import { useMemo, useState, type CSSProperties } from 'react';
import type { WorkspaceFixture } from '@harness/contracts';
import {
  filterCapabilities,
  type Capability,
  type CapabilityFilter,
} from './model';

const positions: Record<string, { x: number; y: number }> = {
  'agent-interface-systems': { x: 18, y: 28 },
  'skill-accessible-interface': { x: 33, y: 17 },
  'skill-contract-first-ui': { x: 38, y: 48 },
  'agent-backend-orchestration': { x: 60, y: 34 },
  'skill-service-contract': { x: 75, y: 19 },
  'skill-event-replay': { x: 76, y: 53 },
  'agent-verification-review': { x: 46, y: 76 },
  'skill-accessibility-review': { x: 25, y: 70 },
  'system-repository-assessment': { x: 67, y: 78 },
  'system-live-provider': { x: 88, y: 79 },
};

function positionFor(capability: Capability, index: number) {
  return (
    positions[capability.id] ?? {
      x: 15 + ((index * 19) % 70),
      y: 18 + ((index * 23) % 66),
    }
  );
}

export function CapabilityInspector({
  capability,
}: {
  capability: Capability;
}) {
  return (
    <aside
      className={`capability-inspector category-${capability.category}`}
      aria-label="Selected capability inspector"
    >
      <div className="inspector-rail" aria-hidden="true" />
      <header>
        <div>
          <p className="eyebrow">Selected {capability.kind}</p>
          <h2>{capability.name}</h2>
        </div>
        <span
          className={`availability availability-${capability.availability}`}
        >
          {capability.availability}
        </span>
      </header>
      <p className="inspector-lede">{capability.description}</p>
      <dl className="answer-list">
        <div>
          <dt>Category</dt>
          <dd>{capability.category}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{capability.source}</dd>
        </div>
        <div>
          <dt>Trust</dt>
          <dd>{capability.trust}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{capability.runtime}</dd>
        </div>
      </dl>
      <section className="inspector-section">
        <h3>Relationship state</h3>
        <p className="empty-copy">
          {capability.relatedTo.length
            ? `${capability.relatedTo.length} fixture relationship${capability.relatedTo.length === 1 ? '' : 's'} plotted.`
            : 'No relationship is asserted for this unavailable boundary.'}
        </p>
      </section>
      <p className="fixture-disclaimer">
        Schema-validated fixture metadata · no usage history fabricated
      </p>
    </aside>
  );
}

export function CapabilityAtlas({
  capabilities,
}: {
  capabilities: WorkspaceFixture['capabilities'];
}) {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [kind, setKind] = useState<CapabilityFilter>('all');
  const [state, setState] = useState<Capability['availability'] | 'all'>('all');
  const [selectedId, setSelectedId] = useState(capabilities[0]?.id ?? '');
  const visible = useMemo(
    () => filterCapabilities(capabilities, kind, state),
    [capabilities, kind, state],
  );
  const selected =
    capabilities.find((item) => item.id === selectedId) ??
    visible[0] ??
    capabilities[0];
  if (!selected) return null;

  const visibleIds = new Set(visible.map((item) => item.id));
  const edges = visible.flatMap((capability) =>
    capability.relatedTo
      .filter(
        (relatedId) => visibleIds.has(relatedId) && capability.id < relatedId,
      )
      .map((relatedId) => ({ from: capability.id, to: relatedId })),
  );

  return (
    <section className="surface atlas-surface" aria-labelledby="atlas-title">
      <header className="surface-heading atlas-heading">
        <div>
          <p className="eyebrow">Capabilities / agent and skill atlas</p>
          <h1 id="atlas-title">
            The capability field, with its quiet parts intact.
          </h1>
          <p>
            Active, recommended, dormant, and unavailable remain visible without
            pretending to be execution history.
          </p>
        </div>
        <span className="truth-badge">Fixture capability map</span>
      </header>
      <div className="surface-toolbar atlas-toolbar">
        <div className="segmented" aria-label="Atlas content filter">
          {(['all', 'agents', 'skills'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={kind === filter}
              onClick={() => setKind(filter)}
            >
              {filter === 'all'
                ? 'All'
                : filter[0]?.toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <label className="select-control">
          State
          <select
            value={state}
            onChange={(event) =>
              setState(event.target.value as Capability['availability'] | 'all')
            }
          >
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="recommended">Recommended</option>
            <option value="dormant">Dormant</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <div className="segmented" aria-label="Atlas view">
          <button
            type="button"
            aria-pressed={view === 'graph'}
            onClick={() => setView('graph')}
          >
            Graph
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>
      <div className="workspace-with-inspector atlas-workspace">
        <div className="workspace-canvas atlas-canvas">
          {view === 'graph' ? (
            <div
              className="capability-plot"
              aria-label="Capability relationship graph"
            >
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {edges.map((edge) => {
                  const from = positions[edge.from] ?? { x: 0, y: 0 };
                  const to = positions[edge.to] ?? { x: 0, y: 0 };
                  return (
                    <line
                      key={`${edge.from}-${edge.to}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                    />
                  );
                })}
              </svg>
              {visible.map((capability, index) => {
                const position = positionFor(capability, index);
                return (
                  <button
                    type="button"
                    key={capability.id}
                    className={`capability-node category-${capability.category} availability-${capability.availability} ${selected.id === capability.id ? 'is-selected' : ''}`}
                    style={
                      {
                        '--x': `${position.x}%`,
                        '--y': `${position.y}%`,
                      } as CSSProperties
                    }
                    aria-pressed={selected.id === capability.id}
                    aria-label={`${capability.name}, ${capability.kind}, ${capability.availability}`}
                    onClick={() => setSelectedId(capability.id)}
                  >
                    <span className="capability-dot" aria-hidden="true" />
                    <span>
                      <strong>{capability.name}</strong>
                      <small>
                        {capability.kind} · {capability.availability}
                      </small>
                    </span>
                  </button>
                );
              })}
              {!visible.length ? (
                <p className="plot-empty">
                  No capabilities match these filters.
                </p>
              ) : null}
              <div
                className="atlas-legend"
                aria-label="Capability status legend"
              >
                <span>
                  <i className="legend-active" /> active
                </span>
                <span>
                  <i className="legend-recommended" /> recommended
                </span>
                <span>
                  <i className="legend-dormant" /> dormant
                </span>
                <span>
                  <i className="legend-unavailable" /> unavailable
                </span>
              </div>
            </div>
          ) : (
            <ul className="capability-table" aria-label="Capability list">
              {visible.map((capability) => (
                <li key={capability.id}>
                  <button
                    type="button"
                    className={`category-${capability.category} availability-${capability.availability} ${selected.id === capability.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedId(capability.id)}
                  >
                    <span className="capability-dot" aria-hidden="true" />
                    <span>
                      <strong>{capability.name}</strong>
                      <small>{capability.description}</small>
                    </span>
                    <span>{capability.kind}</span>
                    <span>{capability.availability}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <CapabilityInspector capability={selected} />
      </div>
    </section>
  );
}
