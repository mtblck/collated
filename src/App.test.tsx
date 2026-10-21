import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { asset } from '../tests/helpers'
import { App, type AppDeps } from './App'
import { ImportError } from './import/importFile'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

const setup = (overrides: Partial<AppDeps> = {}) => {
  let n = 0
  const store = new Map<string, string>()
  const deps: Partial<AppDeps> = {
    newId: () => `id${++n}`,
    locale: 'en-US',
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v)
      },
    },
    importFile: vi.fn((f: File, newId: () => string) => {
      if (f.name.endsWith('.txt')) return Promise.reject(new ImportError('Not an image.'))
      // A ".pdf" stands in for a three-page PDF sharing one set of bytes.
      const pages = f.name.endsWith('.pdf') ? 3 : 1
      const bytesId = newId()
      const assets = Array.from({ length: pages }, (_, i) =>
        asset(newId(), {
          bytesId,
          name: pages > 1 ? `${f.name} · p${i + 1}` : f.name,
          width: f.name.includes('tall') ? 100 : 300,
          height: 200,
          ...(pages > 1 ? { format: 'pdf' as const, pdfPage: i } : {}),
        }),
      )
      return Promise.resolve({ assets, files: [{ id: bytesId, bytes: new Uint8Array([1]) }] })
    }),
    exportPdf: vi.fn(() =>
      Promise.resolve({
        blob: new Blob(['%PDF'], { type: 'application/pdf' }),
        compression: null,
        fits: true,
      }),
    ),
    download: vi.fn(),
    // "blank" pages have no lines to go by; every other page is 2.5° out.
    estimateSkew: vi.fn((a: { name: string }) =>
      Promise.resolve(a.name.includes('blank') ? null : { angle: -2.5, confidence: 2 }),
    ),
    recognizeText: vi.fn(() =>
      Promise.resolve([{ text: 'Hello', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.15, baseline: 0.15 }]),
    ),
    ...overrides,
  }
  const user = userEvent.setup()
  render(<App deps={deps} />)
  const upload = async (...names: string[]) => {
    await user.upload(screen.getByTestId('file-input'), names.map(file))
  }
  return { user, deps, store, upload }
}

/** The app's own live region (dnd-kit adds another for drag announcements). */
const status = () => screen.getAllByRole('status').find((el) => el.id === 'status')

const pageLabels = () =>
  within(screen.getByRole('list', { name: /pages?$/ }))
    .getAllByRole('button', { name: /^Page \d+:/ })
    .map((b) => b.getAttribute('aria-label'))

describe('App', () => {
  it('starts empty and offers to choose images', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Many pages in.')
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeEnabled()
  })

  it('imports files as pages, reports failures by name, and selects the first page', async () => {
    const { upload } = setup()
    await upload('a.jpg', 'notes.txt', 'b.jpg')
    expect(await screen.findByRole('list', { name: '2 pages' })).toBeInTheDocument()
    expect(pageLabels()).toEqual(['Page 1: a.jpg', 'Page 2: b.jpg'])
    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt: Not an image.')
    expect(status()).toHaveTextContent('Added 2 pages. 1 file could not be added.')
    expect(screen.getByRole('heading', { level: 2, name: 'a.jpg' })).toBeInTheDocument()
  })

  it('turns a PDF into one page per PDF page, shown as vector in the inspector', async () => {
    const { user, upload } = setup()
    await upload('lease.pdf', 'a.jpg')
    expect(await screen.findByRole('list', { name: '4 pages' })).toBeInTheDocument()
    expect(pageLabels()).toEqual([
      'Page 1: lease.pdf · p1',
      'Page 2: lease.pdf · p2',
      'Page 3: lease.pdf · p3',
      'Page 4: a.jpg',
    ])
    await user.click(screen.getByRole('button', { name: 'Page 2: lease.pdf · p2' }))
    const panel = within(screen.getByRole('complementary', { name: 'Selected page' }))
    expect(panel.getByText('Vector, any size')).toBeInTheDocument()
    expect(panel.getByText(/PDF page 2/)).toBeInTheDocument()
  })

  it('removes a page and brings it back with undo', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg')
    await user.click(await screen.findByRole('button', { name: 'Remove page 1' }))
    expect(pageLabels()).toEqual(['Page 1: b.jpg'])
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(pageLabels()).toEqual(['Page 1: a.jpg', 'Page 2: b.jpg'])
    await user.click(screen.getByRole('button', { name: /^Redo/ }))
    expect(pageLabels()).toEqual(['Page 1: b.jpg'])
  })

  it('undoes with the keyboard shortcut, but not while typing in a field', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg')
    await user.click(await screen.findByRole('button', { name: 'Remove page 2' }))
    await user.click(screen.getByLabelText('Title & filename'))
    await user.keyboard('{Control>}z{/Control}')
    expect(pageLabels()).toHaveLength(1)
    await user.click(screen.getByRole('heading', { level: 2 }))
    await user.keyboard('{Control>}z{/Control}')
    expect(pageLabels()).toHaveLength(2)
  })

  it('moves the selected page with the inspector’s buttons', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg', 'c.jpg')
    await user.click(await screen.findByRole('button', { name: 'Page 1: a.jpg' }))
    expect(screen.getByRole('button', { name: 'Move page earlier' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move page later' }))
    expect(pageLabels()).toEqual(['Page 1: b.jpg', 'Page 2: a.jpg', 'Page 3: c.jpg'])
    expect(status()).toHaveTextContent('Moved to position 2 of 3.')
  })

  it('rotates, straightens and scales the selected page', async () => {
    const { user, upload } = setup()
    await upload('a.jpg')
    const panel = await screen.findByRole('complementary', { name: 'Selected page' })
    const page = within(panel)
    await user.click(page.getByRole('button', { name: 'Right' }))
    // jsdom has no range keyboard behaviour; the verify script covers that in Chromium.
    fireEvent.change(page.getByLabelText('Straighten'), { target: { value: '1' } })
    expect(page.getByText('+1.0°')).toBeInTheDocument()
    await user.click(page.getByRole('radio', { name: 'Fill' }))
    expect(page.getByRole('radio', { name: 'Fill' })).toBeChecked()
    expect(page.getByRole('button', { name: 'Reset' })).toBeEnabled()
    await user.click(page.getByRole('button', { name: 'Reset' }))
    expect(page.getByText('0.0°')).toBeInTheDocument()
    // Unavailable but still focused, rather than disabled out from under focus.
    expect(page.getByRole('button', { name: 'Reset' })).toHaveAttribute('aria-disabled', 'true')
    expect(page.getByRole('button', { name: 'Reset' })).toHaveFocus()
  })

  it('sets a filter per page, explains the re-encode, and disables it for PDF pages', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'scan.pdf')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('radio', { name: 'B&W' }))
    expect(panel.getByRole('radio', { name: 'B&W' })).toBeChecked()
    expect(panel.getByText(/re-encoded for the filter/)).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Reset' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Page 2: scan.pdf · p1' }))
    expect(panel.getByRole('radio', { name: 'B&W' })).toBeDisabled()
    expect(panel.getByRole('radio', { name: 'Original' })).toBeChecked()
    expect(panel.getByText('PDF pages keep their original vector content.')).toBeInTheDocument()
  })

  it('auto-straightens a page, or all of them in one undo step', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg', 'blank.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Auto-straighten' }))
    expect(await panel.findByText('-2.5°')).toBeInTheDocument()
    expect(status()).toHaveTextContent('Straightened by -2.5°.')

    await user.click(panel.getByRole('button', { name: 'All pages' }))
    await waitFor(() => {
      expect(status()).toHaveTextContent(
        'Straightened 2 of 3 pages. 1 page had no clear lines and was left as it is.',
      )
    })
    // One undo returns every page to where the batch started.
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(panel.getByText('-2.5°')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(panel.getByText('0.0°')).toBeInTheDocument()
  })

  it('says so when a page has no lines to straighten by', async () => {
    const { user, upload } = setup()
    await upload('blank.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Auto-straighten' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No clear lines found')
    expect(panel.getByText('0.0°')).toBeInTheDocument()
  })

  it('crops to the paper with keyboard-movable corners, and removes the crop', async () => {
    const { user, upload } = setup()
    await upload('photo.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Crop to the page…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Crop to the page' }))
    const corner = dialog.getByRole('button', { name: 'Top-left corner' })
    expect(corner).toHaveAccessibleDescription('0% across, 0% down')
    corner.focus()
    await user.keyboard('{Shift>}{ArrowRight}{ArrowDown}{/Shift}{ArrowRight}')
    // The name stays put; the position is in the description, and announced
    // once the keys settle.
    expect(corner).toHaveAccessibleName('Top-left corner')
    expect(corner).toHaveAccessibleDescription('5.5% across, 5% down')
    expect(
      await dialog.findByText('Top-left corner, 5.5% across, 5% down.', {}, { timeout: 2000 }),
    ).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Apply crop' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(panel.getByRole('button', { name: 'Adjust corners…' })).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Reset' })).toBeEnabled()
    await user.click(panel.getByRole('button', { name: 'Remove crop' }))
    expect(panel.getByRole('button', { name: 'Crop to the page…' })).toBeInTheDocument()
  })

  it('refuses crossed corners', async () => {
    const { user, upload } = setup()
    await upload('photo.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Crop to the page…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Crop to the page' }))
    // Drag the top-left corner past the top-right one.
    dialog.getByRole('button', { name: 'Top-left corner' }).focus()
    for (let i = 0; i < 21; i++) await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(dialog.getByRole('alert')).toHaveTextContent('cross over')
    expect(dialog.getByRole('button', { name: 'Apply crop' })).toBeDisabled()
  })

  it('duplicates a page and selects the copy', async () => {
    const { user, upload } = setup()
    await upload('a.jpg')
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }))
    expect(pageLabels()).toEqual(['Page 1: a.jpg', 'Page 2: a.jpg'])
    expect(screen.getByRole('button', { name: 'Page 2: a.jpg' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Page 1: a.jpg' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('reports the printed resolution and the page size in the chosen unit', async () => {
    const { user, upload } = setup()
    await upload('tall.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    expect(panel.getByText('8.5 in × 11 in')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'mm' }))
    expect(panel.getByText('215.9 mm × 279.4 mm')).toBeInTheDocument()
  })

  it('exports with the current document and names the file from the title', async () => {
    const exportPdf = vi.fn<AppDeps['exportPdf']>(() =>
      Promise.resolve({
        blob: new Blob(['%PDF'], { type: 'application/pdf' }),
        compression: null,
        fits: true,
      }),
    )
    const { user, deps, upload } = setup({ exportPdf })
    await upload('a.jpg')
    await user.type(await screen.findByLabelText('Title & filename'), 'Lease 2026')
    await user.click(screen.getByRole('button', { name: /Export PDF · 1 page/ }))
    await waitFor(() => {
      expect(deps.download).toHaveBeenCalledWith(expect.any(Blob), 'Lease-2026.pdf')
    })
    const [doc] = exportPdf.mock.calls[0] ?? []
    expect(doc?.pages).toHaveLength(1)
    expect(doc?.settings.title).toBe('Lease 2026')
    expect(status()).toHaveTextContent('Saved Lease-2026.pdf (4 B, original images).')
  })

  it('lowers the estimate when a smaller quality is chosen, and remembers it', async () => {
    const { user, store, upload } = setup({
      importFile: (f, newId) => {
        const id = newId()
        return Promise.resolve({
          assets: [asset(id, { name: f.name, width: 4000, height: 3000, byteLength: 4_000_000 })],
          files: [{ id, bytes: new Uint8Array([1]) }],
        })
      },
    })
    await upload('photo.jpg')
    const options = await screen.findByRole('button', { name: /Export options:\s*Original/ })
    expect(options).toHaveAccessibleName(/≈\s*3\.8 MB/)
    // jsdom hides popover content but doesn't implement popovertarget, so the
    // panel can't be opened here; its controls are queried directly. The
    // browser verify opens the real popover.
    await user.click(screen.getByRole('radio', { name: /Small/, hidden: true }))
    // 4000 px across 11 in is ~364 dpi; capping at 150 dpi leaves ~17% of
    // the pixels, so the estimate drops from megabytes to kilobytes.
    expect(screen.getByRole('button', { name: /Export options:\s*Small/ })).toHaveAccessibleName(
      /≈\s*\d+ KB/,
    )
    expect(JSON.parse(store.get('collated:settings') ?? '{}')).toMatchObject({ quality: 'small' })
  })

  it('warns when a size limit could not be met, and still saves', async () => {
    const { user, deps, upload } = setup({
      exportPdf: () =>
        Promise.resolve({
          blob: new Blob([new Uint8Array(3 * 1024 * 1024)]),
          compression: { dpi: 96, quality: 0.6 },
          fits: false,
        }),
    })
    await upload('a.jpg')
    const limit = await screen.findByLabelText(/^Keep the file under/)
    expect(limit).toHaveAccessibleName('Keep the file under (megabytes)')
    await user.type(limit, '1{Enter}')
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t get under 1.0 MB: the smallest version is 3.0 MB at 96 dpi. It was saved anyway.',
    )
    expect(deps.download).toHaveBeenCalled()
  })

  it('passes the password to the export but never stores it', async () => {
    const exportPdf = vi.fn<AppDeps['exportPdf']>(() =>
      Promise.resolve({ blob: new Blob(['%PDF']), compression: null, fits: true }),
    )
    const { user, store, upload } = setup({ exportPdf })
    await upload('a.jpg')
    await user.type(await screen.findByLabelText('Password to open'), 'hunter2')
    // The main button says the PDF will be locked.
    await user.click(screen.getByRole('button', { name: 'Export locked PDF · 1 page' }))
    await waitFor(() => {
      expect(exportPdf).toHaveBeenCalled()
    })
    expect(exportPdf.mock.calls[0]?.[2]).toEqual({ password: 'hunter2' })
    expect(status()).toHaveTextContent('password-protected')
    expect(JSON.stringify([...store.values()])).not.toContain('hunter2')
  })

  it('shows page numbers on the pages when switched on', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg')
    const pages = await screen.findByRole('list', { name: '2 pages' })
    expect(within(pages).queryByText('8')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Page numbers', hidden: true }))
    await user.clear(screen.getByLabelText('Start at'))
    await user.type(screen.getByLabelText('Start at'), '7{Enter}')
    expect(within(pages).getByText('7')).toBeInTheDocument()
    expect(within(pages).getByText('8')).toBeInTheDocument()
  })

  it('sizes pages to their image when "Match image" is chosen', async () => {
    const { user, upload } = setup()
    await upload('a.jpg')
    await user.selectOptions(await screen.findByLabelText('Page size'), 'image')
    // 300 x 200 px at the default 300 dpi is 1 x 0.67 in.
    const panel = within(screen.getByRole('complementary', { name: 'Selected page' }))
    expect(panel.getByText('1 in × 0.67 in')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Portrait' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Image dpi'))
    await user.type(screen.getByLabelText('Image dpi'), '100{Enter}')
    expect(panel.getByText('3 in × 2 in')).toBeInTheDocument()
  })

  it('reads text on image pages (not PDF pages) before exporting when OCR is on', async () => {
    const exportPdf = vi.fn<AppDeps['exportPdf']>(() =>
      Promise.resolve({ blob: new Blob(['%PDF']), compression: null, fits: true }),
    )
    const { user, deps, upload } = setup({ exportPdf })
    await upload('scan.jpg', 'form.pdf')
    await user.click(
      await screen.findByRole('checkbox', { name: 'Make text searchable (OCR)', hidden: true }),
    )
    await user.click(screen.getByRole('button', { name: /Export PDF · 4 pages/ }))
    await waitFor(() => {
      expect(exportPdf).toHaveBeenCalled()
    })
    expect(deps.recognizeText).toHaveBeenCalledTimes(1)
    const text = exportPdf.mock.calls[0]?.[2]?.text ?? {}
    expect(Object.values(text)).toEqual([[expect.objectContaining({ text: 'Hello' })]])
    expect(status()).toHaveTextContent('searchable')
  })

  it('shows an error if the export fails and stays usable', async () => {
    const { user, upload } = setup({ exportPdf: () => Promise.reject(new Error('disk full')) })
    await upload('a.jpg')
    await user.click(await screen.findByRole('button', { name: /Export PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeEnabled()
  })

  it('remembers page setup (not the title) between visits', async () => {
    const { user, store, upload } = setup()
    await upload('a.jpg')
    await user.selectOptions(await screen.findByLabelText('Page size'), 'a4')
    await user.type(screen.getByLabelText('Title & filename'), 'secret')
    const saved = JSON.parse(store.get('collated:settings') ?? '{}') as Record<string, unknown>
    expect(saved.size).toBe('a4')
    expect(saved).not.toHaveProperty('title')
  })

  it('adds pasted images', async () => {
    setup()
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { files: File[] }
    }
    Object.defineProperty(event, 'clipboardData', { value: { files: [file('pasted.png')] } })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(await screen.findByRole('list', { name: '1 page' })).toBeInTheDocument()
    expect(event.defaultPrevented).toBe(true)
  })

  describe('focus and announcements', () => {
    it('moves focus to the next page (else the previous) after removing one', async () => {
      const { user, upload } = setup()
      await upload('a.jpg', 'b.jpg', 'c.jpg')
      await user.click(await screen.findByRole('button', { name: 'Remove page 2' }))
      expect(screen.getByRole('button', { name: 'Page 2: c.jpg' })).toHaveFocus()
      await user.click(screen.getByRole('button', { name: 'Remove page 2' }))
      expect(screen.getByRole('button', { name: 'Page 1: a.jpg' })).toHaveFocus()
      // The last page: focus goes to the import button that replaces the grid.
      await user.click(screen.getByRole('button', { name: 'Remove page 1' }))
      expect(screen.getByRole('button', { name: 'Choose files' })).toHaveFocus()
    })

    it('selects and focuses the next page when the inspector removes the selected one', async () => {
      const { user, upload } = setup()
      await upload('a.jpg', 'b.jpg')
      const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
      await user.click(panel.getByRole('button', { name: 'Remove' }))
      const next = screen.getByRole('button', { name: 'Page 1: b.jpg' })
      expect(next).toHaveFocus()
      expect(next).toHaveAttribute('aria-current', 'true')
      expect(panel.getByRole('heading', { level: 2, name: 'b.jpg' })).toBeInTheDocument()
    })

    it('moves focus to the other reorder button at either end', async () => {
      const { user, upload } = setup()
      await upload('a.jpg', 'b.jpg')
      await user.click(await screen.findByRole('button', { name: 'Page 2: b.jpg' }))
      await user.click(screen.getByRole('button', { name: 'Move page earlier' }))
      expect(screen.getByRole('button', { name: 'Move page earlier' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move page later' })).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('button', { name: 'Move page earlier' })).toHaveFocus()
    })

    it('announces undo and redo, naming what changed, every time', async () => {
      const { user, upload } = setup()
      await upload('a.jpg', 'b.jpg')
      await user.click(await screen.findByRole('button', { name: 'Remove page 1' }))
      await user.click(screen.getByRole('button', { name: /^Undo/ }))
      expect(status()).toHaveTextContent('Undone: removed page 1.')
      await user.click(screen.getByRole('button', { name: /^Redo/ }))
      expect(status()).toHaveTextContent('Redone: removed page 1.')
      await user.click(screen.getByRole('button', { name: /^Undo/ }))
      await user.click(screen.getByRole('button', { name: 'Rotate page 1 left' }))
      await user.click(screen.getByRole('button', { name: 'Rotate page 1 left' }))
      await user.click(screen.getByRole('button', { name: /^Undo/ }))
      expect(status()?.textContent).toBe('Undone: edited page 1.')
      await user.click(screen.getByRole('button', { name: /^Undo/ }))
      // Same words again: the text still changes, so it's spoken again.
      expect(status()?.textContent).toBe('Undone: edited page 1.\u00a0')
    })

    it('puts focus on the import button when undo empties the document', async () => {
      const { user, upload } = setup()
      await upload('a.jpg')
      await user.click(await screen.findByRole('button', { name: 'Rotate page 1 left' }))
      const undoButton = screen.getByRole('button', { name: /^Undo/ })
      await user.click(undoButton)
      await user.click(undoButton) // undoes the import too
      // The grid is gone; focus lands on the import button rather than the page.
      expect(screen.getByRole('button', { name: 'Choose files' })).toHaveFocus()
    })

    it('focuses the page in its place when undo removes the focused page', async () => {
      const { user, upload } = setup()
      await upload('a.jpg', 'b.jpg')
      await user.click(await screen.findByRole('button', { name: 'Page 2: b.jpg' }))
      await user.click(screen.getByRole('button', { name: 'Duplicate' }))
      screen.getByRole('button', { name: 'Page 3: b.jpg' }).focus()
      await user.keyboard('{Control>}z{/Control}')
      expect(pageLabels()).toHaveLength(2)
      expect(screen.getByRole('button', { name: 'Page 2: b.jpg' })).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Page 2: b.jpg' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })

    it('ignores undo shortcuts while the crop dialog is open', async () => {
      const { user, upload } = setup()
      await upload('photo.jpg')
      const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
      await user.click(panel.getByRole('button', { name: 'Crop to the page…' }))
      const dialog = await screen.findByRole('dialog', { name: 'Crop to the page' })
      within(dialog).getByRole('button', { name: 'Top-left corner' }).focus()
      await user.keyboard('{Control>}z{/Control}')
      expect(pageLabels()).toEqual(['Page 1: photo.jpg'])
      expect(dialog).toBeInTheDocument()
    })

    it('keeps the export button focusable and inactive while busy', async () => {
      let finish: (value: Awaited<ReturnType<AppDeps['exportPdf']>>) => void = () => undefined
      const exportPdf = vi.fn<AppDeps['exportPdf']>(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const { user, upload } = setup({ exportPdf })
      await upload('a.jpg')
      const button = await screen.findByRole('button', { name: /Export PDF · 1 page/ })
      await user.click(button)
      expect(button).toHaveFocus()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toBeEnabled()
      await user.click(button) // ignored while busy
      expect(exportPdf).toHaveBeenCalledTimes(1)
      await act(async () => {
        finish({ blob: new Blob(['%PDF']), compression: null, fits: true })
        await Promise.resolve()
      })
      await waitFor(() => {
        expect(button).not.toHaveAttribute('aria-disabled')
      })
      expect(button).toHaveFocus()
    })

    it('keeps auto-straighten focusable and inactive while it runs', async () => {
      let finish: (value: { angle: number; confidence: number } | null) => void = () => undefined
      const { user, upload } = setup({
        estimateSkew: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      })
      await upload('a.jpg', 'b.jpg')
      const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
      const auto = panel.getByRole('button', { name: 'Auto-straighten' })
      await user.click(auto)
      expect(auto).toHaveFocus()
      expect(auto).toHaveAttribute('aria-disabled', 'true')
      expect(panel.getByRole('button', { name: 'All pages' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      await act(async () => {
        finish({ angle: 1, confidence: 2 })
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      expect(auto).not.toHaveAttribute('aria-disabled')
      expect(auto).toHaveFocus()
    })

    it('says "no clear lines" once, as a notice, not again in the status', async () => {
      const { user, upload } = setup()
      await upload('blank.jpg')
      const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
      await user.click(panel.getByRole('button', { name: 'Auto-straighten' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('No clear lines found')
      expect(status()?.textContent).toBe('')
    })
  })

  describe('notices', () => {
    it('shows the latest with a count of the rest, and Escape dismisses it', async () => {
      const { user, upload } = setup()
      await upload('one.txt', 'two.txt', 'three.txt')
      expect(await screen.findByRole('alert')).toHaveTextContent('three.txt')
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.getByText('and 2 earlier messages')).toBeInTheDocument()
      screen.getByRole('button', { name: 'Choose files' }).focus()
      await user.keyboard('{Escape}')
      expect(screen.getByRole('alert')).toHaveTextContent('two.txt')
      expect(screen.getByText('and 1 earlier message')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Dismiss all' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      // Focus goes somewhere sensible, not to the page.
      expect(screen.getByRole('button', { name: 'Choose files' })).toHaveFocus()
    })

    it('leaves notices alone when Escape is pressed in a field', async () => {
      const { user, upload } = setup()
      await upload('a.jpg', 'notes.txt')
      await user.click(await screen.findByLabelText('Title & filename'))
      await user.keyboard('{Escape}')
      expect(screen.getByRole('alert')).toHaveTextContent('notes.txt')
    })
  })

  describe('fields', () => {
    it('keeps the default dpi valid and steps it with the arrow keys', async () => {
      const { user, upload } = setup()
      await upload('a.jpg')
      await user.selectOptions(await screen.findByLabelText('Page size'), 'image')
      const dpi = screen.getByLabelText('Image dpi')
      expect(dpi).toHaveValue(300)
      expect(dpi).toBeValid()
      expect(dpi).toHaveAttribute('step', 'any')
      await user.click(dpi)
      await user.keyboard('{ArrowUp}')
      expect(dpi).toHaveValue(310)
      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(dpi).toHaveValue(290)
    })

    it('steps an off-grid value onto the grid, like the browser', async () => {
      const { user, upload } = setup()
      await upload('tall.jpg')
      await user.click(await screen.findByRole('radio', { name: 'mm' }))
      const margin = screen.getByLabelText(/^Margin/)
      expect(margin).toHaveAccessibleName('Margin in millimetres')
      await user.clear(margin)
      await user.type(margin, '12.7{Enter}')
      expect(margin).toBeValid()
      await user.keyboard('{ArrowUp}')
      expect(margin).toHaveValue(13)
      await user.click(screen.getByRole('radio', { name: 'in' }))
      expect(screen.getByLabelText(/^Margin/)).toHaveAccessibleName('Margin in inches')
    })
  })

  describe('password', () => {
    it('has a show toggle that keeps focus and switches the field type', async () => {
      const { user, upload } = setup()
      await upload('a.jpg')
      const field = await screen.findByLabelText('Password to open')
      expect(field).toHaveAttribute('type', 'password')
      expect(field).toHaveAttribute('autocomplete', 'off')
      expect(field).toHaveAttribute('data-1p-ignore')
      expect(field).toHaveAttribute('data-lpignore', 'true')
      const show = screen.getByRole('button', { name: 'Show password', hidden: true })
      expect(show).toHaveAttribute('aria-pressed', 'false')
      await user.click(show)
      expect(show).toHaveAttribute('aria-pressed', 'true')
      expect(show).toHaveFocus()
      expect(field).toHaveAttribute('type', 'text')
    })

    it('normalises the password before export', async () => {
      const exportPdf = vi.fn<AppDeps['exportPdf']>(() =>
        Promise.resolve({ blob: new Blob(['%PDF']), compression: null, fits: true }),
      )
      const { user, upload } = setup({ exportPdf })
      await upload('a.jpg')
      // "e" + combining acute, and a full-width A: NFKC makes them "é" and "A".
      fireEvent.change(await screen.findByLabelText('Password to open'), {
        target: { value: 'caféＡ' },
      })
      await user.click(screen.getByRole('button', { name: /Export locked PDF/ }))
      await waitFor(() => {
        expect(exportPdf).toHaveBeenCalled()
      })
      expect(exportPdf.mock.calls[0]?.[2]).toEqual({ password: 'caféA' })
    })

    it('refuses a password longer than a PDF can hold, saying why', async () => {
      const exportPdf = vi.fn<AppDeps['exportPdf']>()
      const { user, upload } = setup({ exportPdf })
      await upload('a.jpg')
      const field = await screen.findByLabelText('Password to open')
      // 64 two-byte letters: 128 bytes, one over.
      fireEvent.change(field, { target: { value: 'é'.repeat(64) } })
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field).toHaveAccessibleDescription(/Too long: a PDF password can use at most 127/)
      await user.click(screen.getByRole('button', { name: /Export locked PDF/ }))
      expect(exportPdf).not.toHaveBeenCalled()
      expect(field).toHaveFocus()
      fireEvent.change(field, { target: { value: 'é'.repeat(63) } })
      expect(field).not.toHaveAttribute('aria-invalid')
    })

    it('tells the truth about what the password and OCR do', async () => {
      const { upload } = setup()
      await upload('a.jpg')
      expect(await screen.findByLabelText('Password to open')).toHaveAccessibleDescription(
        /name \(from the title\) and its number of pages aren’t hidden/,
      )
      expect(
        screen.getByRole('checkbox', { name: 'Make text searchable (OCR)', hidden: true }),
      ).toHaveAccessibleDescription(/added to the PDF invisibly, so anyone with the file/)
    })
  })

  it('places a picked crop corner where the image is tapped', async () => {
    const { user, upload } = setup()
    await upload('photo.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Crop to the page…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Crop to the page' }))
    const corner = dialog.getByRole('button', { name: 'Bottom-right corner' })
    // Pick it (Enter clicks, as a tap does).
    corner.focus()
    await user.keyboard('{Enter}')
    expect(corner).toHaveAttribute('aria-pressed', 'true')
    expect(dialog.getByText(/Bottom-right corner picked/)).toBeInTheDocument()
    const image = dialog.getByRole('img', { name: /The whole of/ })
    const stage = image.parentElement
    if (!stage) throw new Error('stage')
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 50, width: 300, height: 200 }),
    )
    fireEvent.pointerDown(image, { clientX: 340, clientY: 210 })
    fireEvent.pointerUp(image, { clientX: 341, clientY: 210 })
    expect(corner).toHaveAccessibleDescription('80.3% across, 80% down')
    expect(corner).toHaveAttribute('aria-pressed', 'false')
    expect(
      dialog.getByText('Bottom-right corner moved to 80.3% across, 80% down.'),
    ).toBeInTheDocument()
  })
})
