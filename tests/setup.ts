import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom has <dialog> but not showModal()/close() — every supported browser
// does. A minimal shim: open/close and the close event the app listens for.
// (No focus trapping or top layer; the browser verify covers those.)
if (
  typeof HTMLDialogElement !== 'undefined' &&
  !(
    'showModal' in HTMLDialogElement.prototype &&
    typeof HTMLDialogElement.prototype.showModal === 'function'
  )
) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ) {
    if (returnValue !== undefined) this.returnValue = returnValue
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

// jsdom hides closed popovers (display: none) but can't open them: no
// showPopover() and no popovertarget, and :popover-open never matches. Since
// jsdom 30 it also won't focus anything display: none, so tests must open a
// popover before using its controls, as a person would. A minimal shim:
// open state as an attribute, the three methods, :popover-open, and
// popovertarget buttons. (No light dismiss, top layer or toggle events; the
// browser verify covers those.)
if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover !== 'function') {
  const OPEN = 'data-popover-open'
  const style = document.createElement('style')
  // `!important`: jsdom doesn't let author styles outrank its own stylesheet.
  style.textContent = `[popover][${OPEN}] { display: block !important; }`
  document.head.append(style)

  const isOpen = (el: HTMLElement) => el.hasAttribute(OPEN)
  const check = (el: HTMLElement, open: boolean) => {
    if (!el.hasAttribute('popover')) throw new DOMException('Not a popover', 'NotSupportedError')
    if (isOpen(el) !== open)
      throw new DOMException(`Popover already ${open ? 'closed' : 'open'}`, 'InvalidStateError')
  }
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    check(this, false)
    // popover="auto": opening one closes the others.
    for (const other of document.querySelectorAll<HTMLElement>(`[popover="auto"][${OPEN}]`))
      other.removeAttribute(OPEN)
    this.setAttribute(OPEN, '')
  }
  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    check(this, true)
    this.removeAttribute(OPEN)
  }
  HTMLElement.prototype.togglePopover = function togglePopover(this: HTMLElement, force?: unknown) {
    const open = typeof force === 'boolean' ? force : !isOpen(this)
    if (open !== isOpen(this)) {
      if (open) this.showPopover()
      else this.hidePopover()
    }
    return open
  }

  // Through the descriptor: matches() is overloaded, and is only ever .call()ed.
  const matches = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')?.value as (
    this: Element,
    selectors: string,
  ) => boolean
  Object.defineProperty(Element.prototype, 'matches', {
    value(this: Element, selectors: string) {
      return matches.call(this, selectors.replaceAll(':popover-open', `[${OPEN}]`))
    },
  })

  document.addEventListener('click', (event) => {
    const invoker =
      event.target instanceof Element ? event.target.closest('button[popovertarget]') : null
    if (!invoker || event.defaultPrevented || (invoker as HTMLButtonElement).disabled) return
    const target = document.getElementById(invoker.getAttribute('popovertarget') ?? '')
    if (!target?.hasAttribute('popover')) return
    const action = invoker.getAttribute('popovertargetaction') ?? 'toggle'
    if (action === 'show' && !isOpen(target)) target.showPopover()
    else if (action === 'hide' && isOpen(target)) target.hidePopover()
    else if (action === 'toggle') target.togglePopover()
  })
}
