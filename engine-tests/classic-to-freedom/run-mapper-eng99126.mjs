// ENG-99126 — FOUR ROW KINDS THAT USED TO READ "☐ confirm on-stand" ARE MACHINE ROWS NOW. Measured on the
// Applicants run: 18 of the plan's rows were sent to a person while get-page already carried the answer — the
// handler source (`bundle.handlers`), the view-model attributes (`bundle.viewModelConfig`), the containers
// (fields / grids per tab), the template's native card buttons. Imported and run by `run-mapper.mjs`, which hands
// it its `check` and the shared fixtures so the tally stays one number.
export function runEng99126Checks({ check, verifyCtx, resolveVk, renderVerify, checklistGroups, m12Run, m12Opts, m12Built, m12Page, M12_NAMED, lpRun, lpOpts }) {
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
  check("ENG-99126 handler: a handler that NAMES the Classic method closes the row ✅",
    () => st(H("onSaved", null, [])) === "✅ Done" && /defines or calls `onSaved`/.test(ev(H("onSaved", null, []))), () => H("onSaved", null, []));
  check("ENG-99126 handler: a port that dropped the method name but BRANCHES on its Classic trigger attribute closes the row ✅ (the measured shape: setContactInfo became reloadCommunicationOptions under attributeName === Contact)",
    () => st(H("onContactChange", null, trigContact)) === "✅ Done" && /branches on attribute `Contact`/.test(ev(H("onContactChange", null, trigContact))),
    () => H("onContactChange", null, trigContact));
  check("ENG-99126 handler: a helper folded under a caller closes when the caller does (by name or by trigger) — one port, two plan rows",
    () => st(H("setContactInfo", "onContactChange", trigContact)) === "✅ Done"
      && st(H("helper", "onSaved", [])) === "✅ Done" && /ported with `onSaved`/.test(ev(H("helper", "onSaved", []))),
    () => [H("setContactInfo", "onContactChange", trigContact), H("helper", "onSaved", [])]);
  check("ENG-99126 handler (guard): a method with no name match and no trigger branch is non-gating confirm-on-stand, never ❌ — a port under another name or as a declarative rule is legitimate, and the text says what to record",
    () => { const r = H("getEmailDetailFilter", null, []); return r[2] === "skip" && /confirm on-stand/.test(st(r)) && /record how it was ported/.test(ev(r)); },
    () => H("getEmailDetailFilter", null, []));
  check("ENG-99126 handler (guard): no `handlers` slot ⇒ non-gating confirm-on-stand, naming the slot to pass — never a false ✅ or ❌",
    () => { const r = H("onSaved", null, [], flat); return r[2] === "skip" && /handlers not provided/.test(ev(r)); }, () => H("onSaved", null, [], flat));

  // view-model attributes
  check("ENG-99126 vmattr: a virtual attribute present in viewModelConfig.attributes is ✅; one absent is ⚠ (a port another way is possible); no viewModelConfig ⇒ ⚠ not checkable",
    () => st(resolveVk({ type: "vmattr", name: "Department" }, ctx)) === "✅ Done"
      && st(resolveVk({ type: "vmattr", name: "StaffUnit" }, ctx)) === "⚠ verify"
      && /no `viewModelConfig`/.test(ev(resolveVk({ type: "vmattr", name: "Department" }, flat))),
    () => [resolveVk({ type: "vmattr", name: "Department" }, ctx), resolveVk({ type: "vmattr", name: "StaffUnit" }, ctx), resolveVk({ type: "vmattr", name: "Department" }, flat)]);

  // layout
  const L = (vk, c = ctx) => resolveVk({ type: "layout", fields: 0, lists: 0, widgets: [], ...vk }, c);
  check("ENG-99126 layout: the side profile is measured in the Side*/Profile* container — 2 fields there ✅, 3 expected ⚠ naming the shortfall",
    () => st(L({ region: "side", fields: 2 })) === "✅ Done" && /in `SideContainer`: 2 fields/.test(ev(L({ region: "side", fields: 2 })))
      && /2\/3 fields/.test(ev(L({ region: "side", fields: 3 }))), () => [L({ region: "side", fields: 2 }), L({ region: "side", fields: 3 })]);
  {
    const c2 = verifyCtx({ pages: { main: full } }, "main");   // fresh ctx — claiming is per-ctx
    const M = (vk) => resolveVk({ type: "layout", fields: 0, lists: 0, widgets: [], ...vk }, c2);
    const basic = M({ region: "tab", caption: "Basic information", fields: 1 });
    const history = M({ region: "tab", caption: "History", lists: 1 });
    const next = M({ region: "tab", caption: "Next steps", widgets: ["crt.NextSteps"] });
    const payments = M({ region: "tab", caption: "Payments", fields: 1 });
    check("ENG-99126 layout: a tab is found by the plan's CAPTION WORDS against the built tab's caption binding or name (Basic information -> BasicInformationTabCaption) and measured inside it — fields, related lists, widgets; an unknown caption is unverified naming the tabs that exist",
      () => basic[0] === "✅ Done" && /in tab `GeneralInfoTab`/.test(basic[1]) && history[0] === "✅ Done" && next[0] === "✅ Done"
        && /no unclaimed tab whose caption or name matches "Payments"/.test(payments[1]),
      () => [basic, history, next, payments]);
  }
  check("ENG-99126 layout: the header is judged by its widgets anywhere on the page; a payload with NO containers (the legacy flat ops shape) is judged page-wide and SAYS so — every fixture built that way stays green",
    () => {
      if (st(L({ region: "header", widgets: ["crt.EntityStageProgressBar", "crt.Feed"] })) !== "✅ Done") return false;
      const f = verifyCtx({ pages: { main: { ...page(), viewConfig: { items: [{ type: "crt.Input", name: "A" }, { type: "crt.Input", name: "B" }] } } } }, "main");
      const r = L({ region: "side", fields: 2 }, f);
      return st(r) === "✅ Done" && /page as a whole/.test(ev(r));
    }, () => L({ region: "header", widgets: ["crt.EntityStageProgressBar", "crt.Feed"] }));

  // native card actions
  check("ENG-99126 cardnative: the template's native controls are matched by element name (CardActionsBtn / ReloadDataBtn / TagSelect) — all three ✅, a missing one named",
    () => st(resolveVk({ type: "cardnative", names: ["ViewOptions", "ReloadData", "Tag"] }, ctx)) === "✅ Done"
      && /missing: Print/.test(ev(resolveVk({ type: "cardnative", names: ["ViewOptions", "Print"] }, ctx))),
    () => [resolveVk({ type: "cardnative", names: ["ViewOptions", "ReloadData", "Tag"] }, ctx), resolveVk({ type: "cardnative", names: ["ViewOptions", "Print"] }, ctx)]);

  // the checklist publishes them + the info row + the dropped twin
  const g = checklistGroups(m12Run, m12Opts).flatMap((x) => x.rows);
  check("ENG-99126 checklist: every Layout row carries a `layout` vk, every handler row a `handler` vk with the method's triggers, the native card-actions row a `cardnative` vk — none of them is vk-less any more",
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
    check("ENG-99126 checklist: a [module-dep] row is INFORMATIONAL — the checklist row carries `info` (not a vk), and renderVerify emits it as noted / kind info / outcome skip, never confirm and never against the verdict",
      () => !!depRow && !!depRow.info && !depRow.vk && !!vr && vr.kind === "info" && vr.status === "ℹ noted" && vr.outcome === "skip",
      () => ({ depRow, vr }));
  }
  check("ENG-99126 checklist: when the list page publishes its gated `List template →` row, the Pages group no longer carries the ungated `List page →` twin — one fact, one row",
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
    check("ENG-99126 handler (guard): a method whose only occurrence is a COMMENT or a STRING does NOT resolve Done — it stays ⚠ unverified (the false-confirmation direction the raw-text search allowed)",
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
    check("ENG-99126 layout (guard): two overlapping-caption rows claim DIFFERENT tabs — 'Contact information' takes ContactInformationTab, 'Contact' takes the remaining ContactTab, neither reused",
      () => r1[2] === "ok" && /ContactInformationTab/.test(r1[1]) && r2[2] === "ok" && /ContactTab/.test(r2[1]) && !/ContactInformationTab/.test(r2[1]),
      () => [r1, r2]);
  }
  // (1) header with a field count present: the field/list legs do not apply to the header, so a header row with
  // fields:2 still passes once its widgets are on the page — the blocker was judging that against an empty container.
  check("ENG-99126 layout (guard): a header row carrying fields:2 passes when its widgets are present — the header is judged on widgets, not field counts (regression on the blocker)",
    () => st(L({ region: "header", fields: 2, widgets: ["crt.Feed"] })) === "✅ Done",
    () => L({ region: "header", fields: 2, widgets: ["crt.Feed"] }));
}
