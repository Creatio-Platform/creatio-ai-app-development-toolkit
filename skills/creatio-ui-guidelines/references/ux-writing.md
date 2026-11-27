# UX writing for Freedom UI pages

Use this reference when you write or review the words on a Freedom UI page: button and menu captions, field labels, placeholders and tooltips, validation and error messages, empty states, confirmation dialogs, status and progress messages, and the wording around values an AI skill or a process filled in. It is the deeper guide behind the copy rules that already live elsewhere in this skill — the tooltip and placeholder rule in `SKILL.md` (*Mandatory implementation rules*) and the sections *Text, labels, and messages*, *Fields*, *Buttons and actions*, *Long-running and destructive actions* and *Dialogs and modals* in page-layout-and-controls.md. Those rules stay where they are and are not repeated here; each section below names the one it builds on. The through-line: **say what will happen, in the words the business already uses.** A button captioned *Submit* is a defect in the same way a gap in the layout is — it just does not show in the page schema.

## Contents

1. Buttons and actions
2. Terminology and consistency
3. Field labels and helper text
4. Errors: prevention, then recovery
5. Empty states
6. Confirmations and destructive actions
7. System status and progress
8. AI output, confidence and approval
9. Copy that depends on what sits beside it
10. Writing for localisation
11. Style basics
12. Check the words on the rendered page

## 1. Buttons and actions

Placement, the one-primary rule, icons and menus are in page-layout-and-controls.md, *Buttons and actions*; sentence case and "result-oriented, not *Click here*" are in *Text, labels, and messages*. This section is about the caption itself.

**A button caption says what the button does.** The test: read the caption with the rest of the page covered. If you cannot tell what happens when it is clicked, rewrite it.

| Before | After | Why |
|---|---|---|
| Submit | Send for approval | names the outcome |
| Manage | Edit access rights | names the verb and the object |
| Process | Recalculate totals | "process" is not something anyone does |
| Run | Run reconciliation | names what runs |
| OK | Delete 12 invoices | says what the user agrees to |
| Apply | Apply filters | names the object |
| Yes / No | Cancel order / Keep order | a dialog's buttons answer its question |
| Finish (last step of a stepper) | Create rental request | the last step names what completing it creates |

- **Start with a verb and drop the article:** *Add contact*, not *Add a contact*.
- **Keep the platform's own captions.** Buttons and actions the template or the platform provides (*Save*, *Cancel*, *Close*, the standard delete, *Print*) keep their standard caption, so the same function has the same name on every page — see accessibility-and-colors.md, *Element size & appearance* (consistent identification). Write outcome captions for the buttons you add.
- **Two different acts get two captions.** When a page has *Save* and also an action that sends, publishes or posts the record, caption the second by its outcome (*Send to customer*, *Post to ledger*), never a second *Save*.
- **Step navigation stays generic; the step that commits does not.** *Next* and *Back* between stepper steps are navigation and stay the same on every step; the button that finally creates, sends or submits says what it creates or sends.
- **An icon-only button's `Title` / tooltip is its caption** and follows the same rule: *Add contact*, *Refresh balance* — never *Button 1* or the icon's name.
- **Menu items follow the same verb-plus-object rule** and do not repeat the menu's own word: under *Actions*, write *Export to Excel*, not *Action: export*.
- Author every caption you add as a localizable string (section 10).

## 2. Terminology and consistency

Sentence case and "use typical wording from existing Creatio interfaces" are in page-layout-and-controls.md, *Text, labels, and messages*. This section is about which word to use.

**Use the business's words, not the schema's.** If the organisation says *claim* and the object's code name is `UsrReimbursementRequest`, every caption says *Claim*. Code names follow the schema-naming rules of the creatio-schema-naming skill; the caption the user reads is a separate, localizable value and is written for the user.

**Set the word on the object, not on one page.** A field's label normally comes from the column caption on the object, and lists, filters, exports and other pages reuse that caption. Fix a wrong word on the column caption so every place that binds it agrees; overriding the label on a single page creates a second word for the same thing.

**Labels name things; they never narrate.** A caption is what the application would call the field, not a description of what sits under it.

| Before | After |
|---|---|
| Where the time has gone | Notes |
| Breaches at | Deadline |
| What the new card will do | Card settings |
| Confirming it is you | Identity checks |

Explanation belongs in the tooltip, the description line or a helper line under a heading — never in the caption.

**Tabs and groups are named by what they hold.** A tab caption tells the user what they will find there in the business's words: *Budget and payments*, *Schedule and tasks*, *Site and building*. Catch-all captions — *Details*, *Other*, *Misc*, *Info*, *Money*, *Additional* — say nothing; if the content has no common name, the grouping is wrong, not the caption.

**One word per concept, across the app and with base Creatio.** Pick one of *delete / remove / archive*, *client / customer / account*, *user / member / person* and never mix them. When base Creatio already names a concept on a related page — the owner of a record, the account of a contact — reuse its word. Two words for one thing make people look for a difference that does not exist.

**Words that mean different things stay different:**
- **Delete** — the record is gone.
- **Remove** — taken out of this list or link; the record still exists elsewhere (removing a contact from an opportunity's contact list).
- **Archive / deactivate** — out of the way, recoverable.
- **Cancel** — on Creatio dialogs and mini pages, *Cancel* closes without saving; keep that platform meaning. A business action that cancels an order, a booking or a subscription is captioned with its object — *Cancel order* — and its counterpart is *Keep order* or *Close*, never a second bare *Cancel*.

**Do not invent business terminology.** If the page needs a term the business does not use, that is a question for the product owner, not a gap to fill with something plausible: an invented term spreads into training material and support scripts and is hard to pull back.

**Keep configuration words out of end-user copy.** *Lookup*, *detail*, *entity*, *schema*, *business rule*, *record set* and *instance* are words for the people who configure Creatio. End users see *Contacts*, *Order lines*, *Status*.

## 3. Field labels and helper text

The tooltip and placeholder rule — when a field needs guidance, how specific it must be, and that it is a localizable string — is in `SKILL.md`, *Mandatory implementation rules*. Choosing between placeholder, tooltip and description line, the *Add …* placeholder for empty optional fields, and the read-only tooltip are in page-layout-and-controls.md, *Fields*. This section adds how to word them.

- **Labels are short nouns in the business's words:** *Expected close date*, not *Date*; *Delivery address*, not *Address info*.
- **No colons, no articles, sentence case.**
- **A placeholder is not a label.** It disappears when typing starts and it carries less contrast than the label; never hide a label and let the placeholder stand in for it. Use the placeholder for a format or a sample value only, with the label present.
- **State the rule before it is broken.** A tooltip or description line that says the limit up front beats a validation message afterwards.
- **Explain why where the rule is surprising.** *Used to match payments on the bank statement* tells the user whether to be careful.
- **For a read-only or calculated field, name the source and the moment it changes.**
- **A checkbox is captioned with the state it sets, not as a code-style question.** *Critical project*, *Overdue*, *Permit required* — not *Is critical*, *Is overdue*, *Requires permit?* The same caption serves the field and the list column.
- **Mark required the way the platform does.** Required fields carry the platform's own required marker (page-layout-and-controls.md, *Fields*); do not add *(required)* or *(optional)* to captions, and do not add a legend explaining the marker.

| Field | Before | After |
|---|---|---|
| Invoice number — placeholder | Enter number | INV-000123 |
| Discount, % — placeholder | Discount | 0–30 |
| Discount, % — tooltip | Discount for the order | Up to 30% applies at once. A higher discount sends the order for approval |
| Tax ID — description line | Tax ID of the company | 10 digits, no spaces. Used to match payments on the bank statement |
| Score (calculated) — tooltip | Read-only field | Calculated from deal size, stage and last activity. Updates when the record is saved |
| Responsible — tooltip | Select responsible | Only employees of the account's region are listed |

## 4. Errors: prevention, then recovery

Error rules already in place: page-layout-and-controls.md, *Text, labels, and messages* (admin and regular-user messages differ) and *Dialogs and modals* (dialog errors say what to do next); accessibility-and-colors.md, *Inputs, forms & validation* (errors identified, required marked at entry). This section is the wording and where each kind of message comes from.

**The best error message is the one never shown.** Design the error out first with what Creatio already provides: a simple lookup with filtered values instead of free text, defaults and auto-substitution, a date-only column for a date, business rules that make a field required, read-only or hidden until it applies and that filter lookup values, and action buttons hidden or disabled while they cannot be used (page-layout-and-controls.md, *Buttons and actions*).

When an error does happen, its text has three jobs:

1. **Say what happened**, specifically.
2. **Say what to do about it.**
3. **Say it without blame or jargon.**

| Before | After |
|---|---|
| Invalid input | Enter a date in the future |
| Discount can't be blank | Add a discount code |
| An error occurred | Couldn't save — your session expired. Sign in to continue |
| Error 4012 | This account number doesn't match any supplier. Check the digits or search suppliers |
| Operation failed | 3 of 12 invoices couldn't be posted — the period is closed |
| Value must be greater than StartDate | End date must be after the start date |

**Where each message comes from, and how to write it:**
- **Required by a business rule.** The platform shows its own required message under the field; the field's label already says *what*, so make the label specific instead of adding a custom validator that restates "required".
- **A page validator on a field** (the page schema's `validators`, attached to the field's attribute). The message renders under its field, so it only needs to say *why* and *what to do* — the field already says what. Pass the message as a localizable string (`#ResourceString(<Key>)#`), never as an inline literal, and resolve the exact validator shape for the target version rather than writing it from memory.
- **A server-side check that rejects the save** (an event listener, a process, a web service). Its text reaches the user as written. Write it for the end user, localize it, and keep the technical detail — exception type, stack, query — in the log.
- **An error about the whole record or a bulk action**, not one field: show it where it stays until the user acts on it — a dialog with the next step, or a message area on the page. A snack-bar that disappears while the user is still reading is for status, not for errors.

**Partial failure gets real words.** *12 selected, 3 failed* is a different message from *Done*, and it needs a way to reach the three.

**Severity shows in tone as well as colour.** Red is for broken or blocked; a softer warning is for something that needs attention inside a normal flow. Use the semantic scale in accessibility-and-colors.md, *Freedom UI color guidance*; if everything is red, red means nothing.

## 5. Empty states

The *Add …* placeholder for an empty optional field is in page-layout-and-controls.md, *Fields*; a list's or detail's own *No data* text is rendered by the component. This section covers what to write where you control the words.

Four situations that are routinely given one generic text:

| Situation | What it should say |
|---|---|
| **Nothing yet** (first use, a new record's detail) | what the area is for and the one action to begin: *No delivery addresses yet. Add the first address to ship this order* + *Add address* |
| **Nothing matched** (filtered) | that the filters are the reason, and a way out: *No cases match these filters* + *Clear filters* |
| **Nothing to do** (a worked queue, a zero metric) | a short good-news line: *No approvals waiting*. Nothing more — this is a good state |
| **Could not load** (failure) | that it is a failure, not emptiness, and what to try: *Couldn't load cases. Retry* |

- **Check what the component lets you author.** Resolve the list, detail or widget with `get-component-info`; if it exposes an empty-state text input, write it per the table. If it does not, the component's own text stands — do not lay a hand-built message over it.
- **Keep the filtered case honest.** A filtered-to-nothing list that reads like an empty one sends people to support, believing their records vanished. When you add custom filters (page-layout-and-controls.md, *List (section) page layout*), make sure their active state stays visible on the rendered page, so an empty result reads as filtered.
- **Where only the surrounding copy is yours**, use the one-line helper under the heading (page-layout-and-controls.md, *Text, labels, and messages*) to say what the area is for.
- Keep it to a line or two: say what is missing and offer the next step; do not teach the whole page.

## 6. Confirmations and destructive actions

When an action needs a confirmation, undo or cancel is in page-layout-and-controls.md, *Long-running and destructive actions*, and accessibility-and-colors.md, *Inputs, forms & validation* (SC 3.3.4). This section is how the confirmation reads.

- **Do not confirm what is reversible.** A confirmation on an undoable action is a tax people learn to click through — and then they click through the one that mattered. Prefer undo.
- **Do not double the platform's confirmation.** The standard delete already asks; do not add a second dialog in front of it.
- **Confirm when the action is irreversible, bulk or expensive:** it sends email, posts to an external system, starts a process for many records, or deletes for good.
- **The title asks the real question:** *Delete selected invoices?*
- **The body states the consequence**, including what cannot be undone: *The invoices are deleted permanently. This can't be undone.*
- **The buttons are the two outcomes:** *Delete invoices* / *Cancel* — never *Yes* / *No*.
- **The destructive button is not the default focus**, and it carries the destructive or danger style the platform dialog offers — resolve it, do not hand-style it.
- **Say the count.** *Delete selected items?* is how people delete 240 rows believing they had 4. Write the count in a form that survives translation (section 10): *Selected: 12*.
- **For the genuinely severe, ask the user to type the name** of what is being destroyed — only where the dialog or a modal page can carry an input; do not invent a component for it.

Worked example — a bulk action that sends email to every contact of the selected accounts:

| Part | Before | After |
|---|---|---|
| Title | Are you sure? | Send the price update to selected accounts? |
| Body | This action will be performed | Each contact of the selected accounts gets the email now. Sent email can't be recalled. Accounts selected: 18 |
| Buttons | Yes / No | Send email / Cancel |

## 7. System status and progress

The mechanism — loading mask, snack-bar, asynchronous run with a notification, *last updated* for external data — is in page-layout-and-controls.md, *Long-running and destructive actions*. This section is the wording.

| Moment | Before | After |
|---|---|---|
| While it runs | Processing… | Posting 240 invoices |
| When it finishes | Done | 240 invoices posted. 3 failed — open the 3 |
| Long work moved to the background | Please wait | The export runs in the background. You'll get a notification when the file is ready |
| External data | Data may be outdated | Balance updated from the bank at the time shown |

- **Say what is happening in the user's terms**, naming the object and, where known, the count.
- **Give progress where you can**, especially for anything that takes longer than a moment; a determinate progress changes how long the wait feels.
- **Name what finished and what it changed**, and keep the failures reachable.
- **Say where long work went**, so the user is free to leave the page.
- **Do not duplicate the platform's own status.** The standard save already reports itself; add a message only for actions you add.
- **Status is announced without taking focus.** Use the platform's notification and message mechanisms, which do this (accessibility-and-colors.md, *Localization, links & status*), rather than a hand-built overlay.

## 8. AI output, confidence and approval

This is where careless wording does the most damage, because the user has to decide how much to trust a value. On a Freedom UI page it applies to anything a Creatio.ai skill, an AI action or an automated process wrote or proposed: a suggested priority, a drafted email, a summary, a matched record. This skill assumes no dedicated "AI suggestion" component; check the target catalog with `get-component-info`, and where there is none, carry the distinction in captions, tooltips and where the value is stored — do not hand-build one.

- **Separate the voices.** The agent proposes, the system reports, the record states facts, and the three must read differently. A suggestion written straight into a regular field reads as a stored fact and will be believed as one. Keep a proposal in its own clearly captioned place (*Suggested priority*) until a person applies it, or name its source in the tooltip.
- **Hedge honestly, not decoratively.** *Based on this account's orders over the last 24 months* is useful; *I think* is noise; *This is likely correct* with no basis is worse than nothing.
- **Show confidence only where it changes what the user does.** If two scores lead to the same action, show neither. If a threshold routes an item to review, show the threshold and what it did.
- **Name the basis** — which records, which period, which rule — so the user can inspect it and trust it as much as it deserves, sometimes less.
- **State what approving does before the click, including scale:** *Approving applies this to 12 cases.*
- **Never pre-select approve.** The default and the initial focus are always the safe outcome.
- **Say plainly what cannot be undone** — sending email, moving money, changing records in an external system are the cases where this matters most and is most often left out.

| Before | After |
|---|---|
| Confirm | Approve and post to the ledger |
| Accept suggestion | Apply to all 12 matching cases |
| Reject | Reject and add a reason |
| AI-generated | Drafted by Creatio.ai, not reviewed yet |

## 9. Copy that depends on what sits beside it

Business rules hide and show fields, panels and steps; templates move blocks; a later edit removes a panel. The text around them usually keeps pointing at what is gone. Three kinds of breakage, all of which read fine on their own:

1. **Pointing words.** *Fill in the fields below*, *on the left*, *this list*, *as shown above* — pointing at a block that, in this rule state or after this edit, is not drawn.
2. **Counts taken from something else.** *All three documents are required* on a step that now asks for two.
3. **An answer without its question.** A helper line or a summary that explains a value that is not on the page.

**Sweep for it rather than reading for it.** List the visible strings that contain *this record, the record, this list, the list, below, above, on the left, on the right, beside, here, shown, you opened*, then check each one on the rendered page in every state a business rule can produce — and again after any field, panel or step is removed. Most hits are fine; the few that are not would have shipped. Do not write counts that come from data into a string; bind them, or word the text so it holds for any count.

## 10. Writing for localisation

`SKILL.md` requires tooltip and placeholder text to be localizable strings; accessibility-and-colors.md, *Localization, links & status*, requires every element to be translated into all enabled languages. This section is how to write strings that survive translation.

- **Every user-visible string is a localizable string:** captions, button and menu labels, tooltips, placeholders, description and helper lines, validator messages, dialog titles, bodies and buttons, empty-state and status text. Column captions are localized on the object. An inline literal shows the same untranslated text to every culture.
- **Name a resource key after its role, not its wording** (a discount tooltip, not the sentence it holds), so rewording the text does not leave a misleading key.
- **Never build a sentence by concatenation.** *"You have " + n + " item(s)"* breaks in every language with grammatical number. Use one whole string with a placeholder for the value, and where the count changes the grammar, word it so it holds for any number: *Selected: 12*, *Invoices to post: 240*.
- **Leave room.** Translations commonly run a third longer than English, and some much more. Keep buttons in a flex container (page-layout-and-controls.md, *Buttons and actions*) and never shorten the English to make a fixed width fit.
- **No idiom, wordplay or humour.** It has no translation and reads badly in a business system.
- **Do not put meaning in word order** a translator cannot keep — for example a sentence split across a label and the field after it.
- **Keep sentences short and single-clause** — easier to read, easier to translate, better for people working in a second language.
- **Dates, numbers and currency are formatted by the platform from the user's culture, never written by hand into a string.** A date field with the platform's date picker usually needs no format placeholder; where a typed format hint is needed, it shows the format the user's culture actually uses.

## 11. Style basics

Sentence case, no Title Case or all caps, and no closing period in short helper text are in page-layout-and-controls.md, *Text, labels, and messages*. Beyond those:

- **Active voice:** *The system couldn't reach the bank*, not *The bank could not be reached*.
- **Second person for the reader.** Keep the corporate *we* for cases where people really do something (*We'll email you when it's ready*).
- **Short words:** *use*, not *utilise*; *help*, not *assist*; *start*, not *initiate*.
- **Cut the words that do nothing:** *Please note that*, *In order to*, *You can now*, *Click here to*.
- **Contractions** read naturally — *can't* over *cannot* — but match the base product's copy in the same area, and keep them out of legal and regulatory text, where precision is the point.
- **No jargon the reader does not use**, including Creatio's own configuration vocabulary (section 2).
- **No emoji** in captions, labels, empty states, dialogs or notifications.

## 12. Check the words on the rendered page

Copy defects hide in the schema the same way layout defects do (`SKILL.md`, *Judge the rendered page, not the schema*). Before calling the copy done:

- **Read every string on the rendered page**, in each state the page can be in: a new record, a filled one, read-only, each business-rule branch, each stepper step, each dialog the page opens.
- **Cover-test every button and menu item** (section 1).
- **Run the pointing-word sweep** (section 9).
- **Check that nothing shows a resource key, an untranslated string or a mixed language**, and, where the environment has a second culture enabled, look at the page in it for truncated captions.
- **Check that every message you wrote appears where the user is looking** — validator messages under their field, errors in a place that stays, status without stealing focus.
- **Report what you checked and what you did not** — for example, "copy read in all three rule states; second culture not enabled on this environment, translations not seen rendered".
