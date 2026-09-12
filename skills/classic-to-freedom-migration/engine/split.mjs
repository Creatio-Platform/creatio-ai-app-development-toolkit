// THE SPLIT FILE — where the plan is cut into work items, decided ONCE and then frozen.
//
// WHY A FILE AND NOT AN ALGORITHM. Cutting a plan into tasks is a judgement about the WORK: that the Emails
// related list and the `getEmailDetailFilter` handler are one piece because a list without its filter shows the
// wrong rows; that the tab containers have to exist before anything is placed in them; that an unresolved
// `editPages` on a child entity is not a row to report but a reason to stop and re-plan. A budget over row counts
// cannot see any of that — measured against this plan it split one folded handler chain across two sub-agents,
// put a related list and its filter in different tasks, and created half the tabs in one task and half in the
// next. Two independent agents asked to cut the same plan both found those three seams, and both wrote them the
// same way.
//
// WHY IT IS FROZEN, AND WHY THE ENGINE STILL OWNS EVERYTHING ELSE. Those same two agents disagreed with each
// other about granularity — 16 items against 14 — so re-deriving the cut on every run would move a recorded
// `done` to a task that no longer exists. The cut is therefore made once, at approval, and written down. From
// then on the engine owns what a judgement cannot give: that every plan row is placed EXACTLY once, that two
// items never write one artifact without a chain between them, that an item keeps its identity when the plan
// changes under it, and that a row appearing later is REPORTED rather than silently dropped.
//
// So: the split file says WHERE the seams are. This module says whether that answer is admissible, and keeps it
// answerable to a plan that moves.
export const SPLIT_FILE = "split.json";
export const SPLIT_SCAFFOLD = "scaffold";
const PAGE_SEP = "::";

// A row is matched by its STRUCTURAL KEY — the label with its digits masked — for the same reason a task id is:
// the digits are what a growing plan moves. `Fields — 19 expected` and `Fields — 20 expected` are one row with a
// changed count, not a row that vanished and a row that appeared, and a split that stopped matching on the first
// added field would need re-cutting for every trivial plan edit.
// Masking the DIGITS is not enough on its own: a count drives the word after it, so `1 field` becomes `2 fields`
// and the two keys diverged on the very edit this masking exists to survive. The plural that FOLLOWS a masked
// number is therefore folded too. A plural before the number (`Related lists — 4 expected`) is constant wording
// and is left alone.
export const rowKey = (label) => String(label)
  .toLowerCase()
  .replace(/\d+/g, "n")
  .replace(/\bn ([a-z]+)s\b/g, "n $1")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-/, "")
  .replace(/-$/, "")
  .slice(0, 80);

const entryPage = (entry, fallback) => {
  const at = String(entry).indexOf(PAGE_SEP);
  return at < 0 ? fallback : String(entry).slice(0, at);
};
const entryLabel = (entry) => {
  const at = String(entry).indexOf(PAGE_SEP);
  return at < 0 ? String(entry) : String(entry).slice(at + PAGE_SEP.length);
};

export function parseSplit(text) {
  let doc;
  try { doc = JSON.parse(text); }
  catch (e) { return { split: null, errors: [`not valid JSON: ${e.message}`] }; }
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) errors.push("is not a JSON object");
  else if (!Array.isArray(doc.items)) errors.push("has no `items` array");
  if (errors.length) return { split: null, errors };
  doc.items.forEach((it, i) => {
    const at = `items[${i}]`;
    if (!it || typeof it !== "object" || Array.isArray(it)) { errors.push(`${at} is not an object`); return; }
    if (!it.id || typeof it.id !== "string") errors.push(`${at} has no string \`id\` — it is the item's identity and the one field that must never change`);
    else if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(it.id)) errors.push(`${at}.id \`${it.id}\` must be lower-case letters, digits and dashes (max 49 chars)`);
    if (!it.title || typeof it.title !== "string") errors.push(`${at} has no string \`title\``);
    if (!Array.isArray(it.rows)) errors.push(`${at} has no \`rows\` array — an item that claims no plan row is work the plan does not describe`);
    else if (!it.rows.length) errors.push(`${at} (\`${it.id}\`) claims no rows`);
    if (it.writesTo !== undefined && typeof it.writesTo !== "string") errors.push(`${at}.writesTo must be a string (a page key, \`${SPLIT_SCAFFOLD}\`, or "" for read-only)`);
  });
  const ids = doc.items.map((it) => it?.id).filter(Boolean);
  const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  if (dupes.length) errors.push(`duplicate item \`id\`: ${dupes.join(", ")} — an id is an identity, so two items cannot share one`);
  return errors.length ? { split: null, errors } : { split: doc, errors: [] };
}

// Every plan row, keyed for matching. The same structural key CAN legitimately repeat on two pages (two pages
// each carry a `Quality gates` row worded identically), which is why matching is scoped to a page and an entry
// may name its page explicitly.
//
// AND IT CAN REPEAT WITHIN ONE PAGE. `Quality gates` emits its row twice per page by design, and a split simply
// CANNOT distinguish two rows whose text is identical — refusing the ambiguity made a correct split impossible to
// write. So occurrences are SLOTS: an entry consumes the next unclaimed occurrence, and an item that means both
// names the row twice. Naming it once claims one and leaves the other unplaced, which the coverage report then
// says out loud — the row is not lost, it is reported as belonging to nobody.
function planIndex(groups) {
  const byPage = new Map();
  for (const g of groups) {
    if (!byPage.has(g.pageKey)) byPage.set(g.pageKey, new Map());
    const m = byPage.get(g.pageKey);
    for (const r of g.rows) {
      const k = rowKey(r.label);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ ...r, pageKey: g.pageKey, group: g.baseTitle });
    }
  }
  return byPage;
}

// One entry against the plan: the row it names, or the reason it names none. Kept apart from the walk below so
// that walk stays a routing of answers rather than a nest of failure cases.
function claimRow(entry, pageKey, itemId, index, taken) {
  const page = entryPage(entry, pageKey);
  const key = rowKey(entryLabel(entry));
  const found = index.get(page)?.get(key);
  if (!found) {
    return { error: `\`${itemId}\` claims a row the plan does not have on page \`${page}\`: ${JSON.stringify(String(entry).slice(0, 90))}`
      + ` — copy the row text from the plan, or prefix it with \`<pageKey>${PAGE_SEP}\` if it belongs to another page` };
  }
  const slot = `${page}|${key}`;
  const owners = taken.get(slot) || [];
  if (owners.length >= found.length) {
    // The plan has N of this row and the split has now claimed N+1. With identical text there is no way to say
    // WHICH claim is the extra one, so both the first owner and this one are named.
    const already = [...new Set(owners)].join("`, `");
    return { error: `row ${JSON.stringify(found[0].label.slice(0, 70))} on \`${page}\` is claimed ${owners.length + 1} times`
      + ` (by \`${already}\` and \`${itemId}\`) but the plan has it ${found.length} time(s)`
      + " — one deliverable, one item; drop the extra claim" };
  }
  owners.push(itemId);
  taken.set(slot, owners);
  return { row: found[owners.length - 1] };
}

// RESOLVE the split against the plan as it is NOW. Two failures are refused and one is reported-but-survivable:
//   - an entry matching NO plan row                  → refused: the split describes work the plan does not
//   - a row claimed more often than the plan has it  → refused: the extra claim sends a second sub-agent
//   - a plan row claimed by NO item                  → reported as `unplaced`; see `reconcile`
export function resolveSplit(split, groups, identity = new Map()) {
  const index = planIndex(groups);
  const errors = [];
  const taken = new Map();              // "page|key" -> [item id per consumed occurrence]
  const items = [];
  for (const raw of split.items) {
    const pageKey = raw.pageKey || "main";
    const rows = [];
    for (const entry of raw.rows) {
      const { row, error } = claimRow(entry, pageKey, raw.id, index, taken);
      if (error) errors.push(error);
      else rows.push(row);
    }
    items.push({
      id: raw.id,
      title: raw.title,
      pageKey,
      stopGate: raw.stopGate === true,
      writesTo: resolveWritesTo(raw.writesTo, identity),
      declaredWritesTo: raw.writesTo ?? "",
      rows,
    });
  }
  errors.push(...unknownWriteTargets(items, index));
  errors.push(...splitFoldedChains(items));
  return { items, errors, unplaced: unconsumed(index, taken) };
}

// ONE SEAM THE ENGINE CAN CHECK RATHER THAN TRUST. A helper the plan folded under a caller says so in its own row
// — `Handler — \`setContactInfo\` (ported with \`onContactChange\`)` — so "these two are one piece of work" is
// machine-readable here, unlike the rest of the judgement a split records. It is also the seam the row-count
// slicer actually got wrong: it put `setInternalRequestInfo` in one task and `clearInternalRequestInfo`, folded
// under the same caller, in the next. A split that repeats that mistake is refused instead of merely regretted.
const FOLDED = /^Handler — `([^`]+)` \(ported with `([^`]+)`\)/;
const CALLER = /^Handler — `([^`]+)`\s*$/;
function splitFoldedChains(items) {
  const owner = new Map();              // handler name -> item id
  for (const it of items) {
    for (const r of it.rows) {
      const c = CALLER.exec(r.label);
      if (c) owner.set(`${it.pageKey}|${c[1]}`, it.id);
    }
  }
  const out = [];
  for (const it of items) {
    for (const r of it.rows) {
      const f = FOLDED.exec(r.label);
      if (!f) continue;
      const parent = owner.get(`${it.pageKey}|${f[2]}`);
      // Only when the caller is in this plan at all: a helper whose caller was dropped is not a split defect.
      if (parent && parent !== it.id) {
        out.push(`\`${f[1]}\` is in \`${it.id}\` but the plan folds it under \`${f[2]}\`, which is in \`${parent}\``
          + " — a folded helper and its caller are one piece of work, so two sub-agents would each port half of one"
          + " chain. Put them in the same item.");
      }
    }
  }
  return out;
}

// A page key named in `writesTo` that the plan does not publish is a typo the engine must not quietly honour: the
// item would write an artifact nothing else is chained against, which is the silent-collision case spelled as a
// spelling mistake.
function unknownWriteTargets(items, index) {
  const known = new Set(index.keys());
  return items
    .filter((it) => it.declaredWritesTo && it.declaredWritesTo !== SPLIT_SCAFFOLD && !known.has(it.declaredWritesTo))
    .map((it) => `\`${it.id}\`.writesTo names \`${it.declaredWritesTo}\`, which is not a page in this plan`
      + ` — known pages: ${[...known].join(", ")}`);
}

// An occurrence nobody consumed. Reported per SLOT, so a row the plan carries twice and the split claims once
// still says the second one has no owner.
function unconsumed(index, taken) {
  const out = [];
  for (const [page, m] of index) {
    for (const [key, rows] of m) {
      const consumed = (taken.get(`${page}|${key}`) || []).length;
      if (consumed < rows.length) out.push({ pageKey: page, key, rows: rows.slice(consumed), unclaimed: rows.length - consumed });
    }
  }
  return out;
}

const resolveWritesTo = (declared, identity) => {
  if (!declared) return "";
  if (declared === SPLIT_SCAFFOLD) return SPLIT_SCAFFOLD;
  return `page:${identity.get(declared) || declared}`;
};

// A SPLIT FROZEN AGAINST ONE PLAN, MET BY A LATER ONE. Rows that left the plan simply stop resolving and the item
// shrinks; an item left with NOTHING is reported rather than deleted, because its file may record work already
// done on a stand. A row the plan has GAINED belongs to no item and is reported by name: the engine will not
// choose an owner for it, because choosing is the judgement the split exists to record. Until someone places it,
// it is work nobody is scheduled to do — which is exactly what has to be loud.
export function reconcile(resolved) {
  const emptied = resolved.items.filter((it) => !it.rows.length).map((it) => ({ id: it.id, title: it.title }));
  const added = resolved.unplaced.map((u) => ({
    pageKey: u.pageKey,
    labels: u.rows.map((r) => r.label),
    group: u.rows[0]?.group || "",
  }));
  return { emptied, added };
}

// The message a caller acts on. Deliberately one text for the CLI and the index: a split refused on stdout and a
// split refused on the index must not read as two different problems.
export function splitProblems({ errors = [], unplaced = [], emptied = [] }) {
  const out = [...errors];
  for (const u of unplaced) {
    const first = u.rows?.[0]?.label || u.labels?.[0] || u.key;
    out.push(`plan row on \`${u.pageKey}\` is in NO item: ${JSON.stringify(String(first).slice(0, 90))}`
      + " — nobody is scheduled to build it. Add it to an item in the split file (the engine will not pick an owner:"
      + " which item it belongs to is the judgement the split records).");
  }
  for (const e of emptied) {
    out.push(`item \`${e.id}\` (${e.title}) has no rows left in the current plan — its work is gone from the plan.`
      + " Its file is KEPT (it may record work already done on a stand); remove it from the split file when you have"
      + " confirmed nothing it built is still needed.");
  }
  return out;
}

export const SPLIT_SHAPE = `{"planVersion":"plan-…","items":[{"id":"kebab-slug","title":"…","pageKey":"main","writesTo":"main"|"${SPLIT_SCAFFOLD}"|"","stopGate":false,"rows":["<row text copied from the plan>","<otherPage>${PAGE_SEP}<row text>"]}]}`;

