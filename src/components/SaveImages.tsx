import { useEffect, useId, useRef } from 'react'
import { Button } from './controls'

/**
 * Offers a phone's share sheet for images just exported (#117), where
 * "Save to Photos" or a chat app is usually where they're going. The share
 * sheet only opens from a tap, and the export took longer than a tap lasts,
 * so this asks for one. Download stays for a file instead.
 */
export const SaveImages = ({
  what,
  downloadLabel,
  shareFailed,
  onShare,
  onDownload,
  onDismiss,
}: {
  /** "3 JPGs", "1 PNG". */
  what: string
  /** "Download ZIP", "Download". */
  downloadLabel: string
  /** Sharing didn't work: say so and offer only Download. */
  shareFailed: boolean
  onShare: () => void
  onDownload: () => void
  onDismiss: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const picked = useRef(false)
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])
  const pick = (then: () => void) => {
    picked.current = true
    // From inside the tap: sharing and downloading need one.
    then()
    dialog.current?.close()
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
      onClose={() => {
        // Escape or Not now.
        if (!picked.current) onDismiss()
      }}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {what} ready
        </h2>
        <p id={`${id}-help`} className="text-sm text-ink-muted">
          {shareFailed
            ? 'Sharing didn’t work on this device. Download them as a file instead.'
            : 'Share them to save to your photos or send them on, or download them as a file.'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="quiet"
            onClick={() => {
              dialog.current?.close()
            }}
          >
            Not now
          </Button>
          <Button
            {...(shareFailed && { variant: 'primary' as const })}
            onClick={() => {
              pick(onDownload)
            }}
          >
            {downloadLabel}
          </Button>
          {!shareFailed && (
            <Button
              variant="primary"
              onClick={() => {
                pick(onShare)
              }}
            >
              Share…
            </Button>
          )}
        </div>
      </div>
    </dialog>
  )
}
