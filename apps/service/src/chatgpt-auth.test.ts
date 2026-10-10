import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatGptAuth } from './chatgpt-auth.js';

const ISSUER = 'https://auth.openai.com';
const PLAN_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

const folders: string[] = [];
const auths: ChatGptAuth[] = [];
afterEach(() => {
  for (const auth of auths.splice(0)) auth.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'chatgpt-auth-'));
  folders.push(path);
  return path;
}

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' },
  };
}

function idToken(
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = part({ alg: 'RS256', kid, typ: 'JWT' });
  const body = part({
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'user-1',
    email: 'me@example.com',
    ...claims,
  });
  const signature = sign(
    'sha256',
    Buffer.from(`${head}.${body}`),
    privateKey,
  ).toString('base64url');
  return `${head}.${body}.${signature}`;
}

// A stand-in for auth.openai.com: discovery, keys, and a token endpoint
// whose answers each test scripts.
function openai(options: {
  scope?: string;
  signer?: KeyObject;
  tokenStatus?: number;
  tokenError?: string;
}) {
  const key = keyPair('k1');
  const tokenRequests: URLSearchParams[] = [];
  let nonce = '';
  let clientId = 'oaiapp_123';
  let refreshCount = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        revocation_endpoint: `${ISSUER}/oauth/revoke`,
      });
    }
    if (url.endsWith('/jwks.json')) return Response.json({ keys: [key.jwk] });
    if (url.endsWith('/oauth/revoke')) return new Response(null);
    if (url.endsWith('/api/accounts/oauth/token')) {
      const body = new URLSearchParams(String(init?.body));
      tokenRequests.push(body);
      if (options.tokenStatus) {
        return Response.json(
          { error: options.tokenError ?? 'invalid_grant' },
          { status: options.tokenStatus },
        );
      }
      clientId = body.get('client_id') ?? clientId;
      const refreshing = body.get('grant_type') === 'refresh_token';
      if (refreshing) refreshCount += 1;
      return Response.json({
        access_token: refreshing ? `access-${refreshCount + 1}` : 'access-1',
        refresh_token: refreshing ? `refresh-${refreshCount + 1}` : 'refresh-1',
        expires_in: 3600,
        token_type: 'Bearer',
        ...(refreshing
          ? {}
          : {
              scope: options.scope ?? PLAN_SCOPES,
              id_token: idToken(options.signer ?? key.privateKey, 'k1', {
                aud: clientId,
                nonce,
              }),
            }),
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return {
    fetchFn,
    tokenRequests,
    setNonce: (value: string) => {
      nonce = value;
    },
  };
}

function auth(dataDirectory: string, fetchFn: typeof fetch): ChatGptAuth {
  const instance = new ChatGptAuth({ dataDirectory, fetch: fetchFn, port: 0 });
  auths.push(instance);
  return instance;
}

// What the browser does after the user consents: follow the redirect.
async function consent(
  url: string,
  server: ReturnType<typeof openai>,
  overrides: Record<string, string> = {},
) {
  const authorize = new URL(url);
  server.setNonce(authorize.searchParams.get('nonce') ?? '');
  const callback = new URL(authorize.searchParams.get('redirect_uri')!);
  callback.searchParams.set('code', 'code-1');
  callback.searchParams.set('state', authorize.searchParams.get('state')!);
  callback.searchParams.set('client_id', 'oaiapp_123');
  callback.searchParams.set('scope', PLAN_SCOPES);
  for (const [key, value] of Object.entries(overrides)) {
    callback.searchParams.set(key, value);
  }
  return fetch(callback);
}

describe('Sign in with ChatGPT', () => {
  it('asks for plan usage the way the spec says, from a stable host id', async () => {
    const data = folder();
    const server = openai({});
    const first = auth(data, server.fetchFn);
    const url = new URL(await first.startSignIn());
    expect(url.origin + url.pathname).toBe(
      'https://auth.openai.com/api/accounts/authorize',
    );
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Visual Agent Harness',
      response_type: 'code',
      scope: PLAN_SCOPES,
      resource: 'https://api.openai.com/v1',
      code_challenge_method: 'S256',
    });
    expect(params.ext_agent_host_id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(params.redirect_uri).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
    );
    expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The host id outlives the process.
    first.close();
    const again = new URL(
      await auth(data, server.fetchFn).startSignIn(),
    ).searchParams.get('ext_agent_host_id');
    expect(again).toBe(params.ext_agent_host_id);
  });

  it('signs in, keeps tokens in an owner-only file, and reuses the registration', async () => {
    const data = folder();
    const server = openai({});
    const chatgpt = auth(data, server.fetchFn);
    const page = await consent(await chatgpt.startSignIn(), server);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Signed in to ChatGPT');
    expect(chatgpt.status()).toEqual({
      signedIn: true,
      email: 'me@example.com',
      pending: false,
    });
    const exchange = server.tokenRequests[0]!;
    expect(Object.fromEntries(exchange)).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_123',
      code: 'code-1',
      resource: 'https://api.openai.com/v1',
    });
    expect(exchange.get('code_verifier')).toBeTruthy();
    const file = join(data, 'chatgpt.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toContain('refresh-1');
    expect(await chatgpt.accessToken()).toBe('access-1');

    // Next sign-in: the issued client id, no name hint, account pre-selected.
    const returning = new URL(await chatgpt.startSignIn()).searchParams;
    expect(returning.get('client_id')).toBe('oaiapp_123');
    expect(returning.has('agent_name_hint')).toBe(false);
    expect(returning.get('login_hint')).toBe('me@example.com');
    expect(returning.get('id_token_hint')).toBeTruthy();
  });

  it('ignores a callback that does not carry our state', async () => {
    const server = openai({});
    const chatgpt = auth(folder(), server.fetchFn);
    const page = await consent(await chatgpt.startSignIn(), server, {
      state: 'forged',
    });
    expect(page.status).toBe(400);
    expect(server.tokenRequests).toHaveLength(0);
    expect(chatgpt.status().signedIn).toBe(false);
  });

  it('refuses an identity signed by anyone but OpenAI', async () => {
    const server = openai({ signer: keyPair('k1').privateKey });
    const chatgpt = auth(folder(), server.fetchFn);
    await consent(await chatgpt.startSignIn(), server);
    expect(chatgpt.status()).toMatchObject({
      signedIn: false,
      error: expect.stringMatching(/could not be verified/),
    });
  });

  it('says so when ChatGPT signs you in without granting plan usage', async () => {
    const server = openai({ scope: 'openid profile email offline_access' });
    const chatgpt = auth(folder(), server.fetchFn);
    await consent(await chatgpt.startSignIn(), server);
    expect(chatgpt.status()).toMatchObject({
      signedIn: false,
      error: expect.stringMatching(/did not grant plan usage/),
    });
  });

  it('never echoes callback text into the page as markup', async () => {
    const server = openai({});
    const chatgpt = auth(folder(), server.fetchFn);
    const page = await consent(await chatgpt.startSignIn(), server, {
      error: 'server_error',
      error_description: '<script>alert(1)</script>',
    });
    const html = await page.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('reports a cancelled consent without exchanging anything', async () => {
    const server = openai({});
    const chatgpt = auth(folder(), server.fetchFn);
    await consent(await chatgpt.startSignIn(), server, {
      error: 'access_denied',
    });
    expect(server.tokenRequests).toHaveLength(0);
    expect(chatgpt.status().error).toMatch(/cancelled/);
  });
});

describe('keeping the connection alive', () => {
  async function signedIn() {
    const data = folder();
    const server = openai({});
    const chatgpt = auth(data, server.fetchFn);
    await consent(await chatgpt.startSignIn(), server);
    // Age the token so the next request must refresh.
    const file = join(data, 'chatgpt.json');
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >;
    stored.expiresAt = Date.now() + 1_000;
    chatgpt.close();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
    return { chatgpt: auth(data, server.fetchFn), server, data };
  }

  it('refreshes once for concurrent callers and keeps the rotated token', async () => {
    const { chatgpt, server } = await signedIn();
    const tokens = await Promise.all([
      chatgpt.accessToken(),
      chatgpt.accessToken(),
      chatgpt.accessToken(),
    ]);
    expect(tokens).toEqual(['access-2', 'access-2', 'access-2']);
    const refreshes = server.tokenRequests.filter(
      (body) => body.get('grant_type') === 'refresh_token',
    );
    expect(refreshes).toHaveLength(1);
    expect(Object.fromEntries(refreshes[0]!)).toMatchObject({
      client_id: 'oaiapp_123',
      refresh_token: 'refresh-1',
      resource: 'https://api.openai.com/v1',
    });
    // The scope was omitted on refresh; plan usage is still granted.
    expect(chatgpt.status().signedIn).toBe(true);
  });

  it('signs out cleanly when the refresh token is no longer good', async () => {
    const { data } = await signedIn();
    const dead = openai({ tokenStatus: 400, tokenError: 'invalid_grant' });
    const chatgpt = auth(data, dead.fetchFn);
    await expect(chatgpt.accessToken()).rejects.toThrow();
    expect(chatgpt.status()).toMatchObject({
      signedIn: false,
      error: expect.stringMatching(/expired/),
    });
  });

  it('forgets tokens on sign-out but keeps the host and registration', async () => {
    const { chatgpt, data } = await signedIn();
    await chatgpt.signOut();
    expect(chatgpt.status().signedIn).toBe(false);
    const stored = readFileSync(join(data, 'chatgpt.json'), 'utf8');
    expect(stored).not.toContain('refresh-');
    expect(stored).toContain('oaiapp_123');
    expect(stored).toContain('urn:uuid:');
  });
});
