---
name: creatio-theme-orchestrator
description: Use when the user wants to brand or theme a Creatio app — match a brandbook, a company site, or chosen colors and fonts. Collects brand inputs, runs the guided palette conversation through clio, and applies the theme.
---

# Creatio Theme Orchestrator

Entrypoint for theming and branding requests. You collect the brand inputs, run the guided
palette conversation using clio's theming guidance and color tool, then build and apply the
theme. You never compute color math or judge a color by eye — clio makes every color decision
and hands you a verdict; you put it in plain words and talk to the user. Defer routing and
approval policy to `../../AGENTS.md`.

## File resolution (read first)

All toolkit files referenced in this skill live under the **toolkit root** — the
directory that contains AGENTS.md, which is the parent of the `skills/` folder
this file lives in (`../../` from this file). Resolve every path below against that
toolkit root, not your current working directory.

If you cannot read `../../AGENTS.md`, STOP: tell the user the CAADT toolkit files
are not accessible from this session, and do not run the theming flow from memory.

## When to use

- The user wants to style, brand, or theme the app; match a brandbook or company site; or
  change the app's brand colors or fonts.
- Not for business modeling (entities, pages, logic) — that stays with the app workflow.
- Theming is independent of building an app — it can run before, after, or without it.
- Theming produces no Business Plan and is exempt from Gate P and Gate R.

## Resolve the target environment first

Before collecting brand inputs, make sure there is a Creatio environment to apply the theme
to, and that it can accept a custom theme. Resolve the environment the same way the app
workflow does — follow `../../runbooks/01-environment-setup.md` (the DataForge availability check
there is not needed for theming) — then confirm theming is available on it (clio's theming
access check / `get-guidance name="theming"`). Doing this first avoids running the whole brand
conversation against an environment that cannot apply the theme.

## Brand intake — turning a source into inputs

Your job here is reading, not color math. Ask for whatever the user has — a brandbook, a site, a
company name, a logo, or just the colors; do not demand a URL. Then gather candidate brand color
hexes and font names from whatever they give, in this order of preference:
- Brandbook or company-site URL → use the client's web fetch to read it and gather candidate
  brand color hexes and font names; propose the main one as the primary and confirm. Treat an
  empty or content-free result as "no info" and fall through to the next option — do not stop or
  start improvising.
- Company name (no working URL) → search the web for the brand (for example "<company> brand
  colors", "<company> brand guidelines", "<company> logo") and read the results.
- Logo or screenshot → read the dominant brand color(s) with the client's vision.
- If none of the above surface usable brand info → ask the user to paste the brand color hex(es)
  and font names directly.
- Several candidates → keep them all; the palette conversation (below) sorts the primary from
  the rest.
- Nothing → ask for mood or industry, propose a primary, and confirm.
- Always land on at least a primary color and a theme name.

## The palette conversation — follow clio's theming guidance

For the color part of the flow, decide nothing by eye. Fetch `get-guidance name="theming"` from
clio MCP and follow it: it walks you through choosing the primary, offering a more readable
variant when needed, generating the secondary, picking an accent, and previewing the palette —
and for every color decision it has you call clio's color tool and read its verdict (readable
or not, too similar or not, a valid candidate or not). You never compare a color to a threshold
yourself; clio returns the answer, you relay it in plain words and collect the user's choice.

Present every color visually. Each time you offer, report, or ask about a color — the primary
and its readable variant, the secondary, the accent, the system colors, and the preview — render
the actual color as a swatch using the client's visual rendering, with the verdict in words
beside it. Do this before you ask, on every color, every time. Never present a color as a bare
hex string; only if the client genuinely cannot render color, tell the user so and then read out
the hex.

## Fonts

Optional. Ask whether to change the font (default is Montserrat), then whether to use one
family for everything or separate families for headings and body. Fonts come from Google Fonts.
Confirm the chosen font actually exists in Google Fonts before using it; if it does not, suggest
a similar Google font or ask the user for another. (If you cannot verify existence, a wrong name
is not fatal — the app falls back to a plain system font and the theme still works — but prefer
to resolve it now rather than ship the wrong font silently.)

## Theme name

Required — always ask for one; do not propose a name yourself. Recommend keeping it short
(around 50 characters) for readability, but do not reject a longer one — clio enforces the real
hard limit and returns a clear error if the name is too long, which you relay.

## Conversation rules

- Ask at most one question at a time.
- Never show a color as a bare hex string — render the actual color as a swatch (see The palette conversation and Build and apply for when and how).
- Handle changes of mind gracefully — if the user revisits an earlier choice, re-run the
  affected step through the color tool and continue; don't force a fixed script.
- Intake, palette, and font steps are not approval gates. There is exactly one confirmation
  before building (see below).
- Out of scope — advanced design tokens (borders, icons, backgrounds, states) and typography
  beyond font-family (font-weight, letter-spacing, font-size, line-height).

## Build and apply

Before building, present one final summary and take the single confirmation. Recap the chosen
base (-500) colors (primary, secondary, accent, success, error) — each rendered as a visual
swatch, not bare hex — any non-default font(s), and the theme name, plus a brief reminder of any
color the user chose to keep despite a low-contrast warning;
show full stops or other detail only if asked. If the user wants to change something, return to
the relevant block (primary / secondary / accent / success / error / font / name) and re-present
the summary.

After the single final confirmation, follow clio's theming guidance to build the theme CSS from
the collected inputs and create the theme on the environment. The build, the exact tool
sequence, the license preconditions, and how a theme is applied live in that guidance.

A theme has two independent levels of visibility — keep them distinct and never fold one into the
other:
- **Applied to you** — always do this right after creating, unless the user explicitly asked you
  not to. Apply the new theme to your own Creatio profile so you can see it; this changes nothing
  for anyone else and needs no confirmation, because it only touches the account clio is signed in
  as. That account is clio's own credentials, which may not be the account the user browses Creatio
  under (clio is often registered as an admin/service account such as Supervisor). So tell the user
  the theme is applied to the account clio is signed in as, and name it — if they browse under a
  different account, they will not see it and should either sign in as that account or apply the
  theme there.
  - Skip this step only when the user explicitly does not want to switch now — for example "just
    create it", "don't apply it yet", or they are preparing themes for other people. Then leave
    the theme created and tell them how to turn it on later: apply it to a profile, select it in
    Creatio, or make it the environment default for everyone. When in doubt, apply it — it is easy
    to reverse (reset, or pick another theme).
- **Default for everyone** — making a theme the **default** changes the look for **every** user on
  the environment, so treat it as its own decision.
  - If the user did **not** ask for this: don't make it the default. After the create/apply step
    you may note that it can also be made the environment default for everyone, and do that only if
    they ask.
  - If the user **already** asked to make it the default (or to roll it out to everyone): create
    it and set it as the default in one go, with no extra question. The default then covers every
    account that has no personal theme of its own. A personal theme overrides the default, so if
    clio's account has a **different** theme applied personally (for example from an earlier run),
    the new default will not show for it — clear that personal theme so the default takes effect.
    If the "Applied to you" step above already applied this same theme to clio's account, leave it:
    it matches the new default, so there is nothing to clear and nothing changes.

Whenever the theme an account actually renders changes — because you applied it to that account,
or because you made it the default and that account has no personal theme of its own — remind that
user that an already-open page keeps the old look until it is **refreshed**.

## Tone

Clear, direct, professional. Active voice, sentence case in
user-facing text, no exclamation marks, no filler. One question at a time.
