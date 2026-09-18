import { useEffect, useState } from 'react';
import {
  FoundationStatusSchema,
  ServiceHealthSchema,
  type FoundationStatus,
  type ServiceHealth,
} from '@harness/contracts';

type ConnectionState =
  | { phase: 'loading' }
  | { phase: 'ready'; health: ServiceHealth; foundation: FoundationStatus }
  | { phase: 'error'; message: string };

const futureNavigation = ['Methodologies', 'Plan', 'Run', 'Review', 'History'];

async function readFoundationState(): Promise<ConnectionState> {
  try {
    const [healthResponse, foundationResponse] = await Promise.all([
      fetch('/api/health'),
      fetch('/api/foundation'),
    ]);

    if (!healthResponse.ok || !foundationResponse.ok) {
      throw new Error('The local service returned an unexpected response.');
    }

    const health = ServiceHealthSchema.parse(await healthResponse.json());
    const foundation = FoundationStatusSchema.parse(
      await foundationResponse.json(),
    );
    return { phase: 'ready', health, foundation };
  } catch (error) {
    return {
      phase: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'The local service is unavailable.',
    };
  }
}

function FoundationMap({ connection }: { connection: ConnectionState }) {
  const ready = connection.phase === 'ready';

  return (
    <div className="map-wrap">
      <svg
        className="foundation-map"
        viewBox="0 0 760 410"
        role="img"
        aria-labelledby="map-title map-description"
      >
        <title id="map-title">Repository foundation topology</title>
        <desc id="map-description">
          The client connects to a loopback service, which owns configuration
          and a local SQLite database.
        </desc>
        <defs>
          <linearGradient id="edge-active" x1="0" x2="1">
            <stop offset="0" stopColor="#80d7ff" stopOpacity="0.18" />
            <stop offset="0.5" stopColor="#80d7ff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#91dfb7" stopOpacity="0.2" />
          </linearGradient>
          <filter id="soft-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        <path className="map-edge" d="M 170 205 C 250 205, 260 115, 355 115" />
        <path className="map-edge" d="M 170 205 C 250 205, 260 295, 355 295" />
        <path
          className={ready ? 'map-edge map-edge--ready' : 'map-edge'}
          d="M 445 115 C 535 115, 530 205, 620 205"
        />
        <path
          className={ready ? 'map-edge map-edge--ready' : 'map-edge'}
          d="M 445 295 C 535 295, 530 205, 620 205"
        />

        {ready ? (
          <circle className="map-glow" cx="620" cy="205" r="34" />
        ) : null}

        <g
          className="map-node map-node--interface"
          transform="translate(120 205)"
        >
          <circle r="30" />
          <circle className="map-node-core" r="7" />
          <text x="0" y="57" textAnchor="middle">
            Client
          </text>
          <text className="map-node-meta" x="0" y="76" textAnchor="middle">
            INTERFACE
          </text>
        </g>
        <g
          className="map-node map-node--neutral"
          transform="translate(400 115)"
        >
          <circle r="30" />
          <circle className="map-node-core" r="7" />
          <text x="0" y="57" textAnchor="middle">
            Contracts
          </text>
          <text className="map-node-meta" x="0" y="76" textAnchor="middle">
            BOUNDARY
          </text>
        </g>
        <g
          className="map-node map-node--verification"
          transform="translate(400 295)"
        >
          <circle r="30" />
          <circle className="map-node-core" r="7" />
          <text x="0" y="57" textAnchor="middle">
            Configuration
          </text>
          <text className="map-node-meta" x="0" y="76" textAnchor="middle">
            VALIDATED
          </text>
        </g>
        <g
          className={`map-node map-node--system ${ready ? 'map-node--active' : ''}`}
          transform="translate(640 205)"
        >
          <circle r="34" />
          <circle className="map-node-core" r="8" />
          <text x="0" y="62" textAnchor="middle">
            Local service
          </text>
          <text className="map-node-meta" x="0" y="81" textAnchor="middle">
            {ready ? 'READY' : 'CONNECTING'}
          </text>
        </g>
      </svg>

      <ol
        className="map-alternative"
        aria-label="Repository foundation topology list"
      >
        <li>
          <span className="legend-dot legend-dot--blue" /> Client — interface
        </li>
        <li>
          <span className="legend-dot legend-dot--neutral" /> Contracts — shared
          boundary
        </li>
        <li>
          <span className="legend-dot legend-dot--pink" /> Configuration —
          validated input
        </li>
        <li>
          <span className="legend-dot legend-dot--green" /> Local service —{' '}
          {ready ? 'ready' : 'connecting'}
        </li>
      </ol>
    </div>
  );
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    phase: 'loading',
  });

  useEffect(() => {
    let active = true;
    void readFoundationState().then((state) => {
      if (active) {
        setConnection(state);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const reconnect = () => {
    setConnection({ phase: 'loading' });
    void readFoundationState().then(setConnection);
  };

  const ready = connection.phase === 'ready';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Visual Agent Harness home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Harness</span>
        </a>
        <nav aria-label="Primary navigation">
          <a
            className="nav-item nav-item--active"
            href="#foundation"
            aria-current="page"
          >
            Project
          </a>
          {futureNavigation.map((item) => (
            <span
              className="nav-item nav-item--dormant"
              key={item}
              aria-disabled="true"
            >
              {item}
            </span>
          ))}
        </nav>
        <div className="local-badge">
          <span /> Local only
        </div>
      </header>

      <main id="top">
        <section className="hero" id="foundation">
          <div className="hero-copy">
            <p className="eyebrow">Repository foundation · Increment 0</p>
            <h1>One quiet place to see how agent work fits together.</h1>
            <p className="lede">
              The local control plane is wired, validated, and durable. Planning
              and execution will grow from these boundaries without turning the
              product into a wall of chats.
            </p>
          </div>

          <div className="foundation-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">Live foundation</p>
                <h2>Local system topology</h2>
              </div>
              <div
                className={`connection-pill connection-pill--${connection.phase}`}
                aria-live="polite"
              >
                <span aria-hidden="true" />
                {ready
                  ? 'Connected'
                  : connection.phase === 'error'
                    ? 'Needs attention'
                    : 'Connecting'}
              </div>
            </div>

            <FoundationMap connection={connection} />

            <div className="evidence-row">
              <div>
                <span className="evidence-kicker">Application boundary</span>
                <strong>Loopback only</strong>
              </div>
              <div>
                <span className="evidence-kicker">Persistence</span>
                <strong>
                  {ready
                    ? `${connection.foundation.migrationCount} migration applied`
                    : 'Checking SQLite'}
                </strong>
              </div>
              <div>
                <span className="evidence-kicker">Stored record</span>
                <strong>
                  {ready
                    ? connection.foundation.record.value
                    : 'Awaiting evidence'}
                </strong>
              </div>
              <div>
                <span className="evidence-kicker">Verification</span>
                <strong>{ready ? 'Schema checked' : 'Pending'}</strong>
              </div>
            </div>

            {connection.phase === 'error' ? (
              <div className="error-notice" role="alert">
                <div>
                  <strong>Local service not reached</strong>
                  <p>
                    {connection.message} Start both processes with{' '}
                    <code>npm run dev</code>.
                  </p>
                </div>
                <button type="button" onClick={reconnect}>
                  Retry connection
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="principles" aria-labelledby="principles-title">
          <div>
            <p className="section-label">Protected from day one</p>
            <h2 id="principles-title">
              The foundation has opinions where safety needs them.
            </h2>
          </div>
          <div className="principle-list">
            <article>
              <span className="principle-index">A</span>
              <div>
                <h3>Local by default</h3>
                <p>
                  The service binds to loopback and stores state outside the
                  repository.
                </p>
              </div>
            </article>
            <article>
              <span className="principle-index principle-index--blue">B</span>
              <div>
                <h3>Boundaries before providers</h3>
                <p>
                  Shared contracts stay neutral so no runtime can define the
                  core product.
                </p>
              </div>
            </article>
            <article>
              <span className="principle-index principle-index--pink">C</span>
              <div>
                <h3>Evidence over assertion</h3>
                <p>
                  The visible status comes from validated service and database
                  responses.
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>

      <footer>
        <span>Visual Agent Harness</span>
        <span>Private local prototype · No provider connected</span>
      </footer>
    </div>
  );
}
