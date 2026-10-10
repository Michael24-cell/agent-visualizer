import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RuntimeSettings } from '@harness/contracts';
import {
  listChatGptModels,
  listRuntimeModels,
  readChatGpt,
  readRuntime,
  signOutChatGpt,
  startChatGptSignIn,
  updateRuntime,
} from './api';

// Where agents run, in one panel: simulated, your ChatGPT plan, Claude
// (needs the key in the shell), or any OpenAI-compatible endpoint. Changes
// apply at once and are saved for next start. Keys and tokens are written
// or held by the service, never read back.

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
  const [planModels, setPlanModels] =
    useState<{ slug: string; displayName: string }[]>();
  const [waiting, setWaiting] = useState(false);
  const polling = useRef<number | undefined>(undefined);
  const chatgpt = settings?.chatgpt;

  useEffect(() => () => window.clearInterval(polling.current), []);

  // The plan's models, once signed in.
  useEffect(() => {
    if (kind !== 'chatgpt' || !chatgpt?.signedIn || planModels) return;
    let active = true;
    void listChatGptModels()
      .then((list) => {
        if (active) setPlanModels(list);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'Could not list models.',
          );
      });
    return () => {
      active = false;
    };
  }, [kind, chatgpt?.signedIn, planModels]);

  // Open the tab inside the click so it is not blocked as a popup, then
  // point it at OpenAI once the service has the address ready. Poll until
  // the browser comes back to the service's 127.0.0.1 listener.
  const signIn = async () => {
    setError(undefined);
    const tab = window.open('', '_blank');
    try {
      const url = await startChatGptSignIn();
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
      setWaiting(true);
      window.clearInterval(polling.current);
      polling.current = window.setInterval(() => {
        void readChatGpt().then((status) => {
          setSettings((current) =>
            current
              ? { ...current, chatgpt: { ...current.chatgpt, ...status } }
              : current,
          );
          if (status.pending) return;
          window.clearInterval(polling.current);
          setWaiting(false);
          if (status.error) setError(status.error);
        });
      }, 1500);
    } catch (cause) {
      tab?.close();
      setError(
        cause instanceof Error ? cause.message : 'Sign-in did not start.',
      );
    }
  };

  const signOut = async () => {
    try {
      const next = await signOutChatGpt();
      setSettings(next);
      setPlanModels(undefined);
      if (next.kind !== kind) onSaved(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Not signed out.');
    }
  };

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
        if (current.kind === 'chatgpt') setModel(current.chatgpt.model);
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
        ...(kind === 'chatgpt'
          ? { model: model || (chatgpt?.model ?? '') }
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
        <label className={kind === 'chatgpt' ? 'is-on' : ''}>
          <input
            type="radio"
            name="kind"
            checked={kind === 'chatgpt'}
            onChange={() => {
              setKind('chatgpt');
              setModel(chatgpt?.model ?? '');
            }}
          />
          <span>ChatGPT plan</span>
          <small>
            {chatgpt?.signedIn
              ? `Signed in${chatgpt.email ? ` as ${chatgpt.email}` : ''}. No API key.`
              : 'Use your ChatGPT plan. Sign in once; no API key.'}
          </small>
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

      {kind === 'chatgpt' ? (
        <div className="setup-fields">
          {chatgpt?.signedIn ? (
            <>
              <p className="setup-account">
                Signed in{chatgpt.email ? ` as ${chatgpt.email}` : ''}.{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </p>
              <label>
                <span>Model</span>
                <select
                  value={model || chatgpt.model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {[
                    ...new Set([
                      model || chatgpt.model,
                      ...(planModels ?? []).map((entry) => entry.slug),
                    ]),
                  ].map((slug) => (
                    <option key={slug} value={slug}>
                      {planModels?.find((entry) => entry.slug === slug)
                        ?.displayName ?? slug}
                    </option>
                  ))}
                </select>
              </label>
              <p className="doc-hint">
                Requests count against your plan&apos;s usage — the same
                allowance ChatGPT shows as 5-hour and weekly limits. You can cap
                this app in ChatGPT settings.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary-action small"
                disabled={waiting}
                onClick={() => void signIn()}
              >
                {waiting ? 'Waiting for ChatGPT…' : 'Sign in with ChatGPT'}
              </button>
              <p className="doc-hint">
                {waiting
                  ? 'Finish signing in on the tab that opened, then come back here.'
                  : 'Opens ChatGPT in a new tab. Allow plan usage when asked. Tokens stay on this machine.'}
              </p>
            </>
          )}
        </div>
      ) : null}

      {error ? <p className="setup-error">{error}</p> : null}
      <footer className="setup-foot">
        <span className="doc-hint">
          {settings?.envFile
            ? 'Applies now and is saved to .env.local for next time.'
            : 'Applies now; set the same in your environment to keep it.'}
        </span>
        <button
          type="submit"
          className="primary-action small"
          disabled={busy || (kind === 'chatgpt' && !chatgpt?.signedIn)}
        >
          Use this
        </button>
      </footer>
    </form>
  );
}
