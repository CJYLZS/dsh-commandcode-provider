import z from "@deepseek-ai/schemastery";

/**
 * Attach a settings section across dsh-settings API generations. dsh >= rc.1
 * moved the standalone installSettingsSection into SettingsProvider.
 * installSection; older dsh (rc.6..rc.8) exposes only register(). Feature-
 * detect installSection and fall back to the register-based lifecycle so one
 * build serves both.
 */
function installSettingsCompat(ctx, ns, schema, entry, hooks) {
  ctx.inject(['settings'], (sctx) => {
    const settings = sctx.settings;
    if (typeof settings.installSection === 'function') {
      settings.installSection(ctx, ns, schema, entry, hooks);
      return;
    }
    const scope = settings.register(ns, schema, {
      base: entry,
      ...(hooks.validate === undefined ? {} : { validate: hooks.validate }),
    });
    hooks.setSource(() => scope.get());
    sctx.effect(() => () => {
      hooks.setSource(() => entry);
      hooks.onChange();
    });
    hooks.onChange();
    scope.watch(() => hooks.onChange());
  });
}

const PLAN_NS = "dsh-commandcode-plan-autosync";
const LLM_PI_AI_NS = "llm-pi-ai";
const BRIDGE_PREFIX = "/api/dsh-commandcode-plan-autosync";

const DEFAULT_SOURCE_URL = "https://api.commandcode.ai/provider/v1/models";
// The GOAT plan docs page embeds the full per-model catalog (61 entries with
// reasoning/vision/caps/pricing/min-plan) in its RSC payload. Official, no auth.
const DEFAULT_CATALOG_URL = "https://commandcode.ai/docs/plans/goat";
const DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";
const DEFAULT_API_KEY_ENV = "COMMANDCODE_API_KEY";

// Official subscription tiers, cumulative by minimum plan (docs/plans/*):
// goat = Go ∪ GOAT (43), pro = goat + Pro (56), max = everything (61).
// Go alone is not offered: it is the only plan without API access (403).
const PLAN_MIN = {
  goat: new Set(["Go", "GOAT"]),
  pro: new Set(["Go", "GOAT", "Pro"]),
  max: null, // every model
};
const ANTHROPIC_VENDOR = "Anthropic";

// One provider per subscription tier per route:
// commandcode-<plan>-autosync (openai-completions) / commandcode-<plan>-anthropic.
function providerKey(plan, route) {
  return `commandcode-${plan}-${route === "anthropic" ? "anthropic" : "autosync"}`;
}

// --- data acquisition -------------------------------------------------------

// Official live list: OpenAI-style { data: [{ id, name, context_length }] }.
async function fetchModelList(sourceURL, signal) {
  const res = await fetch(sourceURL, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`fetch ${sourceURL} failed: HTTP ${res.status}`);
  const data = await res.json();
  const list = data?.data;
  if (!Array.isArray(list)) {
    throw new Error(`unexpected response from ${sourceURL}: expected { data: [...] }`);
  }
  return list
    .filter((m) => m && typeof m === "object" && typeof m.id === "string")
    .map((m) => ({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
    }));
}

// GOAT docs page RSC payload: concatenate self.__next_f chunks, locate the
// [{"slug": ...}] catalog array, undefine "$undefined" placeholders.
// Returns the raw array (fields documented at
// https://commandcode.ai/docs/plans/goat) or throws.
async function fetchCatalog(catalogURL, signal) {
  const res = await fetch(catalogURL, { signal, headers: { accept: "text/html" } });
  if (!res.ok) throw new Error(`fetch ${catalogURL} failed: HTTP ${res.status}`);
  const html = await res.text();
  const chunks = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    chunks.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  if (chunks.length === 0) throw new Error(`no RSC payload found in ${catalogURL}`);
  const joined = chunks.join("");
  const start = joined.indexOf('[{"slug":');
  if (start < 0) throw new Error(`catalog array not found in ${catalogURL}`);
  let depth = 0, i = start, inStr = false, esc = false;
  for (; i < joined.length; i++) {
    const c = joined[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  const json = joined.slice(start, i + 1).replace(/"\$undefined"/g, "null");
  const arr = JSON.parse(json);
  if (!Array.isArray(arr)) throw new Error(`catalog array is not an array in ${catalogURL}`);
  return arr;
}

// --- conversion ---------------------------------------------------------------

// Claude-family models are served by /messages (Anthropic schema); everything
// else by /chat/completions. The docs reject the wrong endpoint with 400.
function routeOf(id, vendor) {
  if (vendor === ANTHROPIC_VENDOR || id.startsWith("claude-")) return "anthropic";
  return "openai";
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Match an API model to its catalog entry: exact id, else normalized slug/name.
function findCatalogEntry(catalogById, slugById, api) {
  return catalogById.get(api.id)
    ?? slugById.get(slugify(api.id))
    ?? [...catalogById.values()].find((e) => e.name === api.name);
}

function buildEntries({ apiList, catalog, plan, extraIds, includeReasoningEfforts }) {
  const catalogById = new Map(catalog.filter((e) => typeof e?.id === "string").map((e) => [e.id, e]));
  const slugById = new Map(
    catalog.filter((e) => typeof e?.slug === "string").map((e) => [slugify(e.slug), e]),
  );
  const min = plan === "max" ? null : PLAN_MIN[plan];
  const byRoute = { openai: [], anthropic: [] };
  for (const api of apiList) {
    const cat = findCatalogEntry(catalogById, slugById, api);
    if (cat && min && !min.has(cat.minPlanName)) continue; // outside this plan
    const entry = { id: api.id };
    const name = cat?.name ?? api.name;
    if (name && name !== api.id) entry.name = name;
    const contextWindow = api.contextWindow ?? cat?.contextWindow;
    if (contextWindow) entry.contextWindow = contextWindow;
    // vision? -> allow images; catalog unknown -> text only.
    entry.input = cat ? (cat.vision === true ? ["text", "image"] : ["text"]) : ["text"];
    if (cat && cat.reasoning === false) {
      // Official catalog says no reasoning: block reasoning_effort for this model.
      entry.reasoningEfforts = false;
    } else if (cat && cat.reasoning === true && includeReasoningEfforts) {
      // Official catalog gives no per-model effort lists, so this opt-in writes
      // an identity map across the gateway-known levels the site's own catalog
      // advertises (low..max). Off by default.
      entry.reasoningEfforts = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
    }
    byRoute[routeOf(api.id, cat?.vendor)].push(entry);
  }
  const known = new Set(apiList.map((m) => m.id));
  for (const eid of Array.isArray(extraIds) ? extraIds : []) {
    const id = String(eid).trim();
    if (id && !known.has(id)) byRoute.openai.push({ id });
  }
  for (const route of Object.values(byRoute)) route.sort((a, b) => a.id.localeCompare(b.id));
  return byRoute;
}

// Build llm-pi-ai providers.<key> patches from routed entries. Preserves
// apiKeyEnv/baseURL/compat on update unless plugin config overrides them.
const ROUTE_API = { openai: "openai-completions", anthropic: "anthropic-messages" };

function buildRoutePatch({ key, route, entries }, pluginConfig) {
  const apiKeyEnv = pluginConfig.targetApiKeyEnv ?? DEFAULT_API_KEY_ENV;
  const baseURL = pluginConfig.targetBaseURL ?? DEFAULT_BASE_URL;
  const patch = { apiKeyEnv, api: ROUTE_API[route], baseURL, models: entries };
  if (route === "openai") {
    // schemastery materializes an absent targetCompat as {} (truthy), so only
    // a non-empty override counts; otherwise write the reasoning-enabling default.
    const override = pluginConfig.targetCompat;
    patch.compat = override && Object.keys(override).length > 0
      ? override
      : { thinkingFormat: "openai", supportsReasoningEffort: true };
  }
  return { key, patch };
}

// --- settings helpers ---------------------------------------------------------

function readLlmPiAiValue(settings) {
  return settings.describe().find((d) => String(d.ns) === String(LLM_PI_AI_NS))?.value ?? {};
}

async function upsertProvider({ settings, key, patch }) {
  // Use mutate (revision-fenced) to avoid clobbering secrets. If the provider
  // already exists we only replace its `models` and ensure base fields exist;
  // an existing apiKeyEnv/baseURL set by the user is preserved.
  const current = readLlmPiAiValue(settings);
  const existing = current.providers?.[key];
  const ops = [];
  if (!existing) {
    ops.push({ op: "set", path: ["providers", key], value: patch });
  } else {
    if (!existing.apiKeyEnv) ops.push({ op: "set", path: ["providers", key, "apiKeyEnv"], value: patch.apiKeyEnv });
    if (!existing.baseURL) ops.push({ op: "set", path: ["providers", key, "baseURL"], value: patch.baseURL });
    if (!existing.api) ops.push({ op: "set", path: ["providers", key, "api"], value: patch.api });
    // An empty {} persisted compat must also be replaced (pre-0.1.1 bug wrote one).
    const emptyCompat = !existing.compat
      || (typeof existing.compat === "object" && Object.keys(existing.compat).length === 0);
    if (emptyCompat && patch.compat) ops.push({ op: "set", path: ["providers", key, "compat"], value: patch.compat });
    ops.push({ op: "set", path: ["providers", key, "models"], value: patch.models });
  }
  if (ops.length === 0) return { key, count: patch.models.length, created: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const desc = settings.describe().find((d) => String(d.ns) === String(LLM_PI_AI_NS));
    const rev = desc?.revision;
    try {
      await settings.mutate(LLM_PI_AI_NS, ops, rev);
      return { key, count: patch.models.length, created: !existing };
    } catch (e) {
      const isConflict = e && (e.code === "SETTINGS_CONFLICT" || /conflict/i.test(e.message ?? ""));
      if (!isConflict || attempt === 1) throw e;
    }
  }
  throw new Error("unreachable");
}

// --- bridge (loopback only, for the settings card) -----------------------------
const MAX_JSON = 256 * 1024;

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") return false;
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let url; try { url = new URL("http://" + host); } catch { return false; }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === url.host; } catch { return false; }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const bufs = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_JSON) return undefined; bufs.push(c); }
  try { return JSON.parse(Buffer.concat(bufs).toString("utf8")); } catch { return undefined; }
}

function toView(d) {
  return {
    ns: String(d.ns), schema: d.schema, value: d.value,
    ...(d.base === undefined ? {} : { base: d.base }),
    ...(d.user === undefined ? {} : { user: d.user }),
    ...(d.secrets === undefined ? {} : { secrets: d.secrets.map((s) => ({ path: [...s.path], set: s.set })) }),
    revision: d.revision,
  };
}

function targetInfo(settings, key) {
  const llm = settings.describe({ redactSecrets: true }).find((d) => String(d.ns) === String(LLM_PI_AI_NS));
  const existing = llm?.value?.providers?.[key];
  return { existing: Boolean(existing), count: Array.isArray(existing?.models) ? existing.models.length : 0 };
}

function makeBridgeRoutes(settings, pluginConfigRef) {
  const allow = () => settings.describe({ redactSecrets: true })
    .filter((d) => String(d.ns) === String(PLAN_NS) || String(d.ns) === String(LLM_PI_AI_NS))
    .map((d) => String(d.ns));

  const handlers = {
    async describe() {
      const descs = settings.describe({ redactSecrets: true });
      const picked = allow().map((ns) => descs.find((d) => String(d.ns) === ns)).filter(Boolean).map(toView);
      const plan = pluginConfigRef().plan ?? "goat";
      const openaiKey = providerKey(plan, "openai");
      const anthropicKey = providerKey(plan, "anthropic");
      return {
        ok: true,
        value: {
          namespaces: picked,
          writable: settings.writable !== false,
          plan,
          targets: {
            openai: { ...targetInfo(settings, openaiKey), key: openaiKey },
            anthropic: { ...targetInfo(settings, anthropicKey), key: anthropicKey },
          },
        },
      };
    },
    async sync(body) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 30000);
      try {
        const cfg = pluginConfigRef();
        const plan = cfg.plan ?? "goat";
        const apiList = await fetchModelList(cfg.sourceURL ?? DEFAULT_SOURCE_URL, ac.signal);
        let catalog = [];
        let warn;
        try {
          catalog = await fetchCatalog(cfg.catalogURL ?? DEFAULT_CATALOG_URL, ac.signal);
        } catch (e) {
          warn = `catalog unavailable (${e instanceof Error ? e.message : String(e)}); reasoning/vision/plan-scope omitted`;
        }
        const byRoute = buildEntries({ apiList, catalog, plan, extraIds: cfg.extraIds ?? [], includeReasoningEfforts: cfg.includeReasoningEfforts ?? false });
        if (body?.dryRun) {
          return {
            ok: true,
            value: {
              dryRun: true,
              plan,
              openai: { key: providerKey(plan, "openai"), count: byRoute.openai.length },
              anthropic: { key: providerKey(plan, "anthropic"), count: byRoute.anthropic.length },
              sample: byRoute.openai.slice(0, 3),
              warn,
            },
          };
        }
        const results = [];
        const openaiPatch = buildRoutePatch({ key: providerKey(plan, "openai"), route: "openai", entries: byRoute.openai }, cfg);
        if (openaiPatch.patch.models.length > 0) results.push(await upsertProvider({ settings, ...openaiPatch }));
        const anthropicPatch = buildRoutePatch({ key: providerKey(plan, "anthropic"), route: "anthropic", entries: byRoute.anthropic }, cfg);
        if (anthropicPatch.patch.models.length > 0) results.push(await upsertProvider({ settings, ...anthropicPatch }));
        return { ok: true, value: { results, warn } };
      } catch (e) {
        return { ok: false, code: "sync-failed", message: e instanceof Error ? e.message : String(e) };
      } finally { clearTimeout(t); }
    },
    async mutate(body) {
      if (!body || typeof body.ns !== "string" || !Array.isArray(body.ops)) {
        return { ok: false, code: "settings-rejected", message: "malformed bridge settings request" };
      }
      if (!allow().includes(body.ns)) {
        return { ok: false, code: "settings-not-exposed", message: `namespace ${JSON.stringify(body.ns)} is not exposed` };
      }
      const rev = typeof body.expectedRevision === "number" ? body.expectedRevision : undefined;
      try {
        await settings.mutate(body.ns, body.ops, rev);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e && e.code === "SETTINGS_CONFLICT") return { ok: false, code: "settings-conflict", message: msg };
        return { ok: false, code: "internal", message: msg };
      }
      const d = settings.describe({ redactSecrets: true }).find((x) => String(x.ns) === body.ns);
      if (!d) return { ok: false, code: "internal", message: `namespace ${JSON.stringify(body.ns)} was disposed` };
      return { ok: true, value: toView(d) };
    },
  };

  const guard = (req, res) => {
    if (!isLoopback(req)) { json(res, 403, { error: "loopback only" }); return false; }
    if (req.method !== "POST") { json(res, 405, { error: "method not allowed" }); return false; }
    return true;
  };

  return [
    { kind: "exact", path: `${BRIDGE_PREFIX}/describe`, handler: async (req, res) => {
      if (!guard(req, res)) return;
      json(res, 200, await handlers.describe());
    }},
    { kind: "exact", path: `${BRIDGE_PREFIX}/sync`, handler: async (req, res) => {
      if (!guard(req, res)) return;
      const body = await readJson(req);
      if (body === undefined) { json(res, 400, { ok: false, code: "settings-rejected", message: "malformed JSON" }); return; }
      json(res, 200, await handlers.sync(body));
    }},
    { kind: "exact", path: `${BRIDGE_PREFIX}/mutate`, handler: async (req, res) => {
      if (!guard(req, res)) return;
      const body = await readJson(req);
      if (body === undefined) { json(res, 400, { ok: false, code: "settings-rejected", message: "malformed JSON" }); return; }
      json(res, 200, await handlers.mutate(body));
    }},
  ];
}

export const name = "dsh-commandcode-plan-autosync";

// Pure data pipeline, exported for standalone verification.
export { fetchModelList, fetchCatalog, buildEntries, buildRoutePatch, routeOf, providerKey };

export const Config = z.object({
  sourceURL: z.string().default(DEFAULT_SOURCE_URL),
  catalogURL: z.string().default(DEFAULT_CATALOG_URL),
  plan: z.union(["goat", "pro", "max"]).default("goat"),
  targetApiKeyEnv: z.string(),
  targetBaseURL: z.string(),
  targetCompat: z.object({
    thinkingFormat: z.union(["openai", "deepseek", "openrouter", "together", "zai", "qwen", "chat-template", "qwen-chat-template", "string-thinking", "ant-ling", "baseten"]),
    supportsReasoningEffort: z.boolean(),
  }),
  extraIds: z.array(z.string()).default([]),
  includeReasoningEfforts: z.boolean().default(false),
  autoSync: z.boolean().default(false),
  autoSyncIntervalMs: z.number().step(1).min(60_000).default(6 * 60 * 60 * 1000),
});

export function apply(ctx, config) {
  let current = () => config ?? {};
  const pluginConfigRef = () => ({
    sourceURL: current().sourceURL ?? DEFAULT_SOURCE_URL,
    catalogURL: current().catalogURL ?? DEFAULT_CATALOG_URL,
    plan: current().plan ?? "goat",
    targetApiKeyEnv: current().targetApiKeyEnv,
    targetBaseURL: current().targetBaseURL,
    targetCompat: current().targetCompat,
    extraIds: current().extraIds ?? [],
    includeReasoningEfforts: current().includeReasoningEfforts ?? false,
  });

  installSettingsCompat(ctx, PLAN_NS, Config, config ?? {}, {
    setSource: (src) => { current = src; },
    onChange: () => {},
  });

  // Optional periodic auto-sync (off by default; user must opt-in via settings card).
  ctx.effect(() => {
    const cfg = current();
    if (!cfg.autoSync) return;
    const interval = cfg.autoSyncIntervalMs ?? 6 * 60 * 60 * 1000;
    let timer;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const s = ctx.get("settings");
        if (!s) return;
        const cfg2 = pluginConfigRef();
        const plan = cfg2.plan ?? "goat";
        const apiList = await fetchModelList(cfg2.sourceURL ?? DEFAULT_SOURCE_URL);
        let catalog = [];
        try { catalog = await fetchCatalog(cfg2.catalogURL ?? DEFAULT_CATALOG_URL); } catch { /* keep last state */ }
        const byRoute = buildEntries({ apiList, catalog, plan, extraIds: cfg2.extraIds ?? [], includeReasoningEfforts: cfg2.includeReasoningEfforts ?? false });
        const openaiPatch = buildRoutePatch({ key: providerKey(plan, "openai"), route: "openai", entries: byRoute.openai }, cfg2);
        if (openaiPatch.patch.models.length > 0) await upsertProvider({ settings: s, ...openaiPatch });
        const anthropicPatch = buildRoutePatch({ key: providerKey(plan, "anthropic"), route: "anthropic", entries: byRoute.anthropic }, cfg2);
        if (anthropicPatch.patch.models.length > 0) await upsertProvider({ settings: s, ...anthropicPatch });
        ctx.logger.info(`dsh-commandcode-plan-autosync: auto-synced ${byRoute.openai.length}+${byRoute.anthropic.length} models (${plan})`);
      } catch (e) {
        ctx.logger.warn(`dsh-commandcode-plan-autosync: auto-sync failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    // First tick after 10s, then interval.
    const first = setTimeout(() => { tick(); timer = setInterval(tick, interval); }, 10_000);
    timer = undefined;
    return () => {
      stopped = true;
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, "dsh-commandcode-plan-autosync: auto-sync");

  // Host bridge for the settings card (loopback-only).
  ctx.inject(["webServer", "settings"], (sctx) => {
    sctx.effect(() => {
      const routes = makeBridgeRoutes(sctx.settings, pluginConfigRef).map((r) => sctx.webServer.register(r));
      return () => { for (const d of routes) d(); };
    }, "dsh-commandcode-plan-autosync: bridge");
  });
}