# Advanced mail search

Veda Mail uses one bounded, provider-independent search grammar. The browser
parses and canonicalizes a query for immediate feedback, and the HTTP boundary
parses it again before any provider call. All terms use AND semantics.

## Grammar

| Form | Meaning |
| --- | --- |
| `words` or `"exact phrase"` | Provider full-text search |
| `from:`, `to:`, `cc:` | Address/header text |
| `subject:`, `body:` | Subject or body text |
| `after:YYYY-MM-DD` | Received on or after the calendar date |
| `before:YYYY-MM-DD` | Received before the calendar date |
| `larger:`, `smaller:` | Strict byte boundary; K/M/G use binary units |
| `has:attachment` | Message has an attachment |
| `is:read`, `is:unread` | Seen state |
| `is:starred`, `is:unstarred` | Flagged state |
| `in:mailbox` | One exact case-insensitive mailbox name or standard role |

Quote any value containing spaces. Inside quotes, `\"` represents a quote and
`\\` represents a backslash. Quoting preserves a phrase as one provider search
term; the upstream server still owns its language tokenization and collation.

`in:` accepts one mailbox per query and overrides the currently selected
mailbox. Standard roles include Inbox, Sent, Drafts, Archive, Spam, and Trash;
custom mailbox names may be quoted. Veda Mail resolves this selector against
the authenticated account, rejects missing or ambiguous names, and removes it
before compiling the remaining provider filter.

## Provider behavior

Stalwart JMAP compiles the query into one bounded `Email/query` AND filter.
Standard IMAP compiles supported terms into bounded IMAP SEARCH batches and
intersects UID sets when a key is repeated. IMAP has no portable native
attachment predicate, so `has:attachment` returns `MAIL_SEARCH_UNSUPPORTED`
with HTTP 422 instead of silently returning a broader result.

Date-only behavior is deliberately portable at protocol granularity: `after:`
includes the named date and `before:` excludes it. JMAP compares `receivedAt`
at UTC midnight; IMAP uses its standard INTERNALDATE calendar-day semantics,
whose day boundary is server-defined. Size comparisons are strict. A selected
mailbox always scopes provider work, including a query that contains only `in:`.

## Browser behavior and privacy

The search box offers grammar hints plus at most five recent canonical searches
held only in the mounted browser session. Active terms are removable chips.
The current canonical query is shareable through the `#search=` URL fragment
and restores after reload. The fragment contains search text only—never the
mail session scope, provider credentials, or account secrets—and is removed on
session invalidation.

The complete query is limited to 1,000 characters, 20 terms, and 200 characters
per value. Control characters, unfinished quotes, invalid dates, impossible
ranges, conflicting states, repeated mailbox selectors, and unknown operators
fail before provider access. Cursor signatures bind the canonical query and
effective mailbox so a cursor cannot be replayed into another search.

No database migration, Stalwart configuration, IMAP server setting, or new
network port is required.
