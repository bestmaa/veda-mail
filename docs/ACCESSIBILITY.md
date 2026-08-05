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

Current automated evidence is enforced in CI. The roadmap checkbox remains
open until the two screen-reader rows and forced-colors row are executed against
the deployed build and their results are recorded.

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
