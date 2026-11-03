import { useEffect } from 'react'
import { mount } from 'tipjar'
import 'tipjar/style.css'
import { SUPPORT_URL } from './links'

/**
 * The landing view's floating Support button (tipjar, ADR 0017). It sits in
 * the bottom-right corner, folds to its heart on a phone, and tucks away
 * while the footer, with its own Support Collated link, is on screen.
 * tipjar is bundled from npm, so nothing loads from elsewhere; no `look`
 * option, so no inline style for the CSP to block. Themed in index.css.
 */
export const TipButton = () => {
  useEffect(() => {
    const { destroy } = mount({
      href: SUPPORT_URL,
      description: 'Collated on Ko-fi',
      icon: 'heart',
      newTab: true,
      hideWhenVisible: 'footer',
    })
    return destroy
  }, [])
  return null
}
