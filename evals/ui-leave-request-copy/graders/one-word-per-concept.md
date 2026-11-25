---
type: llm
weight: 1
---

Each action keeps one name across the button, its confirmation dialog and its success message: for example the button "Cancel leave", a confirmation button "Cancel leave" and a message "Your leave has been canceled" all use the same verb. Fail only if the same action is called by different verbs in different strings (e.g. button "Withdraw request" but message "Your request has been recalled").
