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
    check("layout: a tab is found by the plan's CAPTION WORDS against the built tab's caption binding or name (Basic information -> BasicInformationTabCaption) and measured inside it — fields, related lists, widgets; an unmatched caption is NON-gating confirm-on-stand (F17: tab captions are localized macros / template-renamed, so a word miss is a placement question, not a machine failure that spawns a repair)",
      () => basic[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(basic[1]) && history[0] === "✅ Done" && next[0] === "✅ Done"
        && payments[2] === "skip" && /no built tab matched the plan caption "Payments" by words/.test(payments[1]),
      () => [basic, history, next, payments]);
  }
  // A plan tab whose built twin carries another caption and holds exactly the plan's fields.
  {
    const SEVEN = ["Name", "Birthday", "Gender", "Email", "Phone", "City", "Position"];
    const fieldsOf = (names) => names.map((n) => ({ type: "crt.Input", name: `${n}Field`, control: `$${n}` }));
    const tabsPage = (tabs, extra = {}) => ({ ...page(), viewConfig: { items: [{ type: "crt.TabPanel", name: "Tabs", items: tabs }] }, ...extra });
    const general = { type: "crt.TabContainer", name: "GeneralInfoTab", caption: "#ResourceString(GeneralInfoTabCaption)#", items: fieldsOf(SEVEN) };
    const other = { type: "crt.TabContainer", name: "OtherTab", caption: "#ResourceString(OtherTabCaption)#", items: fieldsOf(["Notes", "Name"]) };
    const T = (entry) => { const c = verifyCtx({ pages: { main: entry } }, "main");
      return (vk) => resolveVk({ type: "layout", region: "tab", fields: 0, lists: 0, widgets: [], ...vk }, c); };
    const basic = { caption: "Basic information", fields: 7, names: SEVEN };
    const M6 = T(tabsPage([other, general], { resources: { GeneralInfoTabCaption: "Основная информация" } }));
    const r6 = M6(basic);
    check("layout: a built tab whose caption differs from the plan's but holds EVERY field the plan puts on that tab matches it, and the evidence says it matched by fields",
      () => r6[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(r6[1]) && /matched by the 7 plan field\(s\)/.test(r6[1]),
      () => r6);
    check("layout: the field-identity match is CLAIMED like a caption match — a second row naming the same fields finds no unclaimed tab and falls to confirm-on-stand",
      () => M6(basic)[2] === "skip" && /no unclaimed tab holds exactly its 7 fields/.test(M6(basic)[1]), () => M6(basic));
    const M6b = T(tabsPage([general, { type: "crt.TabContainer", name: "BasicTab", caption: "Basic information", items: fieldsOf(["Name"]) }]));
    const r6b = M6b(basic);
    check("layout (guard): a tab whose CAPTION matches still wins over one that only holds the fields — the field rule scores below every caption match",
      () => /in tab `BasicTab`/.test(r6b[1]) && !/matched by/.test(r6b[1]), () => r6b);
    const r6c = T(tabsPage([{ ...general, items: fieldsOf(SEVEN.slice(0, 6)) }]))(basic);
    const r6d = T(tabsPage([general]))({ caption: "Basic information", fields: 7 });
    check("layout (guard): holding 6 of the 7 fields is no match (confirm-on-stand, not the content fit), and a row that publishes no field names is judged by the exact content fit instead",
      () => r6c[2] === "skip" && /no unclaimed tab holds exactly its 7/.test(r6c[1])
        && r6d[0] === "✅ Done" && /matched by content/.test(r6d[1]) && !/plan field/.test(r6d[1]),
      () => [r6c, r6d]);
    // The built shape of a renamed template tab: the plan's fields plus a widget, inside a same-content grid.
    const wrapped = tabsPage([{ ...general, items: [{ type: "crt.GridContainer", name: "GeneralInfoTabContainer",
      items: [...fieldsOf(SEVEN), { type: "crt.ApprovalList", name: "Approvals" }] }] }]);
    const r6e = T(wrapped)(basic);
    check("layout: a tab holding the plan's fields plus a widget, inside a wrapper grid with the same content, matches by field identity — the tab, not the wrapper",
      () => r6e[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(r6e[1]) && /matched by the 7 plan field/.test(r6e[1]), () => r6e);
    // A plan tab that was never built, its fields placed in another tab's grid: neither row reads green, in either order.
    const DETAILS = ["Notes", "Budget"];
    const merged = () => tabsPage([{ ...general, items: [{ type: "crt.GridContainer", name: "GeneralInfoTabContainer",
      items: fieldsOf([...SEVEN, ...DETAILS]) }] }]);
    const details = { caption: "Payment details", fields: 2, names: DETAILS };
    const M6h = T(merged()), M6i = T(merged());
    const hA = M6h(basic), hB = M6h(details);
    const iB = M6i(details), iA = M6i(basic);
    check("layout (guard): a tab also holding another plan tab's fields matches neither row by field identity, and a grid inside a tab is never a tab candidate — whichever row resolves first",
      () => [hA, hB, iB, iA].every((r) => r[2] === "skip" && !/Done/.test(r[0])), () => [hA, hB, iB, iA]);
    // A tab panel's direct child named as a tab but not a `crt.TabContainer`, and the same content one level deeper.
    const panelChild = T(tabsPage([{ type: "crt.GridContainer", name: "DetailsTab", items: fieldsOf(SEVEN) }]))(basic);
    check("layout: a container named as a tab, a direct child of a `crt.TabPanel` but not a `crt.TabContainer`, holding exactly the row's fields matches by field identity",
      () => panelChild[0] === "✅ Done" && /in tab `DetailsTab`/.test(panelChild[1]) && /matched by the 7 plan field/.test(panelChild[1]),
      () => panelChild);
    const nested = T(tabsPage([{ ...other, items: [...fieldsOf(["Notes"]),
      { type: "crt.GridContainer", name: "InnerGrid", items: fieldsOf(SEVEN) }] }]))(basic);
    check("layout (guard): a container holding exactly the row's fields one level below a tab panel's child, and not a `crt.TabContainer`, is no tab candidate",
      () => nested[2] === "skip" && !/Done/.test(nested[0]) && !/InnerGrid/.test(nested[1]), () => nested);
    const wrong = tabsPage([{ ...general, items: fieldsOf(["A", "B", "C", "D", "E", "F", "G"]) }]);
    const r6f = T(wrong)(basic);
    check("layout (guard): a tab with the plan's field COUNT but other fields is not closed — a row with field names never falls to the count-based content fit",
      () => r6f[2] === "skip" && !/Done/.test(r6f[0]), () => r6f);
    const listsTab = { type: "crt.TabContainer", name: "StagesTab", caption: "#ResourceString(StagesTabCaption)#", items: [{ type: "crt.DataGrid", name: "GridStages", items: "$Stages" }] };
    const r6g = T(tabsPage([listsTab, other]))({ caption: "Recruiting stages", lists: 1 });
    check("layout: a related-list-only tab row (no field names) still matches by the unique exact content fit",
      () => r6g[0] === "✅ Done" && /in tab `StagesTab` \(matched by content/.test(r6g[1]), () => r6g);
    const mainTab = { type: "crt.TabContainer", name: "MainTab", caption: "#ResourceString(MainTabCaption)#", items: fieldsOf(["Name"]) };
    const r7 = T(tabsPage([mainTab], { resources: { MainTabCaption: "Basic information" } }))({ caption: "Basic information", fields: 1 });
    const r7raw = T(tabsPage([mainTab]))({ caption: "Basic information", fields: 1 });
    // get-page's own `bundle.resources` shape.
    const bundleTab = { ...mainTab, name: "GeneralInfoTab", caption: "#ResourceString(BasicInfoTab_caption)#" };
    const r7b = T(tabsPage([bundleTab], { resources: { strings: { BasicInfoTab_caption: { "en-US": "Basic information" },
      GeneralInfoTab_caption: { "ru-RU": "Основная информация", "en-US": "General information" } } } }))({ caption: "Basic information", fields: 1 });
    const keyTab = { ...mainTab, name: "KeyTab", caption: "#ResourceString(BasicInformationTabCaption)#" };
    const r7key = T(tabsPage([keyTab], { resources: { BasicInformationTabCaption: "Profile" } }))({ caption: "Basic information", fields: 1 });
    check("layout (guard): a caption binding whose KEY matches the plan's words still matches by caption when its resolved text reads otherwise",
      () => r7key[0] === "✅ Done" && /in tab `KeyTab`/.test(r7key[1]) && !/matched by/.test(r7key[1]), () => r7key);
    check("layout: a built caption `#ResourceString(K)#` resolves through the page's `resources` before the caption match — flat or get-page's `{ strings: { K: { en-US } } }` — and without them the macro matches no caption, so the row falls to the content fit",
      () => r7[0] === "✅ Done" && /in tab `MainTab`/.test(r7[1]) && !/matched by/.test(r7[1])
        && r7b[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(r7b[1]) && !/matched by/.test(r7b[1])
        && r7raw[0] === "✅ Done" && /matched by content/.test(r7raw[1]) && !/matched by the .* plan field/.test(r7raw[1]),
      () => [r7, r7b, r7raw]);
    // Keys and names that carry none of the plan's caption words, so only the resolved text can match.
    const cultureTab = (name) => ({ ...mainTab, name, caption: `#ResourceString(${name}_caption)#` });
    const byCulture = (strings) => ({ resources: { strings } });
    const r7c = T(tabsPage([cultureTab("Tab1")], byCulture({ Tab1_caption: { "de-DE": "Basic information" } })))({ caption: "Basic information", fields: 1 });
    const r7d = T(tabsPage([cultureTab("Tab1"), cultureTab("Tab2")], byCulture({
      Tab1_caption: { "de-DE": "Basic information", "en-US": "Profile" },
      Tab2_caption: { "de-DE": "Profil", "en-US": "Basic information" } })))({ caption: "Basic information", fields: 1 });
    check("layout: a caption resource with no en-US text resolves through another culture's text, and en-US wins when both exist",
      () => r7c[0] === "✅ Done" && /in tab `Tab1`/.test(r7c[1]) && !/matched by/.test(r7c[1])
        && r7d[0] === "✅ Done" && /in tab `Tab2`/.test(r7d[1]) && !/matched by/.test(r7d[1]),
      () => [r7c, r7d]);
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
  {
    // A custom getActions item is not a template control: it gets its own row, and only the table's own controls
    // fold into the native row — else a page whose template ships every native control reads as missing one.
    const acts = checklistGroups({ entity: "X", changeSet: { cardActions: ["PrintButton", "ViewOptionsButton", "ReloadDataButton", "TagButton", "calculateSaaSMetrics", "RunProcess"] } }, {})
      .flatMap((x) => x.rows).filter((r) => r.label.startsWith("Card action"));
    const native = acts.find((r) => r.label.startsWith("Card actions — native"));
    check("checklist: a custom card action (calculateSaaSMetrics) gets its own `card` row; the native row holds only the template's controls",
      () => native?.vk?.type === "cardnative" && native.vk.names.join() === "ViewOptions,ReloadData,Tag"
        && acts.some((r) => r.label === "Card action — calculateSaaSMetrics" && r.vk?.type === "card")
        && acts.some((r) => r.label === "Card action — RunProcess" && r.vk?.type === "card")
        && acts.some((r) => r.label === "Card action — Print" && r.vk?.type === "card"),
      () => acts.map((r) => [r.label, r.vk]));
    check("cardnative: the Contract native row (ViewOptions / ReloadData / Tag) closes ✅ against a page carrying the template's controls",
      () => st(resolveVk(native.vk, ctx)) === "✅ Done", () => resolveVk(native.vk, ctx));
    const custom = acts.find((r) => r.label === "Card action — calculateSaaSMetrics").vk;
    const withItem = verifyCtx({ pages: { main: { ...page(), viewConfig: { items: [{ type: "crt.Button", name: "ActionButton",
      menuItems: [{ type: "crt.MenuItem", name: "CalculateSaaSMetricsMenuItem" }] }] } } } }, "main");
    check("card: a custom action closes ✅ only on an element named for it — the template's own Actions button alone reads ⚠ verify",
      () => st(resolveVk(custom, ctx)) === "⚠ verify" && /calculateSaaSMetrics/.test(ev(resolveVk(custom, ctx)))
        && st(resolveVk(custom, withItem)) === "✅ Done",
      () => [resolveVk(custom, ctx), resolveVk(custom, withItem)]);
    const builtWith = (item) => verifyCtx({ pages: { main: { ...page(), resources: { MenuItem_calc_caption: "Calculate SaaS metrics" }, viewConfig: { items: [{ type: "crt.Button", name: "ActionButton",
      menuItems: [{ type: "crt.MenuItem", ...item }] }] } } } }, "main");
    const variants = [{ name: "CalculateSaasMetricsMenuItem" }, { name: "CalculateSAASMetricsMenuItem" },
      { name: "MenuItem_calc", caption: "Calculate SaaS metrics" },
      { name: "MenuItem_calc", caption: "#ResourceString(MenuItem_calc_caption)#" },
      { name: "MenuItem_calc", clicked: { request: "usr.CalculateSaaSMetricsRequest" } }];
    check("card: a custom action closes ✅ whatever the casing of the element name, or on a caption / clicked.request that names it",
      () => variants.every((v) => st(resolveVk(custom, builtWith(v))) === "✅ Done")
        && st(resolveVk(custom, builtWith({ name: "MenuItem_other", caption: "Recalculate totals" }))) === "⚠ verify",
      () => variants.map((v) => [v, resolveVk(custom, builtWith(v))]));
    const hinted = checklistGroups({ entity: "X", changeSet: { cardActions: ["printContract", "runApprovalProcess"] } }, {})
      .flatMap((x) => x.rows).filter((r) => r.label.startsWith("Card action"));
    check("checklist: a custom hint containing `print` / `process` still needs an element named for it — the template's Actions button alone reads ⚠ verify",
      () => hinted.length === 2 && hinted.every((r) => r.vk?.type === "card" && r.vk.names?.length === 1)
        && hinted.every((r) => st(resolveVk(r.vk, ctx)) === "⚠ verify"),
      () => hinted.map((r) => [r.label, r.vk, resolveVk(r.vk, ctx)]));
  }
  {
    const tabResult = { entity: "X", changeSet: { resources: { BasicTabCaption: "Basic information" }, viewConfigDiff: [
      { name: "Name", parentName: "BasicGroup", values: { control: "$Name", type: "crt.Input" } },
      { name: "Name_2", parentName: "BasicGroup", values: { control: "$Name", type: "crt.Input" } },
      { name: "BasicGroup", parentName: "BasicTab", values: { type: "crt.GridContainer" } },
      { name: "BasicTab", parentName: "Tabs", propertyName: "items", values: { type: "crt.TabContainer", caption: "#ResourceString(BasicTabCaption)#" } },
    ], standardFeatures: [], details: [], cardActions: [], needsDecision: [] } };
    const tabRow = checklistGroups(tabResult, {}).flatMap((x) => x.rows).find((r) => r.vk?.type === "layout" && r.vk.region === "tab");
    check("checklist: a Tab layout row publishes its fields' element NAMES, one per counted field — what the tab-by-fields match reads",
      () => tabRow?.vk.caption === "Basic information" && tabRow.vk.fields === 2 && tabRow.vk.names.join(",") === "Name,Name_2",
      () => tabRow);
  }
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
  // A virtual attribute whose element is named EXACTLY as the attribute — bare, no `Field` suffix, and NOT the
  // bound column (`StaffUnit` bound `$PDS_RequestStaffUnit_<hash>`) — still closes.
  {
    const c = verifyCtx({ pages: { main: page({ viewConfig: { items: [
      { type: "crt.ComboBox", name: "StaffUnit", control: "$PDS_RequestStaffUnit_ab12cd" }] }, viewModelConfig: { attributes: { Other: {} } } }) } }, "main");
    const r = resolveVk({ type: "vmattr", name: "StaffUnit" }, c);
    check("vmattr: an element named EXACTLY the attribute (bare `StaffUnit`, bound `$PDS_RequestStaffUnit_<hash>`) closes ✅ — the fallback matches the bare name, not only `<Name>Field` / the bound column",
      () => st(r) === "✅ Done", () => r);
  }
  // A native control built as a `crt.MenuItem` under a NON-`items` array (`menuItems` / a button menu) is seen:
  // walkViewConfig recurses every nested child, not only `items`.
  {
    const c = verifyCtx({ pages: { main: page({ viewConfig: { items: [
      { type: "crt.Button", name: "CardActionsButton", menuItems: [{ type: "crt.MenuItem", name: "ReloadDataMenuItem" }] }] } }) } }, "main");
    const r = resolveVk({ type: "cardnative", names: ["ReloadData"] }, c);
    check("cardnative: a `ReloadDataMenuItem` built under `menuItems` (not `items`) is found — walkViewConfig walks every child array, so a built menu control is not reported missing",
      () => st(r) === "✅ Done", () => r);
  }
  // crt.PhoneInput and crt.EmailInput are field types (the plan's "↳ linked (read-only)" MobilePhone/Email recipe):
  // a side profile of exactly those two reads 2 fields.
  {
    const c = verifyCtx({ pages: { main: page({ viewConfig: { items: [
      { type: "crt.FlexContainer", name: "SideContainer", items: [
        { type: "crt.PhoneInput", name: "MobilePhone" }, { type: "crt.EmailInput", name: "Email" }] }] } }) } }, "main");
    const r = resolveVk({ type: "layout", region: "side", fields: 2, lists: 0, widgets: [] }, c);
    check("fields: crt.PhoneInput / crt.EmailInput are field types — a side profile holding exactly those two resolves 2 fields ✅, not an under-count",
      () => st(r) === "✅ Done" && /2 fields/.test(ev(r)), () => r);
  }
  // A caption word-miss falls back to a CONTENT FIT: an unclaimed tab whose fields/lists/widgets satisfy the want
  // closes ✅ and is claimed (the renamed / localized-caption tab). A want no tab can satisfy stays confirm-on-stand.
  {
    const c = verifyCtx({ pages: { main: page() } }, "main");   // GeneralInfoTab holds 1 field (NotesField)
    const hit = resolveVk({ type: "layout", region: "tab", caption: "Zzz No Words Match", fields: 1, lists: 0, widgets: [] }, c);
    const miss = resolveVk({ type: "layout", region: "tab", caption: "Payments Nowhere", fields: 3, lists: 2, widgets: [] }, c);
    check("layout tab content-fit: a caption matching no tab by words but whose want an unclaimed tab satisfies EXACTLY closes ✅ (matched by content); a want no tab satisfies stays confirm-on-stand, never green",
      () => hit[2] === "ok" && /matched by content/.test(hit[1]) && miss[2] === "skip",
      () => [hit, miss]);
  }
  // Content fit is UNAMBIGUOUS-only: a plan tab whose fields merely LAND inside a bigger built sibling (a misplaced /
  // missing tab) must never read green. Page: GeneralInfoTab holds exactly 7 fields; DetailsTab holds 5 fields (3 of
  // them Payments' own); no Payments tab exists. "Basic information" (7) closes ✅ against GeneralInfoTab (exact 7);
  // "Payments" (3) finds no tab whose count is exactly 3 — DetailsTab's 5 does not qualify — so it stays confirm-on-
  // stand. The result is the same whichever row resolves first (exact-size fit is order-independent).
  {
    const f7 = Array.from({ length: 7 }, (_, i) => ({ type: "crt.Input", name: `Gen${i}`, control: `$Gen${i}` }));
    const f5 = Array.from({ length: 5 }, (_, i) => ({ type: "crt.Input", name: `Det${i}`, control: `$Det${i}` }));
    const twoTabs = () => ({ parentSchemaName: "FormPageTemplate", packageName: "UsrX", entitySchemaName: "X", schemaUId: "11111111-1111-4111-8111-111111111111",
      viewConfig: { items: [{ type: "crt.TabPanel", name: "Tabs", items: [
        { type: "crt.TabContainer", name: "GeneralInfoTab", caption: "#ResourceString(BasicInformationTabCaption)#", items: f7 },
        { type: "crt.TabContainer", name: "DetailsTab", caption: "#ResourceString(DetailsTabCaption)#", items: f5 }] }] } });
    const R = (ctx0, cap, fields) => resolveVk({ type: "layout", region: "tab", caption: cap, fields, lists: 0, widgets: [] }, ctx0);
    const a = verifyCtx({ pages: { main: twoTabs() } }, "main");
    const basic = R(a, "Basic information", 7);
    const pay = R(a, "Payments", 3);
    const b = verifyCtx({ pages: { main: twoTabs() } }, "main");   // reverse the order — result must not flip
    const payFirst = R(b, "Payments", 3);
    const basicSecond = R(b, "Basic information", 7);
    check("layout tab content-fit (unambiguous-only): a plan tab whose fields merely land inside a bigger built sibling does not read green — Basic information (7) closes ✅ on the exact-7 tab, Payments (3) finds no exact-count tab and stays confirm-on-stand, and reversing the resolution order gives the same verdicts",
      () => basic[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(basic[1])
        && pay[2] === "skip" && !/✅/.test(pay[0]) && /no single tab fits its content exactly/.test(pay[1])
        && payFirst[2] === "skip" && basicSecond[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(basicSecond[1]),
      () => [basic, pay, payFirst, basicSecond]);
  }
  // The bare-name vmattr leg is type-guarded: a NON-field element sharing the attribute name (a crt.Button named
  // `StaffUnit`) does not close the row.
  {
    const c = verifyCtx({ pages: { main: page({ viewConfig: { items: [
      { type: "crt.Button", name: "StaffUnit" }] }, viewModelConfig: { attributes: { Other: {} } } }) } }, "main");
    const r = resolveVk({ type: "vmattr", name: "StaffUnit" }, c);
    check("vmattr (guard): a non-field element (crt.Button) named exactly as the attribute does NOT close the row — the bare-name leg requires a field type",
      () => r[2] === "unverified", () => r);
  }
  // walkViewConfig recurses ARRAY children only: a `name` buried in a config OBJECT (`clicked.params`) is not an op,
  // so it cannot satisfy a name-based check; a control under a `menuItems` ARRAY still is.
  {
    const c = verifyCtx({ pages: { main: page({ viewConfig: { items: [
      { type: "crt.Button", name: "SomeButton", clicked: { request: "usr.X", params: { name: "ReloadData" } } }] } }) } }, "main");
    const r = resolveVk({ type: "cardnative", names: ["ReloadData"] }, c);
    check("walkViewConfig (guard): a `name` inside a config object (`clicked.params`) is NOT collected — a cardnative `ReloadData` is not closed by it (only components under array children count)",
      () => r[2] === "unverified" && /missing: ReloadData/.test(r[1]), () => r);
  }
  // The `columns` skip is load-bearing: grid column DATA must not enter the op list, while a sibling under `items` must.
  {
    const c = verifyCtx({ pages: { main: page({ viewConfig: { items: [
      { type: "crt.DataGrid", name: "Grid", columns: [{ code: "PDS_x", name: "ReloadData" }], items: [{ type: "crt.MenuItem", name: "TagSelectItem" }] }] } }) } }, "main");
    const colProbe = resolveVk({ type: "cardnative", names: ["ReloadData"] }, c);
    const sibProbe = resolveVk({ type: "cardnative", names: ["Tag"] }, c);
    check("walkViewConfig (guard): grid `columns` DATA does not enter the op list (a column named `ReloadData` does not close a cardnative row), while a sibling control under `items` does",
      () => colProbe[2] === "unverified" && sibProbe[2] === "ok",
      () => [colProbe, sibProbe]);
  }
}
