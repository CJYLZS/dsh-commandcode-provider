window.__ModuleLoader__.load({
  id: "dsh-commandcode-provider",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require("react");
    const NS = "dsh-commandcode-provider";
    const BRIDGE = "/api/dsh-commandcode-provider";
    const DEFAULT_SOURCE_URL = "https://api.commandcode.ai/provider/v1/models";
    const DEFAULT_CATALOG_URL = "https://commandcode.ai/docs/plans/goat";
    const DEFAULT_ALPHA_BASE_URL = "https://api.commandcode.ai";

    const PLAN_OPTIONS = [
      { value: "goat", labelZh: "GOAT 套餐", labelEn: "GOAT plan" },
      { value: "pro", labelZh: "Pro 套餐", labelEn: "Pro plan" },
      { value: "max", labelZh: "Max 套餐", labelEn: "Max plan" },
    ];
    const providerName = (plan, route) => `commandcode-${plan}-${route === "anthropic" ? "anthropic" : "autosync"}`;

    // --- usage formatting (pure) ---
    const fmtMoney = (v) => `$${Number(v ?? 0).toFixed(2)}`;
    const fmtMoneyExact = (v) => `$${Number(v ?? 0).toFixed(4)}`;
    const fmtTokens = (v) => {
      const n = Number(v ?? 0);
      if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return String(n);
    };
    const fmtReset = (ms) => (ms > 0 ? new Date(ms).toLocaleString() : "");

    const css = [
      ".cps-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;min-width:0;list-style:none;overflow:hidden;margin-bottom:8px}",
      ".cps-header{width:100%;color:inherit;cursor:pointer;text-align:left;font:inherit;background:0 0;border:0;align-items:center;gap:8px;padding:10px 14px;display:flex}",
      ".cps-header:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".cps-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}",
      ".cps-name{color:var(--dsw-alias-label-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".cps-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".cps-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .12s}",
      ".cps-chevronOpen{transform:rotate(180deg)}",
      ".cps-body{display:flex;flex-direction:column;gap:14px;padding:0 14px 14px}",
      ".cps-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".cps-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}",
      ".cps-ok{color:#7ddb9c;font-size:12px}",
      ".cps-err{color:var(--dsw-alias-state-error-primary);font-size:12px}",
      ".cps-btn{font:inherit;cursor:pointer;border-radius:6px;padding:5px 12px;font-size:13px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary)}",
      ".cps-btnPrimary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}",
      ".cps-btn:disabled{opacity:.5;cursor:default}",
      ".cps-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;width:100%}",
      ".cps-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;width:100%}",
      ".cps-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".cps-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}",
      ".cps-badge{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-state-business-primary);border-radius:999px;padding:1px 6px;font-size:11px;white-space:nowrap;flex:none}",
    ].join("");
    const tagId = "dsh-commandcode-provider/card.css";
    if (typeof document !== "undefined" && !document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`)) {
      const t = document.createElement("style");
      t.dataset.plugin = "dsh-commandcode-provider";
      t.dataset.pluginCss = tagId;
      t.textContent = css;
      document.head.appendChild(t);
    }

    const I18N = {
      zh: {
        title: "CommandCode 计划同步",
        desc: "一键创建/更新所选订阅的模型供应商（含推理/视觉能力）",
        unsaved: "未保存",
        open: "已展开",
        plan: "订阅类型",
        planHint: (p) => `将创建 ${providerName(p, "openai")}（OpenAI 路由）${p !== "goat" ? `和 ${providerName(p, "anthropic")}（Anthropic 路由，Claude 模型）` : ""}；仅刷新模型列表，保留已配置的密钥与地址。`,
        sourceURL: "模型列表地址",
        catalogURL: "能力目录页",
        catalogHint: "官方 GOAT 计划页，内嵌每模型 reasoning/vision/caps/价格/最低计划；抓取失败时降级为纯列表。",
        extraIds: "额外模型 ID（逗号分隔，可选）",
        extraHint: "保留不在官方目录里的网关私有模型 id。",
        includeEfforts: "写模型思考档位映射",
        includeEffortsHint: "开启后 reasoning 模型写入 reasoningEfforts 身份映射（low..max）。官方目录不含档位枚举，默认关闭。",
        autoSync: "自动同步",
        autoHint: "开启后每 6 小时从上游刷新一次（启动 10 秒后首次执行）。",
        interval: "同步间隔",
        webSearch: "用 CommandCode 提供 web_search",
        webSearchHint: "开启后，模型的 web_search 工具走 CommandCode /alpha/web-search（与聊天同一个 key）；关闭则回落 dsh 自带 DeepSeek 搜索。",
        usageBase: "用量/搜索 API 地址",
        usageBaseHint: "账户与用量端点位于 API 根路径（/alpha/*），与聊天用的 /provider/v1 基址不同。",
        usage: "账户用量",
        usageRefresh: "刷新",
        usageRefreshing: "刷新中…",
        usageLoading: "加载用量中…",
        usageError: "用量获取失败",
        usageBlockedKey: "API Key 无效或已过期",
        usageBlockedKeyHint: "请在凭据管理中重新配置 COMMANDCODE_API_KEY。",
        usageBlockedSvc: "CommandCode 服务不可用",
        usageBlockedSvcHint: "用量端点暂时不可用，请稍后重试。",
        usageBlockedNet: "网络错误",
        usageBlockedNetHint: "无法连接 CommandCode 用量端点，请检查网络。",
        usagePartial: "部分端点获取失败",
        usageUpdated: "更新于",
        usageRequests: "请求",
        usageFailed: "失败",
        usageSuccessRate: "成功率",
        usageCost: "成本",
        usageTokens: "Tokens",
        usageTokensIn: "输入",
        usageTokensOut: "输出",
        usageMonthly: "月度额度",
        usagePurchased: "已购",
        usageFree: "免费",
        usageFiveHour: "5 小时窗口",
        usageWeekly: "周窗口",
        usageExceeded: "超限",
        usagePeriodEnd: "周期结束",
        status: "状态",
        notCreated: "尚未创建",
        created: (key, n) => `${key} · ${n} 个模型`,
        sync: "一键创建/更新",
        syncing: "同步中…",
        dryRun: "预览上游",
        preview: (o_, a) => `上游 openai ${o_} / anthropic ${a} 个模型`,
        ok: (results) => results.map((r) => `✓ ${r.created ? "已创建" : "已更新"} ${r.key} · ${r.count} 个模型`).join("　"),
        fail: (e) => `✗ ${e}`,
        save: "保存",
        saving: "保存中…",
        discard: "撤销",
        toggleLang: "EN",
      },
      en: {
        title: "CommandCode Plan Sync",
        desc: "One-click create/update providers for the selected subscription (reasoning/vision aware)",
        unsaved: "unsaved",
        open: "open",
        plan: "Subscription",
        planHint: (p) => `Will create ${providerName(p, "openai")} (OpenAI route)${p !== "goat" ? ` and ${providerName(p, "anthropic")} (Anthropic route, Claude models)` : ""}; only the model list is refreshed, keys/URLs are preserved.`,
        sourceURL: "Models list URL",
        catalogURL: "Catalog page",
        catalogHint: "Official GOAT plan page embedding per-model reasoning/vision/caps/pricing/min-plan; falls back to the plain list when it fails.",
        extraIds: "Extra model IDs (comma-separated, optional)",
        extraHint: "Keep gateway-private model ids even when absent from the official catalog.",
        includeEfforts: "Write model reasoning effort maps",
        includeEffortsHint: "When on, reasoning models get identity reasoningEfforts maps (low..max). Official catalog has no effort lists, off by default.",
        autoSync: "Auto sync",
        autoHint: "When on, refreshes from upstream every 6h (first run 10s after start).",
        interval: "Interval",
        webSearch: "Serve web_search with Command Code",
        webSearchHint: "When on, the model's web_search tool calls Command Code /alpha/web-search (same key as chat); off falls back to dsh's built-in DeepSeek search.",
        usageBase: "Usage / search API base",
        usageBaseHint: "Account & usage endpoints live on the API root (/alpha/*), distinct from the /provider/v1 chat base.",
        usage: "Account usage",
        usageRefresh: "Refresh",
        usageRefreshing: "Refreshing…",
        usageLoading: "Loading usage…",
        usageError: "Usage fetch failed",
        usageBlockedKey: "API key invalid or expired",
        usageBlockedKeyHint: "Reconfigure the COMMANDCODE_API_KEY credential.",
        usageBlockedSvc: "Command Code service unavailable",
        usageBlockedSvcHint: "Usage endpoints are temporarily unavailable; retry later.",
        usageBlockedNet: "Network error",
        usageBlockedNetHint: "Cannot reach the Command Code usage endpoints; check the network.",
        usagePartial: "Some endpoints failed",
        usageUpdated: "Updated",
        usageRequests: "Requests",
        usageFailed: "failed",
        usageSuccessRate: "Success",
        usageCost: "Cost",
        usageTokens: "Tokens",
        usageTokensIn: "in",
        usageTokensOut: "out",
        usageMonthly: "Monthly",
        usagePurchased: "Purchased",
        usageFree: "Free",
        usageFiveHour: "5-hour window",
        usageWeekly: "Weekly window",
        usageExceeded: "exceeded",
        usagePeriodEnd: "Period ends",
        status: "Status",
        notCreated: "not created yet",
        created: (key, n) => `${key} · ${n} models`,
        sync: "Create / Update",
        syncing: "Syncing…",
        dryRun: "Preview upstream",
        preview: (o_, a) => `Upstream openai ${o_} / anthropic ${a} models`,
        ok: (results) => results.map((r) => `✓ ${r.created ? "Created" : "Updated"} ${r.key} · ${r.count} models`).join("　"),
        fail: (e) => `✗ ${e}`,
        save: "Save",
        saving: "Saving…",
        discard: "Discard",
        toggleLang: "中文",
      },
    };
    const tt = (lang) => I18N[lang === "en" ? "en" : "zh"];

    async function bridgeDescribe() {
      const r = await fetch(`${BRIDGE}/describe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return r.json();
    }
    async function bridgeSync(body) {
      const r = await fetch(`${BRIDGE}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      return r.json();
    }
    async function bridgeMutate(ns, ops, expectedRevision) {
      const r = await fetch(`${BRIDGE}/mutate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ns, ops, expectedRevision }) });
      return r.json();
    }
    async function bridgeUsage(baseURL) {
      const r = await fetch(`${BRIDGE}/usage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseURL ? { baseURL } : {}) });
      return r.json();
    }

    function UsageStat({ label, value, sub }) {
      return react.createElement("div", { className: "cps-field", style: { flex: "1 1 140px", minWidth: 0 } },
        react.createElement("span", { className: "cps-label" }, label),
        react.createElement("span", { className: "cps-ok", style: { fontSize: 15, fontWeight: 600 } }, value),
        sub ? react.createElement("span", { className: "cps-hint" }, sub) : null);
    }

    function UsageWindow({ label, used, cap, exceeded, resetAt, t }) {
      const ratio = cap > 0 ? Math.max(0, Math.min(1, used / cap)) : 0;
      return react.createElement("div", { className: "cps-field", style: { flex: "1 1 180px", minWidth: 0 } },
        react.createElement("label", { className: "cps-label" },
          label,
          exceeded ? react.createElement("span", { className: "cps-err", style: { marginLeft: 6 } }, t.usageExceeded) : null),
        react.createElement("div", { style: { height: 6, borderRadius: 3, background: "var(--dsw-alias-interactive-bg-hover)" } },
          react.createElement("div", {
            style: {
              height: "100%", width: `${ratio * 100}%`, borderRadius: 3,
              background: exceeded ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary, #7ddb9c)",
            },
          })),
        react.createElement("span", { className: "cps-hint" },
          cap > 0 ? `${fmtMoney(used)} / ${fmtMoney(cap)}` : fmtMoney(used),
          resetAt > 0 ? ` · ${fmtReset(resetAt)}` : ""));
    }

    function UsageReportView({ report, t }) {
      const account = report.account;
      const accountName = account ? (account.userName || account.name || "") : "";
      const usage = report.usage;
      const credits = report.credits;
      const plan = report.plan;
      const planStatus = plan && plan.status && plan.status !== "active" ? plan.status : "";
      const showPeriod = plan && plan.currentPeriodEnd > 0;
      const showPartial = report.failures.length > 0 && !report.blocked;
      const children = [];

      if (report.blocked) {
        const title = report.blocked === "invalid-key" ? t.usageBlockedKey
          : report.blocked === "service-unavailable" ? t.usageBlockedSvc : t.usageBlockedNet;
        const hint = report.blocked === "invalid-key" ? t.usageBlockedKeyHint
          : report.blocked === "service-unavailable" ? t.usageBlockedSvcHint : t.usageBlockedNetHint;
        children.push(react.createElement("div", { key: "blocked", className: "cps-err", role: "alert" },
          react.createElement("div", { style: { fontWeight: 600 } }, title),
          react.createElement("div", { style: { marginTop: 2 } }, hint)));
      }
      if (accountName) {
        children.push(react.createElement("span", { key: "account", className: "cps-hint" }, accountName));
      }
      if (usage) {
        children.push(react.createElement("div", { key: "stats", className: "cps-row", style: { alignItems: "stretch" } },
          react.createElement(UsageStat, { label: t.usageRequests, value: String(usage.completedCount), sub: `${t.usageFailed} ${usage.failedCount}` }),
          react.createElement(UsageStat, { label: t.usageSuccessRate, value: `${usage.successRate}%` }),
          react.createElement(UsageStat, { label: t.usageCost, value: fmtMoneyExact(usage.totalCost), sub: `${fmtMoney(usage.totalCredits)} credits` }),
          react.createElement(UsageStat, {
            label: t.usageTokens,
            value: fmtTokens(usage.totalTokensIn + usage.totalTokensOut),
            sub: `${fmtTokens(usage.totalTokensIn)} ${t.usageTokensIn} / ${fmtTokens(usage.totalTokensOut)} ${t.usageTokensOut}`,
          })));
      }
      if (credits) {
        children.push(react.createElement("div", { key: "credits", className: "cps-row" },
          react.createElement(UsageStat, { label: t.usageMonthly, value: fmtMoney(credits.monthlyCredits) }),
          react.createElement(UsageStat, { label: t.usagePurchased, value: fmtMoney(credits.purchasedCredits) }),
          react.createElement(UsageStat, { label: t.usageFree, value: fmtMoney(credits.freeCredits) })));
        children.push(react.createElement("div", { key: "windows", className: "cps-row", style: { alignItems: "stretch" } },
          react.createElement(UsageWindow, {
            label: t.usageFiveHour, used: credits.fiveHour.used, cap: credits.fiveHour.cap,
            exceeded: credits.fiveHour.exceeded, resetAt: credits.fiveHour.resetAt, t,
          }),
          react.createElement(UsageWindow, {
            label: t.usageWeekly, used: credits.weekly.used, cap: credits.weekly.cap,
            exceeded: credits.weekly.exceeded, resetAt: credits.weekly.resetAt, t,
          })));
      }
      const metaBits = [];
      if (showPeriod) metaBits.push(`${t.usagePeriodEnd} ${new Date(plan.currentPeriodEnd).toLocaleDateString()}`);
      if (showPartial) metaBits.push(t.usagePartial);
      if (planStatus) metaBits.push(planStatus);
      if (metaBits.length > 0) {
        children.push(react.createElement("div", { key: "meta", className: "cps-hint" }, metaBits.join(" · ")));
      }
      return react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, ...children);
    }

    function CommandcodePlanSyncCard() {
      const [open, setOpen] = react.useState(false);
      const [state, setState] = react.useState({ status: "loading" });
      const [lang, setLang] = react.useState("zh");
      const [sourceURL, setSourceURL] = react.useState(DEFAULT_SOURCE_URL);
      const [catalogURL, setCatalogURL] = react.useState(DEFAULT_CATALOG_URL);
      const [plan, setPlan] = react.useState("goat");
      const [extraIds, setExtraIds] = react.useState("");
      const [includeEfforts, setIncludeEfforts] = react.useState(false);
      const [autoSync, setAutoSync] = react.useState(false);
      const [intervalMs, setIntervalMs] = react.useState(6 * 60 * 60 * 1000);
      const [webSearch, setWebSearch] = react.useState(false);
      const [usageBaseURL, setUsageBaseURL] = react.useState("");
      const [usage, setUsage] = react.useState({ status: "idle", report: undefined, error: undefined, fetchedAt: undefined });
      const [revision, setRevision] = react.useState(undefined);
      const [dirty, setDirty] = react.useState(false);
      const [saving, setSaving] = react.useState(false);
      const [syncing, setSyncing] = react.useState(false);
      const [msg, setMsg] = react.useState(null);
      const [targets, setTargets] = react.useState({
        openai: { existing: false, count: 0, key: providerName("goat", "openai") },
        anthropic: { existing: false, count: 0, key: providerName("goat", "anthropic") },
      });

      const t = tt(lang);

      const load = react.useCallback(async () => {
        try {
          const res = await bridgeDescribe();
          if (!res.ok) { setState({ status: "error", error: res.message ?? "describe failed" }); return; }
          const view = res.value.namespaces.find((n) => n.ns === NS);
          if (view) {
            const v = view.value ?? {};
            setSourceURL(v.sourceURL ?? DEFAULT_SOURCE_URL);
            setCatalogURL(v.catalogURL ?? DEFAULT_CATALOG_URL);
            setPlan(v.plan ?? "goat");
            setExtraIds(Array.isArray(v.extraIds) ? v.extraIds.join(", ") : "");
            setIncludeEfforts(Boolean(v.includeReasoningEfforts));
            setAutoSync(Boolean(v.autoSync));
            setIntervalMs(typeof v.autoSyncIntervalMs === "number" ? v.autoSyncIntervalMs : 6 * 60 * 60 * 1000);
            setWebSearch(Boolean(v.webSearch));
            setLang(v.lang === "en" ? "en" : "zh");
            setRevision(view.revision);
          }
          if (typeof res.value.usageBaseURL === "string") setUsageBaseURL(res.value.usageBaseURL);
          if (res.value.targets) setTargets(res.value.targets);
          setState({ status: "ready" });
          setDirty(false);
          setMsg(null);
        } catch (e) {
          setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }, []);

      react.useEffect(() => { load(); }, [load]);

      // Auto-fetch usage the first time the card expands (only when a report
      // has never loaded); later refreshes are explicit.
      react.useEffect(() => {
        if (open && usage.status === "idle") doRefreshUsage();
      }, [open]);

      const doSave = async () => {
        setSaving(true);
        setMsg(null);
        try {
          const ops = [
            { op: "set", path: ["sourceURL"], value: sourceURL },
            { op: "set", path: ["catalogURL"], value: catalogURL },
            { op: "set", path: ["plan"], value: ["goat", "pro", "max"].includes(plan) ? plan : "goat" },
            { op: "set", path: ["extraIds"], value: extraIds.split(",").map((s) => s.trim()).filter(Boolean) },
            { op: "set", path: ["includeReasoningEfforts"], value: Boolean(includeEfforts) },
            { op: "set", path: ["autoSync"], value: Boolean(autoSync) },
            { op: "set", path: ["autoSyncIntervalMs"], value: Number(intervalMs) },
            { op: "set", path: ["webSearch"], value: Boolean(webSearch) },
            // Always write the field: a cleared input must also clear a stored override.
            { op: "set", path: ["usageBaseURL"], value: usageBaseURL.trim() },
          ];
          const r = await bridgeMutate(NS, ops, revision);
          if (!r.ok) { setMsg({ kind: "err", text: t.fail(r.message ?? r.code ?? "save failed") }); return; }
          setRevision(r.value.revision);
          setDirty(false);
          setMsg({ kind: "ok", text: "✓ 已保存" });
        } catch (e) {
          setMsg({ kind: "err", text: t.fail(e instanceof Error ? e.message : String(e)) });
        } finally { setSaving(false); }
      };

      const doSync = async (dryRun) => {
        setSyncing(true);
        setMsg(null);
        try {
          const r = await bridgeSync({ dryRun: Boolean(dryRun) });
          if (!r.ok) { setMsg({ kind: "err", text: t.fail(r.message ?? r.code ?? "sync failed") }); return; }
          if (r.value.dryRun) {
            setMsg({ kind: "ok", text: t.preview(r.value.openai?.count ?? 0, r.value.anthropic?.count ?? 0) });
            return;
          }
          setMsg({ kind: "ok", text: t.ok(r.value.results ?? []) });
          // refresh target status
          const d = await bridgeDescribe();
          if (d.ok && d.value.targets) setTargets(d.value.targets);
        } catch (e) {
          setMsg({ kind: "err", text: t.fail(e instanceof Error ? e.message : String(e)) });
        } finally { setSyncing(false); }
      };

      const doRefreshUsage = async () => {
        setUsage((prev) => ({ ...prev, status: "loading", error: undefined }));
        try {
          const r = await bridgeUsage(usageBaseURL || undefined);
          if (!r.ok) {
            setUsage((prev) => ({ ...prev, status: "error", error: r.message ?? r.code ?? "usage failed" }));
            return;
          }
          setUsage({ status: "ready", report: r.value, error: undefined, fetchedAt: Date.now() });
        } catch (e) {
          setUsage((prev) => ({ ...prev, status: "error", error: e instanceof Error ? e.message : String(e) }));
        }
      };

      if (state.status === "loading") {
        return react.createElement("li", { className: "cps-card" },
          react.createElement("div", { className: "cps-body" }, "Loading…"));
      }
      if (state.status === "error") {
        return react.createElement("li", { className: "cps-card" },
          react.createElement("div", { className: "cps-body" },
            react.createElement("div", { className: "cps-err" }, state.error),
            react.createElement("button", { className: "cps-btn", onClick: load }, "Retry")));
      }

      const intervalOptions = [
        { v: 60 * 60 * 1000, label: "1h" },
        { v: 6 * 60 * 60 * 1000, label: "6h" },
        { v: 12 * 60 * 60 * 1000, label: "12h" },
        { v: 24 * 60 * 60 * 1000, label: "24h" },
      ];

      return react.createElement("li", { className: "cps-card" },
        react.createElement("button", { className: "cps-header", onClick: () => setOpen(!open), "aria-expanded": open },
          react.createElement("span", { className: "cps-headText" },
            react.createElement("span", { className: "cps-name" }, t.title),
            react.createElement("span", { className: "cps-desc" }, t.desc)),
          dirty ? react.createElement("span", { className: "cps-badge" }, t.unsaved) : null,
          react.createElement("span", { className: "cps-chevron" + (open ? " cps-chevronOpen" : "") }, "▾"),
          react.createElement("span", { style: { flex: "none" } },
            react.createElement("button", {
              type: "button",
              className: "cps-btn",
              style: { padding: "2px 8px", fontSize: 11 },
              onClick: (e) => { e.stopPropagation(); setLang(lang === "zh" ? "en" : "zh"); },
            }, t.toggleLang))),
        open ? react.createElement("div", { className: "cps-body" },
          // status
          react.createElement("div", { className: "cps-row" },
            react.createElement("span", { className: "cps-label" }, t.status + ":"),
            targets.openai.existing
              ? react.createElement("span", { className: "cps-ok" }, t.created(targets.openai.key, targets.openai.count))
              : react.createElement("span", { className: "cps-hint" }, t.notCreated),
            targets.anthropic.existing
              ? react.createElement("span", { className: "cps-ok" }, t.created(targets.anthropic.key, targets.anthropic.count))
              : null,
            react.createElement("span", { style: { flex: 1 } }),
          ),
          // primary action
          react.createElement("div", { className: "cps-row" },
            react.createElement("button", { className: "cps-btn cps-btnPrimary", disabled: syncing, onClick: () => doSync(false) },
              syncing ? t.syncing : t.sync),
            react.createElement("button", { className: "cps-btn", disabled: syncing, onClick: () => doSync(true) }, t.dryRun),
          ),
          msg ? react.createElement("div", { className: msg.kind === "ok" ? "cps-ok" : "cps-err" }, msg.text) : null,
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label" }, t.plan),
            react.createElement("select", {
              className: "cps-select", value: plan,
              onChange: (e) => { setPlan(e.target.value); setDirty(true); },
            }, PLAN_OPTIONS.map((o) => react.createElement("option", { key: o.value, value: o.value }, lang === "en" ? o.labelEn : o.labelZh))),
            react.createElement("p", { className: "cps-hint" }, t.planHint(plan))),
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label" }, t.sourceURL),
            react.createElement("input", {
              className: "cps-input", value: sourceURL,
              onChange: (e) => { setSourceURL(e.target.value); setDirty(true); },
            })),
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label" }, t.catalogURL),
            react.createElement("input", {
              className: "cps-input", value: catalogURL,
              onChange: (e) => { setCatalogURL(e.target.value); setDirty(true); },
            }),
            react.createElement("p", { className: "cps-hint" }, t.catalogHint)),
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label" }, t.extraIds),
            react.createElement("input", {
              className: "cps-input", value: extraIds,
              onChange: (e) => { setExtraIds(e.target.value); setDirty(true); },
              placeholder: "deepseek/deepseek-v4-pro",
            }),
            react.createElement("p", { className: "cps-hint" }, t.extraHint)),
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label", style: { display: "flex", gap: 8, alignItems: "center" } },
              react.createElement("input", { type: "checkbox", checked: includeEfforts, onChange: (e) => { setIncludeEfforts(e.target.checked); setDirty(true); } }),
              t.includeEfforts),
            react.createElement("p", { className: "cps-hint" }, t.includeEffortsHint)),
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label", style: { display: "flex", gap: 8, alignItems: "center" } },
              react.createElement("input", { type: "checkbox", checked: autoSync, onChange: (e) => { setAutoSync(e.target.checked); setDirty(true); } }),
              t.autoSync),
            react.createElement("p", { className: "cps-hint" }, t.autoHint)),
          autoSync ? react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label" }, t.interval),
            react.createElement("select", {
              className: "cps-select", value: String(intervalMs),
              onChange: (e) => { setIntervalMs(Number(e.target.value)); setDirty(true); },
            }, intervalOptions.map((o) => react.createElement("option", { key: o.v, value: String(o.v) }, o.label)))) : null,
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label", style: { display: "flex", gap: 8, alignItems: "center" } },
              react.createElement("input", { type: "checkbox", checked: webSearch, onChange: (e) => { setWebSearch(e.target.checked); setDirty(true); } }),
              t.webSearch),
            react.createElement("p", { className: "cps-hint" }, t.webSearchHint)),
          react.createElement("div", { className: "cps-field" },
            react.createElement("label", { className: "cps-label" }, t.usageBase),
            react.createElement("input", {
              className: "cps-input", value: usageBaseURL,
              placeholder: DEFAULT_ALPHA_BASE_URL,
              onChange: (e) => { setUsageBaseURL(e.target.value.trim()); setDirty(true); },
            }),
            react.createElement("p", { className: "cps-hint" }, t.usageBaseHint)),
          // account usage
          react.createElement("div", { className: "cps-row" },
            react.createElement("span", { className: "cps-label" }, t.usage + ":"),
            react.createElement("span", { style: { flex: 1 } }),
            react.createElement("button", {
              className: "cps-btn", disabled: usage.status === "loading",
              onClick: doRefreshUsage,
            }, usage.status === "loading" ? t.usageRefreshing : t.usageRefresh)),
          usage.status === "error"
            ? react.createElement("div", { className: "cps-err" },
                `${t.usageError}${usage.error ? ` — ${usage.error}` : ""}`)
            : null,
          usage.status === "loading"
            ? react.createElement("p", { className: "cps-hint" }, t.usageLoading)
            : null,
          usage.report
            ? react.createElement(UsageReportView, { report: usage.report, t })
            : null,
          react.createElement("div", { className: "cps-row", style: { justifyContent: "flex-end" } },
            dirty ? react.createElement("button", { className: "cps-btn", disabled: saving, onClick: load }, t.discard) : null,
            react.createElement("button", {
              className: "cps-btn" + (dirty ? " cps-btnPrimary" : ""),
              disabled: !dirty || saving,
              onClick: doSave,
            }, saving ? t.saving : t.save)),
        ) : null);
    }

    exports.inject = ["slots", "locale", "connection", "remote", "settingsScope"];
    exports.apply = function apply(ctx) {
      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        key: NS,
        locale: "settings.commandcodeProvider",
        inject: () => ({}),
      }, CommandcodePlanSyncCard));
    };
    return module.exports;
  },
});