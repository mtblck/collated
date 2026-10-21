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
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
