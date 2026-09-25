# 09 — Refusal: declining honestly

Two kinds: refusing the **run** (a precondition is missing) and refusing a **unit** (the source
does not support a description).

## Refusing the run

Stop and name what is missing when:

- no live stand is reachable through clio MCP, or the environment is not registered;
- the stand cannot serve the schema registry or page-source calls;
- the named section/entity does not resolve to a Classic surface (e.g. it is Freedom-only) —
  say which, rather than analyzing the wrong thing;
- the request depends on writes, on a browser, or on runtime observation — all out of scope here.

Do **not** substitute a pasted schema body for a stand. Do not analyze "the usual" version of a
section from prior knowledge. The declined-run message states: what was requested, which
precondition failed, and the one thing that would unblock it.

## Refusing a unit

Refuse when the members are in front of you but their meaning is not established:

- a binding whose target is not defined anywhere in the fetched chain;
- an attribute or message with no locatable counterpart, where the behaviour depends on it;
- a condition whose meaning depends on data (a lookup value, a setting) you did not query;
- logic whose effect depends entirely on code beyond a boundary you did not read.

Form of a unit refusal:

```
U07 — <what the members are>
  Established: <the facts you do have — members, layer, lines>
  Not established: <the specific thing you cannot say>
  Would settle it: <the concrete query>
```

That is a *finding*, and it is more valuable than a plausible sentence. The failure mode this
guards against is the one measured in research: confident mechanism prose that reads well and is
wrong, at a rate high enough to poison the whole output.

## Calibration

Prefer refusing to guessing, but do not refuse what the source plainly shows. A refusal is for
"the source does not say", never for "reading this would take effort". If you refused a unit
because a schema was unfetched, fetch it and re-decide — the fetch obligation comes first.

Report refusals as a count alongside the unit count. A run with zero refusals on a complex
surface is itself a signal worth stating: either the surface was simple, or something was
smoothed over.
