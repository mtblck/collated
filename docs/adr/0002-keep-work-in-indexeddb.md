---
public: true
---

# 0002: The document is kept on the device, in IndexedDB

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (this PR)

## Context

Everything lived in memory, so a reload, a crashed tab or a phone discarding a
background tab threw away a document that may have taken twenty minutes to
arrange (#74). Collated's promise is that documents never leave the device, so
any fix had to stay local. localStorage holds about 5 MB of strings and would
need base64 for bytes; a document is often tens of megabytes. The Origin
Private File System would hold the bytes but not structured state, and its
synchronous API is worker-only. IndexedDB stores `Uint8Array`s and `Blob`s
directly, with a quota in the hundreds of megabytes or more, and its
transactions are all or nothing.

## Decision

We keep the whole undo history (metadata only, thumbnail URLs blanked), each
imported file's bytes once per `bytesId` and each asset's thumbnail blob in an
IndexedDB database, `collated-work`, written 400 ms after each change and at
once when the tab is hidden. Each save is one transaction that also deletes
bytes no state can reach. On the next visit the app offers **Restore your last
document?** and saves nothing until it's answered. The password is never part
of the document. Start over, Discard and the **Keep work after a reload** switch
(on by default) delete the copy; a quota failure deletes it too and says so once.

## Consequences

A reload is no longer data loss, and undo works across it. A copy of the
person's documents now sits on the device until they discard it, which the
privacy notice and guide say plainly; on a shared computer the switch matters.
Writes are bounded by the history: bytes go once, and only the metadata (a few
kilobytes per step) is rewritten. Revisit if the model gains state that must
not persist (it would need excluding from `StoredDoc`), if documents routinely
outgrow quotas, or if saving shows up in traces on large histories.
