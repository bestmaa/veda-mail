# Accessibility

Veda Mail targets WCAG 2.2 Level AA for its member mailbox and administration
surfaces. This is an engineering target, not a third-party certification. A
release is not described as fully conformant until automated checks and the
manual assistive-technology matrix below have both been completed.

## Interaction model

- A keyboard-visible skip link moves focus directly to the current mailbox
  heading.
- Native controls and semantic roles expose search, navigation, message lists,
  dialogs, alerts, status updates, and mailbox actions.
- Opening a reader, composer, or modal moves focus into the new context. Closing
  it restores the initiating control when that control still exists.
- Modal surfaces trap focus and make the background inert. Escape closes the
  topmost dismissible surface; destructive and uncertain-send decisions retain
  an explicit safe choice.
- Optional single-key mail shortcuts are disabled by default, documented in an
  accessible dialog, and suspended in inputs, editors, and modal dialogs.
- Pointer-only drag and drop always has a keyboard-accessible Move alternative.

## Visual and responsive behavior

- Primary interactive controls are at least 24 by 24 CSS pixels; important
  mobile actions use larger touch targets.
- Mailbox, reader, compose, settings, and sign-in flows reflow without page-level
  horizontal scrolling at a 320 CSS-pixel viewport, equivalent to 400% zoom on
  a 1280-pixel-wide display.
- Focus-visible indicators are retained for the primary keyboard path.
- User-provided accent colors receive a computed black or white foreground that
  maintains at least 4.5:1 contrast across the accepted color space.
- `prefers-reduced-motion: reduce` reduces transitions and animations to a
  non-perceptible duration and disables smooth scrolling.

## Automated release evidence

`tests/e2e/mail-wcag-audit.spec.ts` runs the WCAG 2.0, 2.1, and 2.2 A/AA axe
rules without ignoring moderate violations. It covers the signed-out entry
point, mailbox, reader, compose, and account settings, plus 320-pixel reflow,
focus visibility, target size, and reduced motion. Other focused browser tests
exercise modal focus containment, focus restoration, keyboard shortcuts,
mobile compose, conversations, attachments, contacts, templates, signatures,
and calendar invitations. `tests/unit/color-contrast.test.ts` verifies the
branding foreground algorithm across the web-safe RGB color cube.

Automated tools cannot prove complete screen-reader usability, meaningful
reading order, speech quality, cognitive clarity, or operating-system high
contrast behavior. They supplement rather than replace the manual matrix.

## Manual release matrix

Each release that closes an accessibility milestone records the browser,
assistive technology, version, date, tester, and result for:

| Platform | Assistive technology | Required flows |
| --- | --- | --- |
| Windows | NVDA with current Chrome | Sign in, mailbox navigation, read, compose/send, dialogs, settings, errors |
| macOS | VoiceOver with current Safari | Sign in, mailbox navigation, read, compose/send, dialogs, settings, errors |
| Browser zoom | Chrome at 200% and 400% | Mailbox, reader, compose, settings, no two-dimensional page scroll |
| Motion | Reduced-motion OS preference | Loading, dialogs, notices, hover/focus transitions |
| Contrast | Windows forced-colors mode | Focus, selection, inputs, primary and destructive actions |

Current automated evidence is enforced in CI. The current roadmap checkbox
requires the Windows screen-reader row against the deployed build. The project
owner deferred the unavailable macOS/Safari row on 2026-08-15; it remains a
future compatibility validation and is not represented as a passing result.

### Current Windows release evidence

The production audit began on 2026-08-14 and continued on 2026-08-15 against
deployed commit `27c45d7` with Chrome `151.0.7922.138` on Windows 11. The
successful-Send remediation was then released through PR #184 and deployed on
2026-08-16 from commit `ca58632909c92d16d1623e83aa2a4bb5a1ba8591` as immutable
OCI index
`sha256:35c342ece3dc2f9aba1b6f1d9f513f2ce044fdeba33dc5a5dd37139733fea4bd`.
The following deployed checks have passed:

- The first Tab stop exposes **Skip to message list**. Activating it moves focus
  to the Inbox heading and retains a visible two-pixel focus indicator.
- The keyboard-shortcut guide moves focus into the dialog. Escape closes it and
  restores focus to its trigger.
- Account settings moves focus to its close control. Enter or Escape closes the
  dialog and restores focus to the account-settings trigger.
- The composer exposes labelled recipient, subject, message, formatting,
  attachment, scheduling, draft, and send controls. Attempting an empty send
  produces the assertive `Add at least one recipient.` validation message, and
  Escape closes the empty composer and restores its trigger.
- At 640 and 320 CSS-pixel viewports, the deployed mailbox has no page-level
  horizontal overflow. At 320 pixels, both the compose dialog and the full
  account-settings dialog remain inside the viewport without horizontal
  overflow.
- Chrome's native zoom controls were exercised at 200% and 400% on a 1920-pixel
  display. Chrome reported 960 and 480 CSS-pixel viewports respectively, with
  device-pixel ratios of 2 and 4. At both levels, the mailbox, message reader,
  compose dialog, and full account-settings dialog had no page-level horizontal
  overflow. The compose and settings dialogs remained inside the viewport and
  had no internal horizontal overflow. Zoom was restored to 100% after the test.
- Official NVDA `2026.1.1` with add-ons disabled announced the Veda Mail Chrome
  window and the skip link's name, role, visited state, and same-page target.
  Activating the link announced `Inbox, heading, level 1`.
- NVDA announced mailbox folders and Search mail with its editable autocomplete
  semantics. An existing synthetic message in Trash announced its subject as a
  level-two heading; reader controls announced Reply, Reply all, and Forward,
  and returning to the list restored focus to that message's Open button.
- The compose dialog announced its dialog name, To autocomplete combobox, Cc
  and Bcc disclosure buttons, Subject edit, and required multiline Message body.
  Empty Send announced `alert, Add at least one recipient.`, and Escape restored
  focus to the Compose message trigger.
- The keyboard-shortcut guide announced its dialog title, close button, 22-item
  shortcut list, key/action pairs, and the explanation of suspended shortcuts.
  Account settings announced its dialog title, initial close button, loading
  state, and required Display name edit. Both dialogs restored their triggers
  on Escape.
- The permanent-delete alert dialog announced its title, irreversible-action
  description, safe Cancel button, and destructive action. Escape cancelled the
  dialog without deleting the message and restored focus to the trigger.
- A synthetic self-addressed message with subject
  `Veda Mail NVDA acceptance 2026-08-15` was successfully submitted on
  2026-08-15. The deployed UI incremented both Inbox and Sent Items and the
  Sent Items mailbox exposed the exact subject and body. The NVDA session did
  not retain foreground focus during submission, so this proves delivery but
  does not yet prove the successful-Send announcement.
- A second authorized self-addressed message with subject
  `Veda Mail NVDA announcement retry 2026-08-15` was also submitted. Inbox and
  Sent Items both incremented to two and exposed the exact subject and body.
  NVDA remained attached to the foreground YouTube tab while the browser
  extension submitted the message in a background Veda Mail tab, so this retry
  again proves delivery but not the successful-Send announcement. A later
  foreground-only probe reproduced and documented that tab-focus limitation.
- Further authorized foreground retries confirmed delivery through five Inbox
  and Sent Items copies. With the correct Veda Mail tab visibly foregrounded,
  NVDA announced the compose dialog and the Send control changing to
  `Sending…`; it did not announce successful completion even though Drafts
  cleared and Inbox and Sent Items incremented. This isolated a product defect:
  the composer-owned live region unmounted when a successful send closed the
  dialog. The remediation keeps a polite, atomic `Message sent.` status mounted
  in the workspace and resets it when the next composer opens. Automated
  component coverage passed before release.
- The remediated production build was re-tested with official NVDA `2026.1.1`,
  add-ons disabled, and the Veda Mail Chrome window visibly foregrounded. A
  Windows-level pointer activation of Send caused NVDA to record `Sending…`
  followed by `Message sent.`. The composer closed, Inbox incremented from four
  to five, Sent Items incremented from six to seven, and both mailboxes exposed
  the exact subject and body of the synthetic self-addressed message
  `Veda Mail NVDA live region pass 2026-08-16`.
- With Windows client-area animations temporarily disabled, Chrome reported
  `prefers-reduced-motion: reduce`. Veda Mail computed animation and transition
  durations of `0.01ms` and root scrolling as `auto`, as required by the
  reduced-motion stylesheet. The Windows animation preference was restored.
- With Windows High Contrast temporarily enabled, Chrome reported
  `forced-colors: active`. Veda Mail exposed system foreground/background and
  border colors for the focused account control, Search mail input, selected
  Inbox, primary compose action, and permanent-delete confirmation. Cancel
  closed the destructive dialog without deleting the message and restored focus
  to the permanent-delete trigger. High Contrast, its flags and scheme,
  animations, transparency, and Chrome zoom were restored to their original
  values after the test.

The Windows/NVDA, zoom/reflow, reduced-motion, and forced-colors rows are
accepted for this release. Only synthetic, non-sensitive mailbox content was
used. macOS Safari with VoiceOver is explicitly deferred because no Mac is
available; it is not represented as passing and does not block the current
Windows acceptance milestone.

## Content boundary

Veda Mail sanitizes inbound HTML and preserves useful semantic elements, but it
cannot guarantee that arbitrary sender-authored content is accessible. Remote
images stay blocked by default, unsafe active content is removed, and plain-text
fallback remains available. Attachment preview support is deliberately limited
to isolated, allowlisted formats.

Please report accessibility defects through the public issue tracker without
including private email content, credentials, or attachment data. Include the
affected flow, browser, assistive technology, viewport or zoom level, and the
expected focus or announcement.
