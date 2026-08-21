// behaviour-analysis/schemas.mjs — the response contracts.
//
// Structured output everywhere a later phase or the core has to COMPUTE on the
// answer; prose only where a human reads it. A host without structured output
// cannot run this workflow at all, which is why `structuredOutput` is a REQUIRED
// capability rather than a degradable one.

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
    bodyCard: { type: 'string' },          // the body's OWN card, when the behaviour is defined outside this scope
    bodyAc: { type: 'array', items: { type: 'string' } },
    trigger: { type: 'string' },           // only when this run resolved one the engine could not
    from: { type: 'string' },
    note: { type: 'string' },
  },
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
