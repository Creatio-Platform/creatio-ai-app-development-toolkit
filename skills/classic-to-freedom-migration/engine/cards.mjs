// engine/cards.mjs — behaviour-card DISCOVERY (ENG-94529 PoC).
//
// Cards are hand-written, TARGET-NEUTRAL behaviour records living in ../cards/*.md beside this skill:
// each describes one known Classic customization (what it is, why, verbatim code, acceptance criteria).
// The engine cannot map what it does not model — the Step D baseline showed customizations like these
// surface only as generic "confirm the template provides it" notes (or not at all), which reads as
// permission to drop the behaviour. Discovery closes that hole: every migration run is screened against
// the registry below, and a hit attaches the card's behaviour + acceptance criteria to the plan.
//
// Design decisions (agreed 2026-08-04):
// - The scan runs on EVERY engine run, unconditionally. A conditional trigger ("search when the engine
//   flags something") cannot work: the members these cards describe often produce NO flag at all
//   (verified: the addRecord override below yields zero mentions in a stock plan).
// - A match is a CANDIDATE, not a verdict — the plan tells the reader to confirm it by comparing the
//   matched layer against the card's own Code section. A visible false positive costs a minute; a
//   silent drop costs the behaviour.
// - Scale guards are structural from day one (even at one card): anchors must be COMBINATIONS matched
//   within ONE layer body (never a single common name), every entry carries a `scope` pre-filter, and
//   only the candidate/confirmed split above reaches the reader.
// - Anchors are PLATFORM-stable names only (base element names, overridden platform members). Customer-
//   owned names (converter names, packages, mini-page names) never go in a signature — they differ per
//   site while the behaviour stays the same.
// - Out of scope for this PoC: scanning nested child-page manifests, ranking between competing cards,
//   deriving signatures from the card automatically (that is ENG-94397's job).
import { readFileSync } from "node:fs";

// ---- the registry: one entry per shipped card, signatures hand-written for the PoC ----
export const CARD_REGISTRY = [
  {
    id: "U01",
    file: "cards/U01-new-button-single-add-page.md",
    // behaviour/trigger/effect: the USER-facing Logic-row cells — plain behaviour language, no card
    // mechanics (the reader wants what it is and what it does, not where the migrator learned it).
    behaviour: "NEW button opens one shared add form for all record types (single click, no type menu)",
    trigger: "User clicks the section's NEW (add record) button — either display mode",
    effect: "No type dropdown opens. The one shared add form opens immediately with a starting record type preset; the person picks the actual type in the form's Type field and the form reshapes to that type",
    scope: "section", // this behaviour lives on section schemas; don't scan page layers for it
    anchors: {
      // all three conditions must hold within ONE layer body:
      requiredDefs: ["addRecord"],                                        // defined as a method (an override), not merely mentioned
      anyNames: ["SeparateModeAddRecordButton", "CombinedModeAddRecordButton"], // at least one platform Add button touched
      allNames: ["EditPages", "controlConfig"],                           // the menu re-bind evidence
    },
  },
];

// method DEFINITION (`name: function` / `name: async function`), not a mere mention in a binding string
const defRe = (n) => new RegExp(String.raw`\b${n}\s*:\s*(?:async\s+)?function\b`);
// name occurrence — as a string literal ('EditPages' in a bindTo) OR a bare identifier/object key
// (`controlConfig:` unquoted). Classic bodies use both styles per author; requiring quotes produced a
// verified false negative on an unquoted-key body. Anchor names are long platform identifiers, so a
// word-boundary match stays precise.
const nameRe = (n) => new RegExp(String.raw`\b${n}\b`);
const defineNameOf = (body) => (/define\(\s*["']([^"']+)["']/.exec(body) || [])[1] || null;

// All anchor conditions against ONE body; returns the list of anchors that hit, or null on any miss.
function matchAnchors(anchors, body) {
  const hit = [];
  for (const n of anchors.requiredDefs || []) {
    if (!defRe(n).test(body)) return null;
    hit.push(`${n}() defined`);
  }
  if ((anchors.anyNames || []).length) {
    const any = (anchors.anyNames || []).filter((n) => nameRe(n).test(body));
    if (!any.length) return null;
    hit.push(...any);
  }
  for (const n of anchors.allNames || []) {
    if (!nameRe(n).test(body)) return null;
    hit.push(n);
  }
  return hit;
}

// Read the card's reader-facing sections. Defensive: an unreadable card degrades to the match line
// alone (the run must never fail because a card file moved).
function readCard(file) {
  const out = { whatItIs: null, acs: [], code: null };
  try {
    const md = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const section = (title) => {
      const m = new RegExp(`^##\\s+${title}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m").exec(md);
      return m ? m[1].trim() : null;
    };
    out.whatItIs = section("What it is");
    out.code = section("Code");
    const acSection = section("Acceptance criteria") || "";
    out.acs = acSection.split(/\r?\n/).filter((l) => /^-\s+\*\*AC-\d+\*\*/.test(l)).map((l) => l.replace(/^-\s+/, ""));
  } catch { /* card file missing/unreadable — render the match without card content */ }
  return out;
}

// Screen the manifest's customization layers (NOT the seed — platform bodies contain every anchor
// legitimately) against the registry. One match per card is enough for the plan: the card names ONE
// behaviour, so the first matching layer carries it (layers of the same schema repeat the same names).
export function discoverCards(manifest) {
  const matches = [];
  for (const entry of CARD_REGISTRY) {
    const layers =
      entry.scope === "section" ? (manifest.section || [])
      : entry.scope === "page" ? (manifest.schemas || [])
      : [...(manifest.schemas || []), ...(manifest.section || [])];
    for (const layer of layers) {
      const body = layer?.body || "";
      if (!body) continue;
      const anchorsHit = matchAnchors(entry.anchors, body);
      if (!anchorsHit) continue;
      matches.push({
        id: entry.id, file: entry.file, behaviour: entry.behaviour, trigger: entry.trigger, effect: entry.effect,
        schemaName: defineNameOf(body) || "?", pkg: layer.pkg || "?", anchorsHit,
        card: readCard(entry.file),
      });
      break;
    }
  }
  return matches;
}
