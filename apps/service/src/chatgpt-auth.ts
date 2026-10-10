import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type JsonWebKeyInput,
} from 'node:crypto';
import { readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

type JsonWebKey = JsonWebKeyInput['key'];

// Sign in with ChatGPT, for plan usage in a personal local app. Follows
// OpenAI's token-sharing spec for open-source and local clients:
// dynamic registration on first sign-in, PKCE, a 127.0.0.1 loopback
// callback, ID token verified against OpenAI's published keys, and
// credentials kept in one owner-only file. Tokens never leave the service.

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const AGENT_NAME = 'Visual Agent Harness';
const CALLBACK_PATH = '/auth/callback';
const PREFERRED_PORT = 1455;
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
// Refresh a little before expiry so a long request does not start on a
// token that dies mid-flight.
const REFRESH_MARGIN_MS = 2 * 60_000;

// Refresh failures that mean the connection is over, not a blip.
const FATAL_REFRESH_CODES = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

interface StoredChatGpt {
  // Opaque per-machine id the spec requires before the first sign-in.
  readonly hostId: string;
  readonly clientId?: string;
  readonly subject?: string;
  readonly email?: string;
  readonly idToken?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly scopes?: readonly string[];
}

interface PendingSignIn {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly clientId: string | undefined;
  readonly server: Server;
  readonly timer: NodeJS.Timeout;
}

export interface ChatGptAuthOptions {
  readonly dataDirectory: string;
  readonly fetch?: typeof fetch;
  // Tests pass 0 for any free port.
  readonly port?: number;
}

export class ChatGptAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ChatGptAuthError';
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodePart(part: string | undefined): Record<string, unknown> {
  if (!part) throw new Error('malformed token');
  const value: unknown = JSON.parse(
    Buffer.from(part, 'base64url').toString('utf8'),
  );
  if (!value || typeof value !== 'object') throw new Error('malformed token');
  return value as Record<string, unknown>;
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px system-ui;margin:15vh auto;max-width:28rem;padding:0 1rem">` +
  `<h1 style="font-size:20px">${title}</h1><p>${body}</p>` +
  // Drop the code from the address bar and history.
  `<script>history.replaceState(null,"","/auth/complete")</script>`;

export class ChatGptAuth {
  private readonly file: string;
  private readonly fetch: typeof fetch;
  private stored: StoredChatGpt;
  private pending: PendingSignIn | undefined;
  private lastError: string | undefined;
  private refreshing: Promise<string> | undefined;
  private keys:
    { readonly at: number; readonly keys: JsonWebKey[] } | undefined;

  constructor(private readonly options: ChatGptAuthOptions) {
    this.file = join(options.dataDirectory, 'chatgpt.json');
    this.fetch = options.fetch ?? fetch;
    this.stored = this.load();
  }

  status(): {
    signedIn: boolean;
    email?: string;
    pending: boolean;
    error?: string;
  } {
    return {
      signedIn: this.signedIn,
      ...(this.signedIn && this.stored.email
        ? { email: this.stored.email }
        : {}),
      pending: Boolean(this.pending),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  get signedIn(): boolean {
    return Boolean(
      this.stored.accessToken &&
      this.stored.refreshToken &&
      this.stored.scopes?.includes(PLAN_SCOPE),
    );
  }

  // Starts a sign-in: listener first, then the URL the browser opens.
  async startSignIn(): Promise<string> {
    this.cancelPending();
    this.lastError = undefined;
    const state = base64url(randomBytes(24));
    const nonce = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const server = createServer((request, response) => {
      void this.callback(request.url ?? '', response);
    });
    const port = await this.listen(server);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const clientId = this.stored.clientId;
    const timer = setTimeout(() => {
      this.lastError = 'Sign-in timed out. Start it again when you are ready.';
      this.cancelPending();
    }, SIGN_IN_TIMEOUT_MS);
    timer.unref();
    this.pending = {
      state,
      nonce,
      verifier,
      redirectUri,
      clientId,
      server,
      timer,
    };
    const params = new URLSearchParams({
      client_id: clientId ?? 'dynamic_agent_client',
      ...(clientId ? {} : { agent_name_hint: AGENT_NAME }),
      ext_agent_host_id: this.stored.hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: CHATGPT_RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      ...(clientId && this.stored.idToken
        ? { id_token_hint: this.stored.idToken }
        : {}),
      ...(clientId && this.stored.email
        ? { login_hint: this.stored.email }
        : {}),
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  // A bearer token for the next request, refreshed when close to expiry.
  // Concurrent callers share one refresh, since refresh tokens rotate.
  async accessToken(): Promise<string> {
    const { accessToken, expiresAt } = this.stored;
    if (!this.signedIn || !accessToken) {
      throw new ChatGptAuthError(
        'Not signed in with ChatGPT. Sign in from the setup panel.',
        'signed_out',
      );
    }
    if (expiresAt && expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return accessToken;
    }
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  async signOut(): Promise<void> {
    this.cancelPending();
    const { refreshToken, clientId } = this.stored;
    // Revocation is best effort; forgetting the tokens is what matters.
    if (refreshToken && clientId) {
      try {
        const config = await this.discovery();
        if (config.revocation_endpoint) {
          await this.fetch(config.revocation_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: refreshToken,
              token_type_hint: 'refresh_token',
              client_id: clientId,
            }),
            signal: AbortSignal.timeout(10_000),
          });
        }
      } catch {
        // Offline or refused: the local credentials are still removed.
      }
    }
    this.lastError = undefined;
    // Keep the host id and the registration so the next sign-in reuses
    // them, as the spec asks.
    this.save({
      hostId: this.stored.hostId,
      ...(clientId ? { clientId } : {}),
    });
  }

  // Models this connection may use, as ChatGPT lists them.
  async listModels(): Promise<{ slug: string; displayName: string }[]> {
    const token = await this.accessToken();
    const response = await this.fetch(`${CHATGPT_RESOURCE}/models`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new ChatGptAuthError(
        `ChatGPT answered ${response.status} when listing models.`,
        'models_unavailable',
      );
    }
    const body = (await response.json()) as {
      models?: { slug?: string; display_name?: string; visibility?: string }[];
    };
    return (body.models ?? [])
      .filter((model) => model.visibility === 'list' && model.slug)
      .map((model) => ({
        slug: model.slug!,
        displayName: model.display_name ?? model.slug!,
      }));
  }

  close(): void {
    this.cancelPending();
  }

  // -------------------------------------------------------------------------

  private async callback(
    url: string,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const send = (status: number, title: string, body: string) => {
      response.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(PAGE(title, body));
    };
    const parsed = new URL(url, 'http://127.0.0.1');
    if (parsed.pathname !== CALLBACK_PATH) {
      send(404, 'Not found', 'This address only accepts the sign-in.');
      return;
    }
    const pending = this.pending;
    const state = parsed.searchParams.get('state') ?? '';
    // Anything without the state we sent is not our sign-in.
    if (!pending || !sameString(state, pending.state)) {
      send(
        400,
        'Sign-in not recognised',
        'Start the sign-in again from the harness.',
      );
      return;
    }
    const fail = (message: string) => {
      this.lastError = message;
      send(400, 'Sign-in did not finish', message);
      this.cancelPending();
    };
    if (parsed.searchParams.get('error')) {
      fail(
        parsed.searchParams.get('error') === 'access_denied'
          ? 'Sign-in was cancelled. You can try again when you are ready.'
          : `ChatGPT reported: ${parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error')}.`,
      );
      return;
    }
    const code = parsed.searchParams.get('code');
    const returned = parsed.searchParams.get('client_id') ?? undefined;
    const clientId = pending.clientId ?? returned;
    if (!code || !clientId) {
      fail('ChatGPT did not return a sign-in code. Try again.');
      return;
    }
    if (pending.clientId && returned && returned !== pending.clientId) {
      fail('ChatGPT returned a different registration. Try again.');
      return;
    }
    try {
      const data = await this.tokenRequest({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource: CHATGPT_RESOURCE,
      });
      const scopes = String(data.scope ?? '')
        .split(/\s+/)
        .filter(Boolean);
      if (!scopes.includes(PLAN_SCOPE)) {
        fail(
          'ChatGPT signed you in but did not grant plan usage. Allow it on the consent screen, or check that your plan includes it.',
        );
        return;
      }
      const identity = await this.verifyIdToken(
        String(data.id_token ?? ''),
        clientId,
        pending.nonce,
      );
      if (
        this.stored.subject &&
        this.stored.clientId === clientId &&
        identity.subject !== this.stored.subject
      ) {
        // A different account under the same registration: start clean.
        this.stored = { hostId: this.stored.hostId };
      }
      this.save({
        hostId: this.stored.hostId,
        clientId,
        subject: identity.subject,
        ...(identity.email ? { email: identity.email } : {}),
        idToken: String(data.id_token),
        ...this.credentialsFrom(data),
        scopes,
      });
      this.lastError = undefined;
      send(
        200,
        'Signed in to ChatGPT',
        'You can close this tab and go back to the harness.',
      );
      this.cancelPending();
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : 'The sign-in could not be completed. Try again.',
      );
    }
  }

  private async refresh(): Promise<string> {
    const { refreshToken, clientId } = this.stored;
    if (!refreshToken || !clientId) {
      throw new ChatGptAuthError(
        'Your ChatGPT connection has expired. Sign in again.',
        'signed_out',
      );
    }
    let data: Record<string, unknown>;
    try {
      data = await this.tokenRequest({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        resource: CHATGPT_RESOURCE,
      });
    } catch (error) {
      if (
        error instanceof ChatGptAuthError &&
        FATAL_REFRESH_CODES.has(error.code)
      ) {
        this.lastError = 'Your ChatGPT connection expired. Sign in again.';
        this.save({ hostId: this.stored.hostId, clientId });
      }
      throw error;
    }
    if (typeof data.id_token === 'string' && data.id_token) {
      const identity = await this.verifyIdToken(data.id_token, clientId);
      if (this.stored.subject && identity.subject !== this.stored.subject) {
        throw new ChatGptAuthError(
          'ChatGPT returned a different account on refresh. Sign in again.',
          'identity_changed',
        );
      }
    }
    const credentials = this.credentialsFrom(data);
    // OAuth may omit scope when it did not change.
    const scopes =
      typeof data.scope === 'string'
        ? data.scope.split(/\s+/).filter(Boolean)
        : this.stored.scopes;
    this.save({
      ...this.stored,
      ...credentials,
      ...(typeof data.id_token === 'string' && data.id_token
        ? { idToken: data.id_token }
        : {}),
      ...(scopes ? { scopes } : {}),
    });
    return credentials.accessToken;
  }

  private credentialsFrom(data: Record<string, unknown>): {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } {
    const { access_token, refresh_token, expires_in, token_type } = data;
    if (
      typeof access_token !== 'string' ||
      !access_token ||
      typeof refresh_token !== 'string' ||
      !refresh_token ||
      typeof expires_in !== 'number' ||
      expires_in <= 0 ||
      (typeof token_type === 'string' && token_type.toLowerCase() !== 'bearer')
    ) {
      throw new ChatGptAuthError(
        'ChatGPT returned incomplete credentials. Sign in again.',
        'invalid_token_response',
      );
    }
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
    };
  }

  private async tokenRequest(
    fields: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    const record =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    if (!response.ok) {
      const code =
        typeof record.error === 'string'
          ? record.error
          : typeof record.code === 'string'
            ? record.code
            : 'token_request_failed';
      throw new ChatGptAuthError(
        code === 'invalid_grant'
          ? 'That sign-in can no longer be used. Start it again.'
          : `ChatGPT refused the sign-in (${code}).`,
        code,
      );
    }
    return record;
  }

  // Signature against OpenAI's published keys, then issuer, audience,
  // expiry and (on first sign-in) the nonce we sent.
  private async verifyIdToken(
    token: string,
    clientId: string,
    nonce?: string,
  ): Promise<{ subject: string; email?: string }> {
    const invalid = () =>
      new ChatGptAuthError(
        'The ChatGPT identity could not be verified. Sign in again.',
        'invalid_id_token',
      );
    const [head, body, signature] = token.split('.');
    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = decodePart(head);
      payload = decodePart(body);
    } catch {
      throw invalid();
    }
    if (!signature) throw invalid();
    const alg = header.alg;
    if (alg !== 'RS256' && alg !== 'ES256') throw invalid();
    const jwk = await this.signingKey(String(header.kid ?? ''));
    if (!jwk) throw invalid();
    const ok = verify(
      'sha256',
      Buffer.from(`${head}.${body}`),
      alg === 'ES256'
        ? {
            key: createPublicKey({ key: jwk, format: 'jwk' }),
            dsaEncoding: 'ieee-p1363',
          }
        : createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(signature, 'base64url'),
    );
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Date.now() / 1000;
    if (
      !ok ||
      payload.iss !== ISSUER ||
      !audience.includes(clientId) ||
      typeof payload.exp !== 'number' ||
      payload.exp < now - 60 ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      typeof payload.sub !== 'string' ||
      !payload.sub
    ) {
      throw invalid();
    }
    return {
      subject: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    };
  }

  private async signingKey(kid: string): Promise<JsonWebKey | undefined> {
    const fresh = this.keys && Date.now() - this.keys.at < 60 * 60_000;
    const find = () =>
      this.keys?.keys.find((key) => (key as { kid?: string }).kid === kid);
    if (fresh && find()) return find();
    // Unknown kid or stale cache: keys rotate, so fetch once more.
    const config = await this.discovery();
    const response = await this.fetch(config.jwks_uri, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    this.keys = { at: Date.now(), keys: body.keys ?? [] };
    return find();
  }

  private async discovery(): Promise<{
    jwks_uri: string;
    revocation_endpoint?: string;
  }> {
    const response = await this.fetch(
      `${ISSUER}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const body = (await response.json()) as {
      jwks_uri?: string;
      revocation_endpoint?: string;
    };
    if (!response.ok || !body.jwks_uri?.startsWith(`${ISSUER}/`)) {
      throw new ChatGptAuthError(
        'ChatGPT sign-in keys are unavailable right now. Try again shortly.',
        'identity_verification_unavailable',
      );
    }
    return {
      jwks_uri: body.jwks_uri,
      ...(body.revocation_endpoint?.startsWith(`${ISSUER}/`)
        ? { revocation_endpoint: body.revocation_endpoint }
        : {}),
    };
  }

  private listen(server: Server): Promise<number> {
    const attempt = (port: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        // 127.0.0.1 only: the spec forbids localhost, and nothing else on
        // the network should reach this listener.
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    const preferred = this.options.port ?? PREFERRED_PORT;
    return attempt(preferred).catch(() => attempt(0));
  }

  private cancelPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.server.close();
    this.pending = undefined;
  }

  private load(): StoredChatGpt {
    try {
      const value = JSON.parse(
        readFileSync(this.file, 'utf8'),
      ) as StoredChatGpt;
      if (typeof value.hostId === 'string' && value.hostId) return value;
    } catch {
      // First run, or an unreadable file: start with a fresh host id.
    }
    const fresh = { hostId: `urn:uuid:${randomUUID()}` };
    this.write(fresh);
    return fresh;
  }

  private save(next: StoredChatGpt): void {
    this.stored = next;
    this.write(next);
  }

  // Owner-only, written whole: a crash mid-write never leaves half a token.
  private write(value: StoredChatGpt): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }
}
