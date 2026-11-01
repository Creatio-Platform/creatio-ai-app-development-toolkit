// claude --strict-mcp-config --mcp-config modules/rca/mcp.rca.json

// The RCA agent's attachment reader, in one file with no imports. A prototype: how the agent reads attachment content
// is not settled yet.
// RcaAgentMcp as a stdio MCP server: RcaAgentMcp needs a Creatio session (AuthService login, cookies, BPMCSRF), which
// a host's static-header HTTP client cannot obtain, so this logs in, keeps the session and the Mcp-Session-Id, logs in
// again once on a 401, and passes on only the tools in TOOLS — anything else RcaAgentMcp offers is neither listed nor
// callable.
// Connection: CREATIO_BASE_URL / CREATIO_LOGIN / CREATIO_PASSWORD, optionally CREATIO_RCA_AGENT_MCP_PATH (the route's
// /0/ prefix depends on the stand; the MCP server card's "Full URL" shows the real path). Node 20+ standard library.

// The only tools passed on: the attachment content the RCA agent reads.
const TOOLS = Object.freeze(['get_text_file_content']);
const DEFAULT_MCP_PATH = '/0/rest/ToolServiceMcp/RcaAgentMcp/v1/mcp';
const LOGIN_PATH = '/ServiceModel/AuthService.svc/Login';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const log = (m) => process.stderr.write(`[rca-files] ${m}\n`);

// ---------- configuration ----------
// An unset variable in an MCP configuration reaches the process as the literal "${VAR}" text: that, or an empty
// value, is "not set".
const isUnset = (v) => v === undefined || v === null || String(v).trim() === '' || /^\$\{[^}]*\}$/.test(String(v).trim());
const value = (v) => (isUnset(v) ? '' : String(v).trim());

// Git Bash (MSYS) rewrites an environment value that starts with `/` into a Windows path for every program it starts;
// such a value is turned back into the path it was.
function urlPath(v) {
  const s = value(v);
  const m = /^[A-Za-z]:[\\/].*?([\\/](?:0[\\/])?rest[\\/].*)$/.exec(s);
  return m ? m[1].replace(/\\/g, '/') : s;
}

// ---------- RcaAgentMcp client ----------
// The JSON-RPC message in a text/event-stream body. A stream can carry several events (a notification before the
// response, say): split it into events on the blank line, join each event's `data:` lines, and take the message whose
// `id` is the request's — or, for a notification, the last one. No data at all is null; data that is never JSON throws.
function sseMessage(text, id) {
  const messages = [];
  let sawData = false;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    sawData = true;
    try { messages.push(JSON.parse(data)); } catch { /* an event that is not JSON */ }
  }
  if (!messages.length) {
    if (sawData) throw new Error('no JSON event in the stream');
    return null;
  }
  return (id === undefined ? null : messages.find((m) => m?.id === id)) ?? messages[messages.length - 1];
}

class RcaAgentMcpClient {
  constructor({ baseUrl, login, password, mcpPath, log = () => {}, fetchImpl = globalThis.fetch, timeoutMs = 45000, clientName = 'rca-gateway' }) {
    Object.assign(this, { baseUrl: baseUrl.replace(/\/+$/, ''), login, password, mcpPath, log, fetchImpl, timeoutMs, clientName });
    this.cookieJar = '';
    this.bpmcsrf = '';
    this.sessionId = '';
    this.loginPromise = null;
    this.nextId = 1;
    this.initialized = null;
  }

  ensureLoggedIn() {
    if (this.cookieJar) return Promise.resolve();
    if (!this.loginPromise) this.loginPromise = this.doLogin().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  async doLogin() {
    const res = await this.fetchImpl(this.baseUrl + LOGIN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ForceUseSession: 'true' },
      body: JSON.stringify({ UserName: this.login, UserPassword: this.password }),
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (body.Code !== 0) throw new Error(`login failed (HTTP ${res.status}${body.Message ? `: ${body.Message}` : ''})`);
    const cookies = {};
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [nv] = sc.split(';');
      const eq = nv.indexOf('=');
      if (eq > 0) cookies[nv.slice(0, eq).trim()] = nv.slice(eq + 1).trim();
    }
    this.cookieJar = Object.entries(cookies).map(([n, v]) => `${n}=${v}`).join('; ');
    this.bpmcsrf = cookies.BPMCSRF || '';
    if (!this.bpmcsrf) { this.cookieJar = ''; throw new Error('BPMCSRF cookie not returned by AuthService.svc/Login'); }
    this.sessionId = ''; // a fresh Creatio session invalidates any MCP session id
    this.log(`RcaAgentMcp: login ok (${Object.keys(cookies).length} cookies)`);
  }

  post(jsonRpc) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Cookie: this.cookieJar,
      BPMCSRF: this.bpmcsrf,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return this.fetchImpl(this.baseUrl + this.mcpPath, {
      method: 'POST', headers, body: JSON.stringify(jsonRpc), redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  // Sends one JSON-RPC message; returns the parsed response message, or null for a notification. `retry` allows one
  // recovery: a new Creatio login after a 401, or a new MCP session after a 404.
  async send(jsonRpc, retry = true) {
    await this.ensureLoggedIn();
    const res = await this.post(jsonRpc);
    if (res.status === 404) {
      // An MCP server also answers 404 for a session it has dropped (MCP spec, streamable HTTP): start a new
      // session once before reading the 404 as a route that is not published.
      if (this.sessionId && retry) {
        this.log('RcaAgentMcp: 404 for the MCP session — starting a new one');
        this.sessionId = '';
        this.initialized = null;
        if (jsonRpc.method !== 'initialize') await this.initialize();
        return this.send(jsonRpc, false);
      }
      throw new Error(`not found at ${this.mcpPath} on this stand — publish it, or set CREATIO_RCA_AGENT_MCP_PATH to the route it is published at`);
    }
    if (res.status === 401 && retry) {
      this.log('RcaAgentMcp: 401 — logging in again');
      this.cookieJar = '';
      this.sessionId = '';
      this.initialized = null;
      await this.ensureLoggedIn();
      if (jsonRpc.method !== 'initialize') await this.initialize();
      return this.send(jsonRpc, false);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid && !this.sessionId) this.sessionId = sid;
    if (res.status === 202) return null;
    const text = await res.text();
    let message;
    try {
      message = (res.headers.get('content-type') || '').includes('text/event-stream')
        ? sseMessage(text, jsonRpc.id)
        : (text ? JSON.parse(text) : null);
    } catch { message = undefined; }
    if (!res.ok) {
      // A JSON-RPC error the server sent with an HTTP error status is still its answer; anything else is a failure.
      if (message?.jsonrpc && message.error) return message;
      const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`HTTP ${res.status}${excerpt ? `: ${excerpt}` : ''}`);
    }
    if (message === undefined) throw new Error(`HTTP ${res.status}: non-JSON response`);
    return message;
  }

  request(method, params) {
    return this.send({ jsonrpc: '2.0', id: this.nextId++, method, ...(params === undefined ? {} : { params }) });
  }

  initialize() {
    if (!this.initialized) {
      this.initialized = (async () => {
        const r = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: this.clientName, version: '1' } });
        if (!r || r.error) throw new Error(`RcaAgentMcp initialize failed: ${r?.error?.message || 'no answer'}`);
        await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        return r.result;
      })().catch((e) => { this.initialized = null; throw e; });
    }
    return this.initialized;
  }

  async listTools() {
    await this.initialize();
    const r = await this.request('tools/list', {});
    if (!r || r.error) throw new Error(`RcaAgentMcp tools/list failed: ${r?.error?.message || 'no answer'}`);
    return r.result.tools;
  }

  // Returns the JSON-RPC response message ({ result } or { error }).
  async callTool(name, args) {
    await this.initialize();
    return this.request('tools/call', { name, arguments: args });
  }
}

// ---------- MCP server over stdio: JSON-RPC 2.0, one message per line ----------
function serve({ listTools, callTool }) {
  const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message, data) => write({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
      if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.id !== undefined) return; // a response: ignore
      fail(msg?.id ?? null, -32600, 'Invalid request');
      return;
    }
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize':
          reply(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'rca-files', version: '0' },
          });
          return;
        case 'ping':
          if (isRequest) reply(id, {});
          return;
        case 'tools/list':
          reply(id, { tools: await listTools() });
          return;
        case 'tools/call':
          if (!params || typeof params.name !== 'string') { fail(id, -32602, 'tools/call needs params.name'); return; }
          reply(id, await callTool(params.name, params.arguments ?? {}));
          return;
        default:
          if (isRequest) fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      if (e?.rpcCode) { if (isRequest) fail(id, e.rpcCode, e.message, e.rpcData); return; }
      log(`${method} failed: ${e?.stack || e}`);
      if (isRequest) fail(id, -32603, String(e?.message || e));
    }
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
      handle(msg);
    }
  });
}

// ---------- start ----------
const env = process.env;
const conn = {
  baseUrl: value(env.CREATIO_BASE_URL).replace(/\/+$/, ''),
  login: value(env.CREATIO_LOGIN),
  password: value(env.CREATIO_PASSWORD),
};
if (!conn.baseUrl || !conn.login || !conn.password) {
  log('missing base url / login / password: set CREATIO_BASE_URL, CREATIO_LOGIN and CREATIO_PASSWORD before starting the session');
  process.exit(1);
}

const client = new RcaAgentMcpClient({ ...conn, mcpPath: urlPath(env.CREATIO_RCA_AGENT_MCP_PATH) || DEFAULT_MCP_PATH, log, clientName: 'rca-files' });

serve({
  listTools: async () => (await client.listTools()).filter((t) => TOOLS.includes(t.name)),
  callTool: async (name, args) => {
    if (!TOOLS.includes(name)) throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
    const r = await client.callTool(name, args);
    if (r?.error) throw Object.assign(new Error(r.error.message), { rpcCode: r.error.code, rpcData: r.error.data });
    return r.result;
  },
});
