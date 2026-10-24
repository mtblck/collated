/** Where Collated points, inside and outside itself. One place, so the app,
 * the docs pages (docs-site.ts) and verify all agree. */
const BASE = '/'

export const SOURCE_URL = 'https://github.com/mtblck/collated'
export const ISSUES_URL = 'https://github.com/mtblck/collated/issues'
/** Ko-fi page for donations (#36). */
export const SUPPORT_URL = 'https://ko-fi.com/mtblck'
/** GitHub Sponsors, for monthly support; also in .github/FUNDING.yml. */
export const SPONSORS_URL = 'https://github.com/sponsors/mtblck'

export const APP_URL = BASE
export const DOCS_URL = `${BASE}docs/`
export const PRIVACY_URL = `${BASE}privacy/`
export const TERMS_URL = `${BASE}terms/`

export interface FooterLink {
  label: string
  href: string
  /** Leaves the site: opens in a new tab, without a referrer. */
  external?: boolean
}

/** The footer's columns, on the landing view and every docs page. */
export const FOOTER: readonly { title: string; links: readonly FooterLink[] }[] = [
  {
    title: 'Collated',
    links: [
      { label: 'Open Collated', href: APP_URL },
      { label: 'Docs', href: DOCS_URL },
      { label: 'Support Collated', href: SUPPORT_URL, external: true },
    ],
  },
  {
    title: 'Open source',
    links: [
      { label: 'Source code', href: SOURCE_URL, external: true },
      { label: 'Report a problem', href: ISSUES_URL, external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: PRIVACY_URL },
      { label: 'Terms', href: TERMS_URL },
    ],
  },
]
