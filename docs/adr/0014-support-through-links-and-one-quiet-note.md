---
public: false
---

# 0014: Support is asked for through plain links and one quiet note after export

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** <!-- filled in with the PR -->

## Context

Matt wants Collated to earn a little without going against its free,
open-source spirit or its privacy promise: no tracking, nothing third-party
loaded, CSP `script-src 'self'`. Options weighed:

- **Ad networks.** AdSense means third-party scripts, cookies, a consent
  banner and a looser CSP. EthicalAds and Carbon don't track but still load
  an outside script, mostly take developer sites, and pay per view, which is
  pennies at Collated's traffic. Ruled out.
- **Paywalled features.** Against the spirit of the project. Ruled out.
- **Donations as plain links.** Ko-fi (one-off tips, no account needed) was
  already in the header, footer and More menu (#36). GitHub Sponsors takes no
  fee on personal accounts and adds the repository's Sponsor button through
  `.github/FUNDING.yml`. Links load nothing, so the CSP doesn't change.

A link in the footer is rarely seen. The moment people feel the tool helped
is just after an export, so that's where to ask, but a prompt on every
export would be nagging, and one over an error would be tone-deaf.

## Decision

We link Ko-fi and GitHub Sponsors (`SUPPORT_URL`, `SPONSORS_URL` in
`src/components/links.ts`, the same handles in `FUNDING.yml`) and, after an
export that went as asked, show one small note in the notice corner
(`SupportPrompt`). It is not an alert and takes no focus. It shows at most
once a visit and once every 30 days, never alongside or over a notice, and
never again after **Don't ask again** or once a support link is followed.
The only thing kept is `collated:support-prompt` in local storage: the time
it last showed, or `off`.

## Consequences

Nothing loads from Ko-fi or GitHub until someone follows a link, and the
privacy notice lists the one new local value. We can't tell whether the note
works, by design; Ko-fi and GitHub Sponsors' own dashboards are the only
signal. A directly sold sponsor slot (a static image from our own origin)
remains possible later without a CSP change. If the note ever needs to ask
more often, or show anything fetched, that's a new ADR.
