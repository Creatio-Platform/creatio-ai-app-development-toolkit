# `Applicant1Page` — real captured record-page fixture for the TRIGGER TRACER

Two-layer fold input for `run-mapper.mjs` ("ENG-96571 …"). It exists for one job: to pin the number of
handler rows whose trigger the engine can TRACE, on a page whose declarations it had all already parsed and
then thrown away.

## Provenance

- **Schema:** `Applicant1Page` (entity `Applicant`) — the HR applicant record page.
- **Captured from:** the same Applicants migration run whose plan named the four dropped declarations
  (`attributes.Contact.onChange`, `attributes.InternalRequest.onChange`,
  `attributes.InternalRequest.lookupListConfig.filter`, `details.ApplicantEmailDetailV2.filterMethod`).
  Source bodies: `App1Page_WorkHrBase.js` (layer 1) and `App1Page_HRApplicant.js` (layer 2).
- **`manifest.json`** is the fold input: two `schemas` layers in dependency order plus the shared
  `_base/BaseModulePageV2_skeleton.js` seed.

## What is verbatim and what is not

**Verbatim, unedited:** the `details` blocks, the `attributes` entries' contents, and the method bodies of
`init`, `getRequestStatusFilter`, `getEmailDetailFilter`, `onSaved`, `onContactChange`, `setContactInfo` and
`clearContactInfo`. Those are the declarations and bodies under test, so paraphrasing one would turn the golden
into a test of the paraphrase.

**Moved between layers:** `attributes.InternalRequest.onChange` (captured on the sibling request page) sits in
layer 1 beside that column's `lookupListConfig`, not in layer 2. It has to: the imperative-member merge is
last-write-wins per attribute NAME, so a layer-2 entry for `InternalRequest` would drop layer 1's
function-valued filter slot and the fixture would stop covering the one construct it is here to cover.

**Trimmed:** the `diff` arrays. The captured diffs are layout-only (GUID-suffixed field inserts with full
`layout` blocks, ~600 lines) and the trigger tracer reads none of it; what remains is the containers, the
three profile fields and the three detail items the kept blocks reference.

**Authored for this fixture** (not captured), both marked in `HRApplicant.js`:

1. `attributes.Job.lookupListConfig.filter` as a **string** (`"getJobFilter"`), plus the `getJobFilter` method
   it names.
2. `onInternalRequestChange` — a short stand-in body. The captured page's own version lives on the sibling
   request page (`App1Page_HRRequest.js`) together with two helpers this fixture does not carry; only the
   `onChange` DECLARATION that names it is under test here, not its body.

On (1): The captured page uses only the
FUNCTION form of that slot (`WorkHrBase.js`, `InternalRequest`), so with the capture alone nothing would
exercise the `entity-filter` emit. Both forms are now present, and they must behave differently:

- **string** → an `entity-filter` trigger naming `attributes.Job.lookupListConfig.filter`;
- **function** → NO trigger. The method that body calls (`getRequestStatusFilter`) is left honestly
  unresolved, because reading a name out of a function body is the inference `04-units.md` forbids. The slot
  is still reported — as an attribute `fnKeys` entry `lookupListConfig.filter`.

## The numbers this fixture pins

9 handler stubs. Unresolved triggers **7 → 3** once the declaration tracer reads the blocks the parser
already had. The three that remain are the honest ones: `init` and `onSaved` (platform lifecycle hooks, no
caller to trace) and `getRequestStatusFilter` (reached only from a function-valued filter slot).
