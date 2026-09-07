// behaviour-analysis/schemas.mjs — the response contracts.
//
// Structured output everywhere a later phase or the core has to COMPUTE on the
// answer; prose only where a human reads it. A host without structured output
// cannot run this workflow at all, which is why `structuredOutput` is a REQUIRED
// capability rather than a degradable one.
//
// The reported-trigger vocabulary lives in `helpers.mjs` (the leaf module) and is enforced ONLY by
// `validateReportedTrigger` there — the response SCHEMA below no longer advertises it via `enum`, because the
// Claude Code Workflow host's structured-output does not compile `enum`/`dependentRequired` and rejects the whole
// Describe agent when the schema carries one. So this module no longer imports anything from helpers.

export const SCOPE = {
  type: 'object',
  required: ['role', 'methodKeys', 'memberKeys'],
  properties: {
    role: { type: 'string' },              // 'main page' | 'mini page' | 'typed page' | 'child page'
    schema: { type: 'string' },            // null on the main page: the engine parses layers by package
    methodKeys: { type: 'array', items: { type: 'string' } },  // '<method>' or '<schema>::<method>'
    memberKeys: { type: 'array', items: { type: 'string' } },  // '<kind>:<name>'
    unresolvedCount: { type: 'integer' },  // rows whose trigger the engine could not trace
  },
}

export const CONTEXT_SCHEMA = {
  type: 'object',
  required: ['scopes', 'sharedCore', 'censusNote'],
  properties: {
    scopes: { type: 'array', items: SCOPE },
    // The shared core is CARDED HERE, once. Every Describe agent references these
    // ids instead of re-reading the same base layers and mixin bodies — without
    // this phase two scopes write two different cards for one mixin.
    sharedCore: {
      type: 'object',
      required: ['path', 'cards'],
      properties: {
        path: { type: 'string' },          // file holding the shared-core cards
        cards: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title'],
            properties: { id: { type: 'string' }, title: { type: 'string' }, subject: { type: 'string' } },
          },
        },
        messageRegister: {
          type: 'array',
          items: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string' },
              publishers: { type: 'array', items: { type: 'string' } },
              subscribers: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    censusNote: { type: 'string' },        // how the scope list was proven complete against the stand census
    refusals: { type: 'array', items: { type: 'string' } },
  },
}

export const INDEX_ENTRY = {
  type: 'object',
  required: ['key', 'card'],
  properties: {
    key: { type: 'string' },               // EXACTLY as the digest keys it
    card: { type: 'string' },              // namespaced: '<scope>/C03'
    ac: { type: 'array', items: { type: 'string' } },
    whatItDoes: { type: 'string' },        // ENG-96534: plain-language "what it does" (card's "What it is") — a human plan column
    useCase: { type: 'string' },           // ENG-96534: plain-language step-by-step walkthrough for a non-technical reader — a human plan column
    bodyCard: { type: 'string' },          // the body's OWN card, when the behaviour is defined outside this scope
    bodyAc: { type: 'array', items: { type: 'string' } },
    // Only when this run resolved one the engine could not — and only from the CLOSED vocabulary. A bare string
    // let `{"trigger":"internal","from":"init"}` through on the row named `init`, which rendered as an answered
    // trigger and cleared the row out of the plan's unresolved count. NO `enum` here on purpose: the Claude Code
    // Workflow host's structured-output does NOT compile a JSON-Schema `enum` (nor `dependentRequired`, dropped
    // below) and REJECTS the whole Describe agent when the schema carries one — so `classic-behaviour-analysis`
    // failed every Describe agent at plan step 5.1 (empty agentId, null return → DEATH). The closed-vocabulary
    // check lives ENTIRELY in `validateReportedTrigger` (the arithmetic half), which every emit path already runs.
    trigger: { type: 'string' },
    from: { type: 'string' },
    note: { type: 'string' },
    // The analysis agent's own admission that it could NOT establish the behaviour. An entry carrying `false` is
    // not coverage (see `behaviourEstablished` in helpers.mjs) and the engine keeps the row's `⚠ not described`.
    behaviourEstablished: { type: 'boolean' },
  },
  // NO `dependentRequired` here either: like `enum` above, the Claude Code Workflow host's structured-output does
  // not compile it and rejects the whole Describe agent. The `from`↔`trigger` co-requirement (an origin-less
  // reported trigger, or a `from` with no `trigger`, each answers nothing) is enforced ENTIRELY and in BOTH
  // directions by `validateReportedTrigger` in helpers.mjs, which every emit path already runs.
}

export const DESCRIBE_SCHEMA = {
  type: 'object',
  required: ['reportPart', 'indexEntries'],
  properties: {
    reportPart: { type: 'string' },        // the file this agent wrote — the cards live there, not in this return
    indexEntries: { type: 'array', items: INDEX_ENTRY },
    // A row this agent could NOT describe. Recorded, never omitted: an absent key
    // and a key it consciously could not answer are different states.
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'why'],
        properties: { key: { type: 'string' }, why: { type: 'string' }, settlingQuery: { type: 'string' } },
      },
    },
    refusals: { type: 'array', items: { type: 'string' } },
  },
}

export const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['uncovered', 'conflicts', 'settledElsewhere'],
  properties: {
    uncovered: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string' }, scope: { type: 'string' }, why: { type: 'string' } },
      },
    },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'cards'],
        properties: { key: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
      },
    },
    // A refusal one scope recorded that ANOTHER scope's findings actually answer.
    // This is the failure mode a per-scope split introduces and a whole-surface
    // run does not have, so it gets its own field rather than a prose mention.
    settledElsewhere: {
      type: 'array',
      items: {
        type: 'object',
        required: ['refusal'],
        properties: { refusal: { type: 'string' }, byScope: { type: 'string' }, how: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

export const MERGE_SCHEMA = {
  type: 'object',
  required: ['reportPath', 'indexPath', 'cardCount'],
  properties: {
    reportPath: { type: 'string' },
    indexPath: { type: 'string' },
    cardCount: { type: 'integer' },
    acCount: { type: 'integer' },
    droppedDuplicates: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
