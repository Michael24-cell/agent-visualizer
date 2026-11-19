import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RuntimeSettings, RuntimeUpdate } from '@harness/contracts';
import {
  listChatGptModels,
  listRuntimeModels,
  readChatGpt,
  readRuntime,
  signOutChatGpt,
  startChatGptSignIn,
  updateRuntime,
} from './api';

// One question: which account should agents use? Three answers that take
// one click each — your ChatGPT plan, a Claude key, or practice agents
// with no account — and, folded away, any other OpenAI-compatible model.
// Keys and tokens are held by the service, never read back.

const PRESETS = [
  {
    id: 'groq',
    label: 'Groq (free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    tools: 'full' as const,
  },
  {
    id: 'ollama',
    label: 'Ollama on this computer',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:7b',
    tools: 'basic' as const,
  },
];

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function AccountChoice({
  onSaved,
  onClose,
}: {
  onSaved: (settings: RuntimeSettings) => void;
  onClose?: (() => void) | undefined;
}) {
  const [settings, setSettings] = useState<RuntimeSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const [planModels, setPlanModels] =
    useState<{ slug: string; displayName: string }[]>();
  const [other, setOther] = useState(false);
  const polling = useRef<number | undefined>(undefined);
  const chatgpt = settings?.chatgpt;
  const kind = settings?.kind;

  useEffect(() => () => window.clearInterval(polling.current), []);

  useEffect(() => {
    let active = true;
    void readRuntime()
      .then((current) => {
        if (!active) return;
        setSettings(current);
        if (current.kind === 'openai') setOther(true);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause, 'Could not read the settings.'));
      });
    return () => {
      active = false;
    };
  }, []);

  // The plan's models, once signed in.
  useEffect(() => {
    if (!chatgpt?.signedIn || planModels) return;
    let active = true;
    void listChatGptModels()
      .then((list) => {
        if (active) setPlanModels(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [chatgpt?.signedIn, planModels]);

  const choose = async (update: RuntimeUpdate) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await updateRuntime(update);
      setSettings(next);
      onSaved(next);
    } catch (cause) {
      setError(message(cause, 'That did not save.'));
    } finally {
      setBusy(false);
    }
  };

  // Open the tab inside the click so it is not blocked as a popup, then
  // point it at OpenAI once the service has the address ready. When the
  // sign-in lands, switch to the plan without another click.
  const signIn = async () => {
    setError(undefined);
    const planModel = chatgpt?.model;
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
          else if (status.signedIn) {
            void choose({
              kind: 'chatgpt',
              ...(planModel ? { model: planModel } : {}),
            });
          }
        });
      }, 1500);
    } catch (cause) {
      tab?.close();
      setError(message(cause, 'Sign-in did not start.'));
    }
  };

  const signOut = async () => {
    try {
      const next = await signOutChatGpt();
      setSettings(next);
      setPlanModels(undefined);
      onSaved(next);
    } catch (cause) {
      setError(message(cause, 'Not signed out.'));
    }
  };

  return (
    <section className="account" aria-label="Which account should agents use?">
      <header className="account-head">
        <h2>Which account should agents use?</h2>
        {onClose ? (
          <button
            type="button"
            className="pane-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </header>

      <div className="account-cards">
        <article
          className={`account-card ${kind === 'chatgpt' ? 'is-on' : ''}`}
        >
          <h3>
            Your ChatGPT plan
            {kind === 'chatgpt' ? <em>In use</em> : null}
          </h3>
          <p>
            {chatgpt?.signedIn
              ? `Signed in${chatgpt.email ? ` as ${chatgpt.email}` : ''}. Uses your plan's allowance, no API key.`
              : 'Uses the plan you already pay for. Sign in once; no API key.'}
          </p>
          {chatgpt?.signedIn ? (
            <div className="account-actions">
              {kind === 'chatgpt' ? (
                <select
                  aria-label="ChatGPT model"
                  value={chatgpt.model}
                  disabled={busy}
                  onChange={(event) =>
                    void choose({ kind: 'chatgpt', model: event.target.value })
                  }
                >
                  {[
                    ...new Set([
                      chatgpt.model,
                      ...(planModels ?? []).map((entry) => entry.slug),
                    ]),
                  ].map((slug) => (
                    <option key={slug} value={slug}>
                      {planModels?.find((entry) => entry.slug === slug)
                        ?.displayName ?? slug}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="primary-action small"
                  disabled={busy}
                  onClick={() =>
                    void choose({ kind: 'chatgpt', model: chatgpt.model })
                  }
                >
                  Use ChatGPT
                </button>
              )}
              <button
                type="button"
                className="link-button"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="account-actions">
              <button
                type="button"
                className="primary-action small"
                disabled={waiting || busy}
                onClick={() => void signIn()}
              >
                {waiting ? 'Waiting for ChatGPT…' : 'Sign in with ChatGPT'}
              </button>
              {waiting ? (
                <small>Finish on the tab that opened, then come back.</small>
              ) : null}
            </div>
          )}
        </article>

        <article
          className={`account-card ${kind === 'claude' ? 'is-on' : ''} ${settings && !settings.claudeKeyPresent ? 'is-off' : ''}`}
        >
          <h3>
            A Claude key
            {kind === 'claude' ? <em>In use</em> : null}
          </h3>
          <p>
            {settings?.claudeKeyPresent
              ? 'Your Anthropic API key is set. Billed per use by Anthropic.'
              : 'Add ANTHROPIC_API_KEY to .env.local in the app folder, then restart the app.'}
          </p>
          {settings?.claudeKeyPresent && kind !== 'claude' ? (
            <div className="account-actions">
              <button
                type="button"
                className="primary-action small"
                disabled={busy}
                onClick={() => void choose({ kind: 'claude' })}
              >
                Use Claude
              </button>
            </div>
          ) : null}
        </article>

        <article
          className={`account-card ${kind === 'simulated' ? 'is-on' : ''}`}
        >
          <h3>
            No account
            {kind === 'simulated' ? <em>In use</em> : null}
          </h3>
          <p>
            Practice agents that follow a script, so you can learn the app
            before connecting a model. Free.
          </p>
          {kind !== 'simulated' ? (
            <div className="account-actions">
              <button
                type="button"
                className="secondary-action small"
                disabled={busy}
                onClick={() => void choose({ kind: 'simulated' })}
              >
                Use practice agents
              </button>
            </div>
          ) : null}
        </article>
      </div>

      <details
        className="account-other"
        open={other}
        onToggle={(event) => setOther(event.currentTarget.open)}
      >
        <summary>
          Another model — Groq, Ollama, or any OpenAI-compatible API
          {kind === 'openai' ? <em>In use</em> : null}
        </summary>
        {other && settings ? (
          <EndpointForm settings={settings} busy={busy} onUse={choose} />
        ) : null}
      </details>

      {error ? (
        <p className="setup-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="doc-hint">
        {settings?.envFile
          ? 'Your choice is saved for next time.'
          : 'Applies until the app restarts.'}
      </p>
    </section>
  );
}

function EndpointForm({
  settings,
  busy,
  onUse,
}: {
  settings: RuntimeSettings;
  busy: boolean;
  onUse: (update: RuntimeUpdate) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '');
  const [model, setModel] = useState(settings.model ?? '');
  const [tools, setTools] = useState<'basic' | 'full'>(
    settings.tools ?? 'full',
  );
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>();
  const [error, setError] = useState<string>();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await onUse({
      kind: 'openai',
      baseUrl,
      model,
      tools,
      ...(apiKey ? { apiKey } : {}),
    });
    setApiKey('');
  };

  return (
    <form className="setup-fields" onSubmit={(event) => void save(event)}>
      <div className="setup-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="secondary-action small"
            onClick={() => {
              setBaseUrl(preset.baseUrl);
              setModel(preset.model);
              setTools(preset.tools);
              setModels(undefined);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label>
        <span>Address</span>
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
            settings.keyPresent
              ? '•••••••• (saved; leave blank to keep)'
              : 'paste a key, if it needs one'
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
            onClick={() =>
              void listRuntimeModels()
                .then(setModels)
                .catch((cause: unknown) =>
                  setError(message(cause, 'Could not list models.')),
                )
            }
            title="List the models this address offers (uses the saved key)"
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
          Let it edit parts of files{' '}
          <small>(turn off for small local models — they damage files)</small>
        </span>
      </label>
      {error ? <p className="setup-error">{error}</p> : null}
      <div className="account-actions">
        <button
          type="submit"
          className="primary-action small"
          disabled={busy || !baseUrl.trim() || !model.trim()}
        >
          Use this model
        </button>
      </div>
    </form>
  );
}
