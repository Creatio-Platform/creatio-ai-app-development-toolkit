// FOUR ROW KINDS THAT WOULD READ "☐ confirm on-stand" ARE MACHINE ROWS. Measured on the
// Applicants run: 18 of the plan's rows were sent to a person while get-page already carried the answer — the
// handler source (`bundle.handlers`), the view-model attributes (`bundle.viewModelConfig`), the containers
// (fields / grids per tab), the template's native card buttons. Imported and run by `run-mapper.mjs`, which hands
// it its `check` and the shared fixtures so the tally stays one number.
export function runMachineRowChecks({ check, verifyCtx, resolveVk, renderVerify, checklistGroups, m12Run, m12Opts, m12Built, m12Page, M12_NAMED, lpRun, lpOpts }) {
  const page = (extra = {}) => ({ parentSchemaName: "FormPageTemplate", packageName: "UsrX", entitySchemaName: "X", schemaUId: "11111111-1111-4111-8111-111111111111",
    viewConfig: { items: [
      { type: "crt.FlexContainer", name: "SideContainer", items: [{ type: "crt.GridContainer", name: "ContactContainer", items: [
        { type: "crt.ComboBox", name: "ContactField", control: "$Contact" }, { type: "crt.Input", name: "PhoneField", control: "$Phone" }] }] },
      { type: "crt.TabPanel", name: "Tabs", items: [
        { type: "crt.TabContainer", name: "GeneralInfoTab", caption: "#ResourceString(BasicInformationTabCaption)#", items: [{ type: "crt.Input", name: "NotesField", control: "$Notes" }] },
        { type: "crt.TabContainer", name: "HistoryTab", caption: "#ResourceString(HistoryTabCaption)#", items: [{ type: "crt.DataGrid", name: "GridDetail_stages", items: "$Stages" }] },
        { type: "crt.TabContainer", name: "NextStepsTabContainer", caption: "#ResourceString(NextStepsCaption)#", items: [{ type: "crt.NextSteps", name: "NextSteps" }] }] },
      { type: "crt.EntityStageProgressBar", name: "Bar" }, { type: "crt.Feed", name: "Feed" },
      { type: "crt.Button", name: "CardActionsBtn" }, { type: "crt.Button", name: "ReloadDataBtn" }, { type: "crt.TagSelect", name: "TagSelect" },
    ] }, ...extra });
  const HANDLERS = `[{ request: "crt.HandleViewModelAttributeChangeRequest", handler: async (request, next) => {
      if (request.attributeName === "Contact") { await reloadCommunicationOptions(request); } return next?.handle(request); } },
    { request: "crt.SaveRecordRequest", handler: async (request, next) => { const r = await next?.handle(request); await onSaved(request); return r; } }]`;
  const full = page({ handlers: HANDLERS, viewModelConfig: { attributes: { Contact: {}, Department: { value: "" } } } });
  const ctx = verifyCtx({ pages: { main: full } }, "main");
  const flat = verifyCtx({ pages: { main: page() } }, "main");
  const st = (r) => r[0], ev = (r) => r[1];

  // handlers
  const H = (method, parent, triggers, c = ctx) => resolveVk({ type: "handler", method, parent, triggers }, c);
  const trigContact = [{ kind: "attribute-dependency", attribute: "Contact" }];
  check("handler: a handler that NAMES the Classic method closes the row ✅",
    () => st(H("onSaved", null, [])) === "✅ Done" && /defines or calls `onSaved`/.test(ev(H("onSaved", null, []))), () => H("onSaved", null, []));
  check("handler: a port that dropped the method name but BRANCHES on its Classic trigger attribute closes the row ✅ (the measured shape: setContactInfo became reloadCommunicationOptions under attributeName === Contact)",
    () => st(H("onContactChange", null, trigContact)) === "✅ Done" && /branches on attribute `Contact`/.test(ev(H("onContactChange", null, trigContact))),
    () => H("onContactChange", null, trigContact));
  check("handler: a helper folded under a caller closes when the caller does (by name or by trigger) — one port, two plan rows",
    () => st(H("setContactInfo", "onContactChange", trigContact)) === "✅ Done"
      && st(H("helper", "onSaved", [])) === "✅ Done" && /ported with `onSaved`/.test(ev(H("helper", "onSaved", []))),
    () => [H("setContactInfo", "onContactChange", trigContact), H("helper", "onSaved", [])]);
  check("handler (guard): a method with no name match and no trigger branch is non-gating confirm-on-stand, never ❌ — a port under another name or as a declarative rule is legitimate, and the text says what to record",
    () => { const r = H("getEmailDetailFilter", null, []); return r[2] === "skip" && /confirm on-stand/.test(st(r)) && /record how it was ported/.test(ev(r)); },
    () => H("getEmailDetailFilter", null, []));
  check("handler (guard): no `handlers` slot ⇒ non-gating confirm-on-stand, naming the slot to pass — never a false ✅ or ❌",
    () => { const r = H("onSaved", null, [], flat); return r[2] === "skip" && /handlers not provided/.test(ev(r)); }, () => H("onSaved", null, [], flat));

  // view-model attributes
  check("vmattr: a virtual attribute present in viewModelConfig.attributes is ✅; one absent (payload present) is ⚠; NO viewModelConfig ⇒ NON-gating confirm-on-stand (skip), symmetric with the handler resolver — an OPTIONAL slot must never hard-gate the run",
    () => st(resolveVk({ type: "vmattr", name: "Department" }, ctx)) === "✅ Done"
      && st(resolveVk({ type: "vmattr", name: "StaffUnit" }, ctx)) === "⚠ verify"
      && (() => { const r = resolveVk({ type: "vmattr", name: "Department" }, flat); return r[2] === "skip" && /view-model attributes not provided/.test(r[1]); })(),
    () => [resolveVk({ type: "vmattr", name: "Department" }, ctx), resolveVk({ type: "vmattr", name: "StaffUnit" }, ctx), resolveVk({ type: "vmattr", name: "Department" }, flat)]);

  // layout
  const L = (vk, c = ctx) => resolveVk({ type: "layout", fields: 0, lists: 0, widgets: [], ...vk }, c);
  check("layout: the side profile is measured in the Side*/Profile* container — 2 fields there ✅, 3 expected ⚠ naming the shortfall",
    () => st(L({ region: "side", fields: 2 })) === "✅ Done" && /in `SideContainer`: 2 fields/.test(ev(L({ region: "side", fields: 2 })))
      && /2\/3 fields/.test(ev(L({ region: "side", fields: 3 }))), () => [L({ region: "side", fields: 2 }), L({ region: "side", fields: 3 })]);
  {
    const c2 = verifyCtx({ pages: { main: full } }, "main");   // fresh ctx — claiming is per-ctx
    const M = (vk) => resolveVk({ type: "layout", fields: 0, lists: 0, widgets: [], ...vk }, c2);
    const basic = M({ region: "tab", caption: "Basic information", fields: 1 });
    const history = M({ region: "tab", caption: "History", lists: 1 });
    const next = M({ region: "tab", caption: "Next steps", widgets: ["crt.NextSteps"] });
    const payments = M({ region: "tab", caption: "Payments", fields: 1 });
    check("layout: a tab is found by the plan's CAPTION WORDS against the built tab's caption binding or name (Basic information -> BasicInformationTabCaption) and measured inside it — fields, related lists, widgets; an unknown caption is unverified naming the tabs that exist",
      () => basic[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(basic[1]) && history[0] === "✅ Done" && next[0] === "✅ Done"
        && /no unclaimed tab whose caption or name matches "Payments"/.test(payments[1]),
      () => [basic, history, next, payments]);
  }
  check("layout: the header is judged by its widgets anywhere on the page; a payload with NO containers (the legacy flat ops shape) is judged page-wide and SAYS so — every fixture built that way stays green",
    () => {
      if (st(L({ region: "header", widgets: ["crt.EntityStageProgressBar", "crt.Feed"] })) !== "✅ Done") return false;
      const f = verifyCtx({ pages: { main: { ...page(), viewConfig: { items: [{ type: "crt.Input", name: "A" }, { type: "crt.Input", name: "B" }] } } } }, "main");
      const r = L({ region: "side", fields: 2 }, f);
      return st(r) === "✅ Done" && /page as a whole/.test(ev(r));
    }, () => L({ region: "header", widgets: ["crt.EntityStageProgressBar", "crt.Feed"] }));

  // native card actions
  check("cardnative: the template's native controls are matched by element name (CardActionsBtn / ReloadDataBtn / TagSelect) — all three ✅, a missing one named",
    () => st(resolveVk({ type: "cardnative", names: ["ViewOptions", "ReloadData", "Tag"] }, ctx)) === "✅ Done"
      && /missing: Print/.test(ev(resolveVk({ type: "cardnative", names: ["ViewOptions", "Print"] }, ctx))),
    () => [resolveVk({ type: "cardnative", names: ["ViewOptions", "ReloadData", "Tag"] }, ctx), resolveVk({ type: "cardnative", names: ["ViewOptions", "Print"] }, ctx)]);

  // the checklist publishes them + the info row + the dropped twin
  const g = checklistGroups(m12Run, m12Opts).flatMap((x) => x.rows);
  check("checklist: every Layout row carries a `layout` vk, every handler row a `handler` vk with the method's triggers, the native card-actions row a `cardnative` vk — none of them is vk-less any more",
    () => g.filter((r) => /^(Side profile|Tab · |Header) — /.test(r.label)).every((r) => r.vk?.type === "layout")
      && g.filter((r) => r.label.startsWith("Handler — ")).every((r) => r.vk?.type === "handler" && Array.isArray(r.vk.triggers))
      && g.filter((r) => r.label.startsWith("Card actions — native")).every((r) => r.vk?.type === "cardnative"),
    () => g.filter((r) => /^(Side profile|Tab · |Header|Handler|Card actions — native)/.test(r.label)).map((r) => [r.label, r.vk?.type]));
  // A result carrying a module-dep member: its checklist row is informational and renders ℹ noted, NOT confirm.
  // Self-contained (does not depend on the shared fixture producing one), so the info path is actually exercised.
  {
    const depResult = { entity: "X", changeSet: { needsDecision: [{ kind: "module-dep", item: "ConfigurationConstants, BusinessRuleModule" }] } };
    const depRow = checklistGroups(depResult, {}).flatMap((x) => x.rows).find((r) => r.label.startsWith("[module-dep]"));
    const v = renderVerify(depResult, {}, { pages: { main: { viewConfig: { items: [] } } } });
    const vr = v.rows.find((r) => r.deliverable.startsWith("[module-dep]"));
    check("checklist: a [module-dep] row is INFORMATIONAL — the checklist row carries `info` (not a vk), and renderVerify emits it as noted / kind info / outcome skip, never confirm and never against the verdict",
      () => !!depRow && !!depRow.info && !depRow.vk && !!vr && vr.kind === "info" && vr.status === "ℹ noted" && vr.outcome === "skip",
      () => ({ depRow, vr }));
  }
  check("checklist: when the list page publishes its gated `List template →` row, the Pages group does NOT carry the ungated `List page →` twin — one fact, one row",
    () => {
      const rows = checklistGroups(lpRun, lpOpts).flatMap((x) => x.rows);
      const gated = rows.some((r) => r.vk?.type === "template" && r.label.startsWith("List template"));
      return gated && !rows.some((r) => r.label.startsWith("List page → "));
    }, () => checklistGroups(lpRun, lpOpts).flatMap((x) => x.rows).filter((r) => /^List (page|template)/.test(r.label)).map((r) => [r.label, r.vk?.type]));

  // ===== review guards (adversarial self-review of the same PR) =====
  // (2) handler false-Done: a method named only in a COMMENT or a STRING must NOT close the row — the match is
  // over code with comments and string literals blanked, so only a real definition/call counts.
  {
    const commentOnly = `[{ request: "crt.SaveRecordRequest", handler: async (request, next) => {
      // TODO: port setContactInfo and getRequestStatusFilter later
      const note = "getRequestStatusFilter is not built yet"; return next?.handle(request); } }]`;
    const cctx = verifyCtx({ pages: { main: page({ handlers: commentOnly, viewModelConfig: { attributes: {} } }) } }, "main");
    check("handler (guard): a method whose only occurrence is a COMMENT or a STRING does NOT resolve Done — it stays ⚠ unverified (the false-confirmation direction the raw-text search allowed)",
      () => { const a = resolveVk({ type: "handler", method: "setContactInfo", parent: null, triggers: [] }, cctx);
        const b = resolveVk({ type: "handler", method: "getRequestStatusFilter", parent: null, triggers: [] }, cctx);
        return a[2] === "skip" && b[2] === "skip" && a[0] !== "✅ Done" && b[0] !== "✅ Done"; },
      () => [resolveVk({ type: "handler", method: "setContactInfo", parent: null, triggers: [] }, cctx),
             resolveVk({ type: "handler", method: "getRequestStatusFilter", parent: null, triggers: [] }, cctx)]);
  }
  // (3) tab claiming: two rows with overlapping captions must take DIFFERENT built tabs — the second cannot reuse
  // the first's tab, and a small row is not judged green against an unrelated big tab.
  {
    const twoTabs = { parentSchemaName: "T", packageName: "P", entitySchemaName: "X", schemaUId: "22222222-2222-4222-8222-222222222222",
      viewConfig: { items: [{ type: "crt.TabPanel", name: "Tabs", items: [
        { type: "crt.TabContainer", name: "ContactInformationTab", caption: "#ResourceString(ContactInformationTabCaption)#", items: [
          { type: "crt.Input", name: "AField", control: "$A" }, { type: "crt.Input", name: "BField", control: "$B" }] },
        { type: "crt.TabContainer", name: "ContactTab", caption: "#ResourceString(ContactTabCaption)#", items: [{ type: "crt.Input", name: "CField", control: "$C" }] }] }] } };
    const tctx = verifyCtx({ pages: { main: twoTabs } }, "main");
    const r1 = resolveVk({ type: "layout", region: "tab", caption: "Contact information", fields: 2, lists: 0, widgets: [] }, tctx);
    const r2 = resolveVk({ type: "layout", region: "tab", caption: "Contact", fields: 1, lists: 0, widgets: [] }, tctx);
    check("layout (guard): two overlapping-caption rows claim DIFFERENT tabs — 'Contact information' takes ContactInformationTab, 'Contact' takes the remaining ContactTab, neither reused",
      () => r1[2] === "ok" && /ContactInformationTab/.test(r1[1]) && r2[2] === "ok" && /ContactTab/.test(r2[1]) && !/ContactInformationTab/.test(r2[1]),
      () => [r1, r2]);
  }
  // (1) header with a field count present: the field/list legs do not apply to the header, so a header row with
  // fields:2 still passes once its widgets are on the page — the blocker was judging that against an empty container.
  check("layout (guard): a header row carrying fields:2 passes when its widgets are present — the header is judged on widgets, not field counts",
    () => st(L({ region: "header", fields: 2, widgets: ["crt.Feed"] })) === "✅ Done",
    () => L({ region: "header", fields: 2, widgets: ["crt.Feed"] }));

  // ===== token-boundary and name-collision guards =====
  // RC-2/11 cardnative: `/Tag/i` substring-matches `StageProgressBar` ("stage" contains "tag"), closing a Tag
  // control that was never built. Token-boundary matching must reject Stage* and still accept a real TagSelect.
  {
    const stageOnly = verifyCtx({ pages: { main: { ...page(), viewConfig: { items: [
      { type: "crt.EntityStageProgressBar", name: "StageProgressBar" }, { type: "crt.Input", name: "StageField", control: "$Stage" }] } } } }, "main");
    const tagMiss = resolveVk({ type: "cardnative", names: ["Tag"] }, stageOnly);
    const tagHit = resolveVk({ type: "cardnative", names: ["Tag"] }, ctx);   // ctx carries a real TagSelect
    check("cardnative (guard): a `Tag` control does NOT close against `StageProgressBar` / `StageField` (substring 'tag' is not a token) — a real `TagSelect` still closes ✅",
      () => tagMiss[2] === "unverified" && /missing: Tag/.test(tagMiss[1]) && st(tagHit) === "✅ Done",
      () => [tagMiss, tagHit]);
  }
  // RC-3/14 layout: a region row with nothing machine-measurable (no fields/lists/recognised widgets) must NOT read ✅.
  check("layout (guard): a header row with fields:2 and NO recognised widget is non-gating confirm-on-stand (skip), never a false ✅ over an unchecked region",
    () => { const r = L({ region: "header", fields: 2, widgets: [] }); return r[2] === "skip" && /no recognised widget/.test(ev(r)); },
    () => L({ region: "header", fields: 2, widgets: [] }));
  check("layout (guard): a side/tab region row with no fields, lists or widgets is confirm-on-stand (skip), never ✅ Done",
    () => L({ region: "side", fields: 0, lists: 0, widgets: [] })[2] === "skip",
    () => L({ region: "side" }));
  // RC-4/12 handler: a denylisted platform name (`handle`) must NOT close on Freedom boilerplate `next?.handle(request)`.
  {
    const boiler = `[{ request: "crt.SaveRecordRequest", handler: async (request, next) => { return next?.handle(request); } }]`;
    const bctx = verifyCtx({ pages: { main: page({ handlers: boiler, viewModelConfig: { attributes: {} } }) } }, "main");
    const r = resolveVk({ type: "handler", method: "handle", parent: null, triggers: [] }, bctx);
    check("handler (guard): a Classic method named `handle` is NOT closed by boilerplate `next?.handle(request)` — a denylisted platform name degrades to confirm-on-stand (skip)",
      () => r[2] === "skip" && /confirm on-stand/.test(r[0]), () => r);
  }
  // RC-10 the four new resolvers' D6 tri-state: a page key never supplied is NON-gating (outcome not `missing`); a
  // page reported `false` is a hard ❌ MISSING. Neither branch was exercised before.
  {
    const omitted = verifyCtx({ pages: {} }, "main");
    const notBuilt = verifyCtx({ pages: { main: false } }, "main");
    const kinds = [
      ["handler", { type: "handler", method: "onSaved", triggers: [] }],
      ["vmattr", { type: "vmattr", name: "Contact" }],
      ["layout", { type: "layout", region: "side", fields: 1, lists: 0, widgets: [] }],
      ["cardnative", { type: "cardnative", names: ["Tag"] }],
    ];
    check("resolvers (guard, D6 tri-state): for handler/vmattr/layout/cardnative a page key that was never supplied is NON-gating (outcome ≠ missing), while a page reported `false` is a hard ❌ MISSING",
      () => kinds.every(([, vk]) => resolveVk(vk, omitted)[2] !== "missing" && resolveVk(vk, notBuilt)[2] === "missing"),
      () => kinds.map(([n, vk]) => [n, resolveVk(vk, omitted)[2], resolveVk(vk, notBuilt)[2]]));
  }
  // RC-10 vmattr third branch: an attribute absent from viewModelConfig.attributes but bound by a `<Name>Field`
  // element on the page still closes ✅ (the port-another-way path).
  check("vmattr (guard): an attribute NOT in viewModelConfig.attributes but bound by a `<Name>Field` element closes ✅",
    () => { const r = resolveVk({ type: "vmattr", name: "Phone" }, ctx); return st(r) === "✅ Done" && /bound by a field/.test(ev(r)); },
    () => resolveVk({ type: "vmattr", name: "Phone" }, ctx));

  // Greedy first-match field claiming can strand a name. Expected [Account, Contact]
  // over an op matching BOTH (name Contact, bound Account) and one matching only Account — greedy in this order
  // takes the shared op for Account and reports Contact missing; maximum bipartite matching assigns both.
  {
    const fctx = verifyCtx({ pages: { main: { ...page(), viewConfig: { items: [
      { type: "crt.Input", name: "Contact", control: "$Account" }, { type: "crt.Input", name: "Account" }] } } } }, "main");
    const r = resolveVk({ type: "fields", n: 2, names: ["Account", "Contact"] }, fctx);
    check("(fields): maximum matching finds a full assignment where greedy first-match would strand a name — [Account, Contact] over one op matching both + one matching only Account resolve 2/2 ✅, no false 'missing'",
      () => st(r) === "✅ Done" && /2 of 2 expected fields/.test(ev(r)), () => r);
  }
  // A schema-derived name that collides with an Object.prototype key (`constructor`,
  // `toString`) must NOT crash --verify — the lookups are Maps now, and the fallbacks are boundary-safe.
  check("cardnative / vk lookups on a prototype-key name (`constructor`, `toString`) do not throw and return a normal result triple",
    () => {
      const a = resolveVk({ type: "cardnative", names: ["constructor", "toString"] }, ctx);
      const b = resolveVk({ type: "constructor" }, ctx);   // unknown vk type that is also a prototype key
      return Array.isArray(a) && a.length >= 3 && Array.isArray(b) && b.length >= 3;
    }, () => [resolveVk({ type: "cardnative", names: ["constructor"] }, ctx), resolveVk({ type: "constructor" }, ctx)]);
  // reEsc must escape every regex metacharacter — a method name with metacharacters
  // neither throws nor false-matches a different identifier.
  {
    const src = `[{ request: "r", handler: (request, next) => { aXb(); return next; } }]`;
    const mctx = verifyCtx({ pages: { main: page({ handlers: src, viewModelConfig: { attributes: {} } }) } }, "main");
    const r = resolveVk({ type: "handler", method: "a.b", parent: null, triggers: [] }, mctx);
    check("a handler method name with regex metacharacters (`a.b`) is escaped — it does NOT falsely match `aXb`, so it stays confirm-on-stand (no throw, no false ✅)",
      () => r[2] === "skip", () => r);
  }
  // codeOnly is memoized on the page ctx (verifyCtxFactory caches one ctx per key).
  // Two handler rows against the SAME ctx must both resolve on the shared, once-computed stripped source.
  {
    const c = verifyCtx({ pages: { main: page({ handlers: HANDLERS, viewModelConfig: { attributes: {} } }) } }, "main");
    const r1 = resolveVk({ type: "handler", method: "onSaved", parent: null, triggers: [] }, c);
    const cachedAfterFirst = typeof c._codeOnly === "string";
    const r2 = resolveVk({ type: "handler", method: "onContactChange", parent: null, triggers: [{ kind: "attribute-dependency", attribute: "Contact" }] }, c);
    check("(memoize): two handler rows against ONE page ctx both resolve ✅, and codeOnly is computed once (ctx._codeOnly cached after the first row) — no per-row recompute, outcomes unchanged",
      () => st(r1) === "✅ Done" && st(r2) === "✅ Done" && cachedAfterFirst,
      () => [r1, r2, cachedAfterFirst]);
  }
}
