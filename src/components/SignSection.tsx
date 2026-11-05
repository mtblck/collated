import { useId, useRef, useState } from 'react'
import type { SheetLayout } from '../core/geometry'
import type { Asset, Mark, Page } from '../core/model'
import type { NumberMark } from '../core/pageNumbers'
import type { Quad } from '../core/perspective'
import type { WatermarkMark } from '../core/watermark'
import { deviceSignatures } from '../state/signatureStore'
import { Button } from './controls'
import { SignIcon, TextIcon } from './Icons'
import { MarkEditor } from './MarkEditor'

/**
 * The Fill and sign part of a page's panel: opens the editor that puts
 * signatures (#111), text, dates, ticks and crosses (#112) on the page, and
 * takes them all off again. Shared by single, combined and blank pages,
 * since marks belong to the page.
 */
export const SignSection = ({
  pageLabel,
  page,
  sheet,
  thumbUrls,
  covers,
  watermark,
  numbers,
  assets,
  onMarks,
}: {
  /** "page 3", for the editor's title. */
  pageLabel: string
  page: Page
  sheet: SheetLayout
  thumbUrls: readonly string[]
  covers?: readonly (readonly Quad[])[]
  watermark: WatermarkMark | null
  numbers: NumberMark | null
  assets: Readonly<Record<string, Asset>>
  onMarks: (marks: Mark[], added: Asset[]) => void
}) => {
  const id = useId()
  const [editing, setEditing] = useState<'sign' | 'fill' | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const marks = page.marks ?? []
  const count = marks.length
  const signaturesOnly = marks.every((mark) => mark.kind === 'signature')
  const noun = signaturesOnly
    ? count === 1
      ? 'signature'
      : 'signatures'
    : count === 1
      ? 'item'
      : 'items'
  return (
    <div>
      <p className="label mb-2 text-ink-faint" id={`${id}-sign`}>
        Fill and sign
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-sign`}>
        <Button
          ref={button}
          className="flex-1"
          onClick={() => {
            setEditing('sign')
          }}
        >
          <SignIcon width={16} height={16} />
          {count ? `Edit ${String(count)} ${noun}…` : 'Sign this page…'}
        </Button>
        {count === 0 && (
          <Button
            className="flex-1"
            onClick={() => {
              setEditing('fill')
            }}
          >
            <TextIcon width={16} height={16} />
            Add text or ticks…
          </Button>
        )}
        {count > 0 && (
          <Button
            onClick={() => {
              button.current?.focus()
              onMarks([], [])
            }}
          >
            Remove all
          </Button>
        )}
      </div>
      {editing && (
        <MarkEditor
          title={`Fill and sign ${pageLabel}`}
          sheet={sheet}
          thumbUrls={thumbUrls}
          {...(covers ? { covers } : {})}
          watermark={watermark}
          numbers={numbers}
          initial={marks}
          start={editing}
          assets={assets}
          store={deviceSignatures()}
          onApply={onMarks}
          onClose={() => {
            setEditing(null)
            button.current?.focus()
          }}
        />
      )}
    </div>
  )
}
