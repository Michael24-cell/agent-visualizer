import { useEffect, useState, type FormEvent } from 'react';
import type { RuntimeSettings } from '@harness/contracts';
import { listRuntimeModels, readRuntime, updateRuntime } from './api';

// Where agents run, in one panel: simulated, Claude (needs the key in the
// shell), or any OpenAI-compatible endpoint. Changes apply at once and are
// saved for next start. The key is written, never read back.

const PRESETS = [
  {
    id: 'groq',
    label: 'Groq (free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    tools: 'full' as const,
    needsKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama on this Mac',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:7b',
    tools: 'basic' as const,
    needsKey: false,
  },
];

export function RuntimeSetup({
  onSaved,
  onClose,
}: {
  onSaved: (settings: RuntimeSettings) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<RuntimeSettings>();
  const [kind, setKind] = useState<RuntimeSettings['kind']>('simulated');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [tools, setTools] = useState<'basic' | 'full'>('full');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void readRuntime()
      .then((current) => {
        if (!active) return;
        setSettings(current);
        setKind(current.kind);
        setBaseUrl(current.baseUrl ?? '');
        setModel(current.model ?? '');
        setTools(current.tools ?? 'full');
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not read.');
      });
    return () => {
      active = false;
    };
  }, []);

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((candidate) => candidate.id === id);
    if (!preset) return;
    setKind('openai');
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setTools(preset.tools);
    setModels(undefined);
  };

  const loadModels = async () => {
    try {
      setModels(await listRuntimeModels());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not list models.',
      );
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const next = await updateRuntime({
        kind,
        ...(kind === 'openai'
          ? {
              baseUrl,
              model,
              tools,
              ...(apiKey ? { apiKey } : {}),
            }
          : {}),
      });
      setSettings(next);
      setApiKey('');
      onSaved(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Not saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="setup" onSubmit={(event) => void save(event)}>
      <header className="setup-head">
        <strong>Where agents run</strong>
        <button
          type="button"
          className="pane-close"
          aria-label="Close setup"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="setup-choices" role="radiogroup" aria-label="Runtime">
        <label className={kind === 'simulated' ? 'is-on' : ''}>
          <input
            type="radio"
            name="kind"
            checked={kind === 'simulated'}
            onChange={() => setKind('simulated')}
          />
          <span>Simulated</span>
          <small>No model. Scripted agents to try the flow.</small>
        </label>
        <label className={kind === 'openai' ? 'is-on' : ''}>
          <input
            type="radio"
            name="kind"
            checked={kind === 'openai'}
            onChange={() => setKind('openai')}
          />
          <span>Open model</span>
          <small>Groq free tier, Ollama, or any OpenAI-compatible API.</small>
        </label>
        <label
          className={`${kind === 'claude' ? 'is-on' : ''} ${settings && !settings.claudeKeyPresent ? 'is-off' : ''}`}
        >
          <input
            type="radio"
            name="kind"
            checked={kind === 'claude'}
            disabled={settings ? !settings.claudeKeyPresent : true}
            onChange={() => setKind('claude')}
          />
          <span>Claude</span>
          <small>
            {settings?.claudeKeyPresent
              ? 'Claude Agent SDK with your key.'
              : 'Export ANTHROPIC_API_KEY in the shell that starts the app, then restart.'}
          </small>
        </label>
      </div>

      {kind === 'openai' ? (
        <div className="setup-fields">
          <div className="setup-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="secondary-action small"
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label>
            <span>Endpoint</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.groq.com/openai/v1"
              spellCheck={false}
            />
          </label>
          <label>
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                settings?.keyPresent
                  ? '•••••••• (set; leave blank to keep)'
                  : 'paste a key'
              }
              autoComplete="off"
            />
          </label>
          <label>
            <span>Model</span>
            <span className="setup-model">
              <input
                value={model}
                list="runtime-models"
                onChange={(event) => setModel(event.target.value)}
                placeholder="openai/gpt-oss-120b"
                spellCheck={false}
              />
              <button
                type="button"
                className="secondary-action small"
                onClick={() => void loadModels()}
                title="List the models this endpoint offers (uses the saved key)"
              >
                List
              </button>
            </span>
            {models ? (
              <datalist id="runtime-models">
                {models.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            ) : null}
          </label>
          <label className="setup-inline">
            <input
              type="checkbox"
              checked={tools === 'full'}
              onChange={(event) =>
                setTools(event.target.checked ? 'full' : 'basic')
              }
            />
            <span>
              Allow search-and-replace edits{' '}
              <small>(off for small local models: they corrupt files)</small>
            </span>
          </label>
        </div>
      ) : null}

      {error ? <p className="setup-error">{error}</p> : null}
      <footer className="setup-foot">
        <span className="doc-hint">
          {settings?.envFile
            ? 'Applies now and is saved to .env.local for next time.'
            : 'Applies now; set the same in your environment to keep it.'}
        </span>
        <button type="submit" className="primary-action small" disabled={busy}>
          Use this
        </button>
      </footer>
    </form>
  );
}
