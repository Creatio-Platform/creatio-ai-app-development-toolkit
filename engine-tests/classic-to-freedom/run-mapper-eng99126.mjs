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
    () => st(H("onSaved", null, [])) === "✅ Done" && /names `onSaved`/.test(ev(H("onSaved", null, []))), () => H("onSaved", null, []));
  check("ENG-99126 handler: a port that dropped the method name but BRANCHES on its Classic trigger attribute closes the row ✅ (the measured shape: setContactInfo became reloadCommunicationOptions under attributeName === Contact)",
    () => st(H("onContactChange", null, trigContact)) === "✅ Done" && /branches on attribute `Contact`/.test(ev(H("onContactChange", null, trigContact))),
    () => H("onContactChange", null, trigContact));
  check("ENG-99126 handler: a helper folded under a caller closes when the caller does (by name or by trigger) — one port, two plan rows",
    () => st(H("setContactInfo", "onContactChange", trigContact)) === "✅ Done"
      && st(H("helper", "onSaved", [])) === "✅ Done" && /ported with `onSaved`/.test(ev(H("helper", "onSaved", []))),
    () => [H("setContactInfo", "onContactChange", trigContact), H("helper", "onSaved", [])]);
  check("ENG-99126 handler (guard): a method with no name match and no trigger branch is ⚠ unverified, never ❌ — a port under another name or as a declarative rule is legitimate, and the text says what to record",
    () => { const r = H("getEmailDetailFilter", null, []); return st(r) === "⚠ verify" && r[2] === "unverified" && /record how it was ported/.test(ev(r)); },
    () => H("getEmailDetailFilter", null, []));
  check("ENG-99126 handler (guard): no `handlers` slot on the page entry ⇒ ⚠ not checkable, naming the slot to pass — never a false ✅ or ❌",
    () => { const r = H("onSaved", null, [], flat); return st(r) === "⚠ verify" && /no `handlers` slot/.test(ev(r)); }, () => H("onSaved", null, [], flat));

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
  check("ENG-99126 layout: a tab is found by the plan's CAPTION WORDS against the built tab's caption binding or name (Basic information → BasicInformationTabCaption) and measured inside it — fields, related lists, widgets; an unknown caption is ⚠ naming the tabs that exist",
    () => st(L({ region: "tab", caption: "Basic information", fields: 1 })) === "✅ Done" && /in tab `GeneralInfoTab`/.test(ev(L({ region: "tab", caption: "Basic information", fields: 1 })))
      && st(L({ region: "tab", caption: "History", lists: 1 })) === "✅ Done"
      && st(L({ region: "tab", caption: "Next steps", widgets: ["crt.NextSteps"] })) === "✅ Done"
      && /no tab whose caption or name matches "Payments"/.test(ev(L({ region: "tab", caption: "Payments", fields: 1 }))),
    () => [L({ region: "tab", caption: "Basic information", fields: 1 }), L({ region: "tab", caption: "History", lists: 1 }), L({ region: "tab", caption: "Payments", fields: 1 })]);
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
      && g.filter((r) => /^Handler — /.test(r.label)).every((r) => r.vk?.type === "handler" && Array.isArray(r.vk.triggers))
      && g.filter((r) => /^Card actions — native/.test(r.label)).every((r) => r.vk?.type === "cardnative"),
    () => g.filter((r) => /^(Side profile|Tab · |Header|Handler|Card actions — native)/.test(r.label)).map((r) => [r.label, r.vk?.type]));
  check("ENG-99126 checklist: a `[module-dep]` row is INFORMATIONAL — it renders ℹ noted (kind `info`), never ☐ confirm on-stand, and never counts against the verdict",
    () => {
      const v = renderVerify(m12Run, m12Opts, m12Built(m12Page(M12_NAMED)));
      const dep = g.find((r) => /^\[module-dep\]/.test(r.label));
      const ok = !dep || (dep.info && v.rows.some((r) => /^\[module-dep\]/.test(r.deliverable) && r.kind === "info" && r.status === "ℹ noted" && r.outcome === "skip"));
      return ok && !v.rows.some((r) => /^\[module-dep\]/.test(r.deliverable) && r.kind === "confirm");
    }, () => renderVerify(m12Run, m12Opts, m12Built(m12Page(M12_NAMED))).rows.filter((r) => /module-dep/.test(r.deliverable)));
  check("ENG-99126 checklist: when the list page publishes its gated `List template →` row, the Pages group no longer carries the ungated `List page →` twin — one fact, one row",
    () => {
      const rows = checklistGroups(lpRun, lpOpts).flatMap((x) => x.rows);
      const gated = rows.some((r) => r.vk?.type === "template" && /^List template/.test(r.label));
      return gated && !rows.some((r) => /^List page → /.test(r.label));
    }, () => checklistGroups(lpRun, lpOpts).flatMap((x) => x.rows).filter((r) => /^List (page|template)/.test(r.label)).map((r) => [r.label, r.vk?.type]));
}
