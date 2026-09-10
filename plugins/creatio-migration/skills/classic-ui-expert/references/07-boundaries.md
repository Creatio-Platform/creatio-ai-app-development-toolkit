# 07 — Boundaries: where a card stops

A card's subject is a **client Classic block**. When the behaviour hands off elsewhere, the card
records the hand-off and stops. This is a rule about the *subject*, not about what you may read:
reading beyond the boundary to describe the client side accurately is allowed and encouraged —
what you may not do is make the far side the subject, or assert things about it you did not read.

## The boundaries

| Hand-off | What the card records | What it does not do |
|---|---|---|
| C# web service (`callService`) | service name, method name, payload shape, how the client handles the result | describe the server algorithm as fact |
| business process (runner, or a process id from a setting) | how it is launched, the indirection (setting name), the error paths | claim what the process creates |
| DB stored procedure (named inside a service) | the name, as one boundary deeper | claim what it transfers |
| lookup rows / system settings values | that the behaviour is data-driven and which key | assume a value you did not query |
| reports (`SysModuleReport`) | that registered printables are surfaced | enumerate reports as code |
| package assembly / file content | that the implementation is not a configuration schema | conclude "it does not exist" |

## The hand-off is a contract, not a summary

The card stops at the boundary, but what crosses it must be recorded losslessly: the callee
identity and how it is resolved (setting name, hardcoded id), **every parameter with its value in
every branch** — including parameters always sent with constant or empty values — and how the
return is handled. A consumer rebuilding the call from the card alone must produce the equivalent
invocation. A parameter the card omits is a parameter a migration will omit. (Proven in practice:
a card said "launches the process with the record id"; the source always sent a second, list-typed
parameter — empty string meaning "all" — and the rebuilt button dropped it, crashing the process
at its first dereference.)

## Reading across a boundary (allowed, and how to cite it)

If you fetch the C# source-code schema behind a `callService`, or the process schema behind a
runner, put what you learned in a **settling-results** note on the card, not in the behaviour
statement. The behaviour statement stays client-side; the note grounds the business-logic wording
and shrinks the assumption. Cite it like any other source: `SchemaName [Package] + lines`.

Registry hints: C# schemas are `ManagerName = 'SourceCodeSchemaManager'`; processes are
`ProcessSchemaManager`.

## The invisible-implementation case

A service class named in client code may have **no schema at all**:

- it can live in a package's file content (`Files/`), or
- be compiled into a package assembly.

Neither appears in a configuration schema search. So a registry search returning nothing is
**not** evidence the service does not exist — the correct statement is "the implementation is not
a configuration schema on this stand; it ships as package file content or an assembly". Say that,
rather than "not found" (which reads as "broken") or inventing a location.

## Start conditions of a process are not a UI fact

A process with a plain start event never fires by itself; something must launch it. If you want to
say "orders are created from opportunities", you must have seen the launcher (a button, a runner
call, a signal). Otherwise the honest form is: "a process exists whose caption says it creates X;
its launcher was not identified".

## Orphaned resources

A resource string with no element referencing it (e.g. a button caption whose control is absent
from the merged page) is a real finding: the control was removed or never wired at the current
layer set. Record it as such — it is evidence about the surface, not noise.
