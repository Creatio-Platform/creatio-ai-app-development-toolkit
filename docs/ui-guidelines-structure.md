# Where a rule goes in `creatio-ui-guidelines`

The skill's references are split by what an agent arrives with: a kind of page, or one element on it. Each rule has one home, a section with its full text, reason and exceptions; every other place points to that section by name.

| The new rule is about | Home |
|---|---|
| What goes where on one kind of page (record, list, step-by-step, dialog or mini page) | `references/page-*.md` |
| Configuring one element (field, lookup, list, button, widget) | `references/block-*.md` |
| Choosing a component, grid coordinates, containers, island settings, the native look | `references/layout-mechanics.md` |
| Kinds of page without a file of their own, and when each kind fits | `references/page-patterns.md` |
| Whether to do something, which option, and why | `references/design-judgement.md` |
| How the page looks: hierarchy, colour budget, typography, native shapes | `references/visual-judgement.md` |
| Words: captions, messages, errors, empty states | `references/ux-writing.md` |
| Contrast, WCAG, status colour scale | `references/accessibility-and-colors.md` |
| Checking the rendered page in the browser | `references/visual-check.md` |
| A check for audits | `references/review-checklists.md`: one item with an ID, a tag and a pointer to the home, never the rule's text |

`SKILL.md` holds only the precedence rules, the reading map and one-line core rules that point to their homes. A number owned by a clio guide (chart sizes, tiles per row) is not restated: point to `get-guidance name=<guide>`.

Paragraphs pinned by tests move verbatim: the insert `index` rule (`tests/test_insert_index_doc.py`, `layout-mechanics.md`) and the read-only detail rule (`tests/test_read_only_row_menu_doc.py`, `block-lists.md`).
