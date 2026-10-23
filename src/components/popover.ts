import { useEffect, type RefObject } from 'react'

/**
 * popover="auto" stays open when Tab leaves it, covering whatever is behind
 * (the inspector, on a laptop). Close it when focus moves outside, unless
 * focus went to its own toggle (which closes it anyway).
 */
export const useCloseOnFocusOut = (panel: RefObject<HTMLElement | null>, panelId: string) => {
  useEffect(() => {
    const el = panel.current
    if (!el) return
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget
      if (!(next instanceof HTMLElement) || el.contains(next)) return
      if (next.getAttribute('popovertarget') === panelId) return
      try {
        if (el.matches(':popover-open')) el.hidePopover()
      } catch {
        /* no popover support (jsdom) */
      }
    }
    el.addEventListener('focusout', onFocusOut)
    return () => {
      el.removeEventListener('focusout', onFocusOut)
    }
  }, [panel, panelId])
}

/** Closes the popover an element sits in (after choosing something in it). */
export const closeOwnPopover = (from: Element) => {
  try {
    from.closest<HTMLElement>('[popover]')?.hidePopover()
  } catch {
    /* already closed */
  }
}

/**
 * A toolbar popover panel. Placed under its button where the browser can
 * anchor popovers (`.popover-start` / `.popover-end` in index.css), else
 * pinned near the top corner; on phones, a sheet along the bottom.
 */
export const POPOVER_PANEL = 'm-0 overflow-y-auto rounded-2xl bg-paper text-ink shadow-panel'
/**
 * A panel that never scrolls itself, for one that scrolls part of its
 * content and pins the rest (the export options' foot). It has no border:
 * the inner frame carries it, so its height limit matches the panel's.
 * (Both are drawn by the shadow, which takes no room.)
 */
export const POPOVER_FRAME = 'm-0 overflow-hidden rounded-2xl bg-paper text-ink shadow-panel'

/** The usual panel's width; with its padding (one of each: see controls.tsx on why). */
export const POPOVER_WIDTH = 'w-[min(22rem,calc(100vw-1rem))]'
export const POPOVER_BOX = `${POPOVER_WIDTH} p-5`
