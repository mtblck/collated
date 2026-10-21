import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

const itemsIn = (bar: HTMLElement) =>
  [...bar.querySelectorAll<HTMLElement>('[data-toolbar-item]')].filter(
    (el) => !el.hasAttribute('disabled'),
  )

/**
 * WAI-ARIA toolbar: one Tab stop for the whole bar, arrow keys (and Home /
 * End) between its controls, and Tab from a popover's button goes into that
 * popover (browsers put an open popover right after its invoker). Controls
 * inside popovers aren't toolbar items, so their own arrow keys still work.
 */
export const Toolbar = ({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) => {
  const bar = useRef<HTMLDivElement>(null)

  // Exactly one item is tabbable: the last one used, or the first.
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const items = itemsIn(el)
    const current = items.find((item) => item.tabIndex === 0 && item.dataset.toolbarStop === '')
    const stop = current ?? items[0]
    for (const item of el.querySelectorAll<HTMLElement>('[data-toolbar-item]')) {
      item.tabIndex = item === stop ? 0 : -1
      if (item === stop) item.dataset.toolbarStop = ''
      else delete item.dataset.toolbarStop
    }
  })

  const makeStop = (target: HTMLElement) => {
    const el = bar.current
    if (!el) return
    for (const item of el.querySelectorAll<HTMLElement>('[data-toolbar-item]')) {
      item.tabIndex = item === target ? 0 : -1
      if (item === target) item.dataset.toolbarStop = ''
      else delete item.dataset.toolbarStop
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.hasAttribute('data-toolbar-item')) return // inside a popover
    const items = itemsIn(event.currentTarget)
    const at = items.indexOf(target)
    if (at < 0) return
    const next = {
      ArrowRight: items[(at + 1) % items.length],
      ArrowLeft: items[(at - 1 + items.length) % items.length],
      Home: items[0],
      End: items.at(-1),
    }[event.key]
    if (!next) return
    event.preventDefault()
    makeStop(next)
    next.focus()
  }

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={label}
      className={cx('flex items-center', className)}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        // A click or programmatic focus makes that item the Tab stop.
        if (event.target.hasAttribute('data-toolbar-item')) makeStop(event.target)
      }}
    >
      {children}
    </div>
  )
}
