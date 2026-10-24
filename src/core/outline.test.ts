import { execFileSync } from 'node:child_process'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { DEFAULT_TRANSFORM, type Page } from './model'
import { buildOutline, fileTitle, sectionBefore, type OutlineItem } from './outline'
import { buildPdf } from './pdf'
import { docReducer } from './reducer'
import { buildSplit } from './splitBuild'
import { unzipSync } from 'fflate'

const assets = {
  a: asset('a', { name: 'IMG_0001.JPG' }),
  b: asset('b', { name: 'receipt.png', format: 'png' }),
  r1: asset('r1', { name: 'report · p1', format: 'pdf', bytesId: 'report', pdfPage: 0 }),
  r2: asset('r2', { name: 'report · p2', format: 'pdf', bytesId: 'report', pdfPage: 1 }),
}

/** Titles as an indented list, for comparing outlines at a glance. */
const shape = (items: OutlineItem[], depth = 0): string[] =>
  items.flatMap((item) => [
    `${'  '.repeat(depth)}${item.title} @${item.pageId}`,
    ...shape(item.children, depth + 1),
  ])

describe('file titles', () => {
  it('drops the extension, and the page suffix of a PDF page', () => {
    expect(fileTitle({ name: 'IMG_0001.JPG', format: 'jpeg' })).toBe('IMG_0001')
    expect(fileTitle({ name: 'report · p12', format: 'pdf' })).toBe('report')
    expect(fileTitle({ name: 'scan.pdf', format: 'pdf' })).toBe('scan')
    expect(fileTitle({ name: 'Pasted image', format: 'png' })).toBe('Pasted image')
    expect(fileTitle({ name: '.png', format: 'png' })).toBe('.png')
  })
})

describe('the outline', () => {
  const pages: Page[] = [
    page('p1', 'r1', { section: '  Report  ' }),
    page('p2', 'r2'),
    page('p3', 'a', { section: 'Receipts' }),
    page('p4', 'b'),
    page('p5', 'r1'),
  ]

  it('marks sections only, unless files are asked for', () => {
    expect(shape(buildOutline(pages, assets, { files: false }))).toEqual([
      'Report @p1',
      'Receipts @p3',
    ])
  })

  it('puts each file under its section, once per section', () => {
    expect(shape(buildOutline(pages, assets, { files: true }))).toEqual([
      'Report @p1',
      '  report @p1',
      'Receipts @p3',
      '  IMG_0001 @p3',
      '  receipt @p4',
      '  report @p5',
    ])
  })

  it('lists files at the top level before any section', () => {
    const plain = [page('p1', 'a'), page('p2', 'b'), page('p3', 'a', { section: 'Later' })]
    expect(shape(buildOutline(plain, assets, { files: true }))).toEqual([
      'IMG_0001 @p1',
      'receipt @p2',
      'Later @p3',
      '  IMG_0001 @p3',
    ])
  })

  it('bookmarks every picture of a combined page', () => {
    const sheet: Page = {
      ...page('s', 'a'),
      sheet: {
        kind: 'two',
        slots: [
          { assetId: 'a', ...DEFAULT_TRANSFORM },
          { assetId: 'b', ...DEFAULT_TRANSFORM },
        ],
      },
    }
    expect(shape(buildOutline([sheet], assets, { files: true }))).toEqual([
      'IMG_0001 @s',
      'receipt @s',
    ])
  })

  it('ignores blank section names', () => {
    expect(buildOutline([page('p1', 'a', { section: '   ' })], assets, { files: false })).toEqual(
      [],
    )
  })

  it('opens a file that starts mid-section under that section', () => {
    expect(sectionBefore(pages, 'p2')).toBe('Report')
    expect(sectionBefore(pages, 'p3')).toBe('Report')
    expect(sectionBefore(pages, 'p4')).toBe('Receipts')
    expect(sectionBefore(pages, 'p1')).toBeNull()
    const part = pages.slice(3)
    expect(
      shape(buildOutline(part, assets, { files: false, carried: sectionBefore(pages, 'p4') })),
    ).toEqual(['Receipts @p4'])
    // Its own section wins over the one carried in.
    expect(
      shape(
        buildOutline(pages.slice(2), assets, { files: false, carried: sectionBefore(pages, 'p3') }),
      ),
    ).toEqual(['Receipts @p3'])
  })
})

describe('sections in the document', () => {
  const state = {
    settings: settings(),
    assets,
    pages: [page('p1', 'a', { section: 'Intro' }), page('p2', 'b'), page('p3', 'r1')],
  }

  it('follow their page when it moves', () => {
    const moved = docReducer(state, { type: 'movePage', from: 0, to: 2 })
    expect(moved.pages.map((p) => [p.id, p.section])).toEqual([
      ['p2', undefined],
      ['p3', undefined],
      ['p1', 'Intro'],
    ])
    expect(shape(buildOutline(moved.pages, assets, { files: false }))).toEqual(['Intro @p1'])
  })

  it('are set and cleared on one page', () => {
    const named = docReducer(state, { type: 'setSection', id: 'p2', title: 'Body' })
    expect(named.pages[1]?.section).toBe('Body')
    const cleared = docReducer(named, { type: 'setSection', id: 'p2', title: '  ' })
    expect(cleared.pages[1] && 'section' in cleared.pages[1]).toBe(false)
    const long = docReducer(state, { type: 'setSection', id: 'p2', title: 'x'.repeat(500) })
    expect(long.pages[1]?.section).toHaveLength(120)
  })

  it('aren’t started again by a copy', () => {
    const one = docReducer(state, { type: 'duplicatePage', id: 'p1', newId: 'c1' })
    expect(one.pages[1]).toMatchObject({ id: 'c1' })
    expect(one.pages[1]?.section).toBeUndefined()
    const many = docReducer(state, { type: 'duplicatePages', ids: ['p1'], newIds: ['c2'] })
    expect(many.pages[1]?.section).toBeUndefined()
    expect(many.pages[0]?.section).toBe('Intro')
  })

  it('survive combining and splitting pages', () => {
    const named = docReducer(state, { type: 'setSection', id: 'p2', title: 'Body' })
    const combined = docReducer(named, {
      type: 'combinePages',
      ids: ['p2', 'p3'],
      kind: 'two',
      newIds: ['s'],
    })
    expect(combined.pages.map((p) => [p.id, p.section])).toEqual([
      ['p1', 'Intro'],
      ['s', 'Body'],
    ])
    const split = docReducer(combined, { type: 'splitPage', id: 's', newIds: ['x', 'y'] })
    expect(split.pages.map((p) => [p.id, p.section])).toEqual([
      ['p1', 'Intro'],
      ['x', 'Body'],
      ['y', undefined],
    ])
  })
})

/** An outline as read back with pdf-lib: titles by depth, and the page each opens (1-based). */
const readOutline = async (bytes: Uint8Array, password?: string): Promise<string[]> => {
  const doc = await PDFDocument.load(bytes, password ? { password } : {})
  const pageRefs = doc.getPages().map((p) => p.ref.toString())
  const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict)
  const out: string[] = []
  const walk = (ref: unknown, depth: number) => {
    let at = ref instanceof PDFRef ? ref : undefined
    while (at) {
      const item = doc.context.lookup(at, PDFDict)
      const title = item.lookup(PDFName.of('Title'))
      const text =
        title instanceof PDFHexString || title instanceof PDFString ? title.decodeText() : '?'
      const dest = item.lookup(PDFName.of('Dest'))
      const target =
        dest && 'get' in dest ? String((dest as { get: (i: number) => unknown }).get(0)) : ''
      out.push(`${'  '.repeat(depth)}${text} @${String(pageRefs.indexOf(target) + 1)}`)
      walk(item.get(PDFName.of('First')), depth + 1)
      const next = item.get(PDFName.of('Next'))
      at = next instanceof PDFRef ? next : undefined
    }
  }
  walk(root.get(PDFName.of('First')), 0)
  return out
}

const hasPdftohtml = (() => {
  try {
    execFileSync('pdftohtml', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** Poppler's reading of the outline: its titles, in order. */
const popplerTitles = (bytes: Uint8Array, password?: string) => {
  const xml = execFileSync(
    'pdftohtml',
    [...(password ? ['-upw', password] : []), '-xml', '-i', '-stdout', '-q', '-', 'out'],
    { input: Buffer.from(bytes) },
  ).toString()
  const outline = /<outline>[\s\S]*<\/outline>/.exec(xml)?.[0] ?? ''
  return [...outline.matchAll(/<item page="(\d+)">([^<]*)<\/item>/g)].map(
    ([, n, title]) => `${title ?? ''} @${n ?? ''}`,
  )
}

describe('bookmarks in the PDF (#75)', () => {
  const jpeg = fixture('quad-landscape.jpg')
  const pdfAssets = {
    a: asset('a', { name: 'Front.jpg', width: 400, height: 300 }),
    b: asset('b', { name: 'Back.jpg', width: 400, height: 300 }),
    c: asset('c', { name: 'Ünïcode — notes.jpg', width: 400, height: 300 }),
  }
  const pages = [
    page('p1', 'a', { section: 'Part one' }),
    page('p2', 'b'),
    page('p3', 'c', { section: 'Part two' }),
    page('p4', 'a'),
  ]
  const make = (outline: OutlineItem[], password?: string) =>
    buildPdf(
      {
        settings: settings(),
        pages,
        assets: pdfAssets,
        outline,
        ...(password ? { password } : {}),
      },
      { getBytes: () => jpeg },
    )

  it('writes sections and files, opening at their pages', async () => {
    const bytes = await make(buildOutline(pages, pdfAssets, { files: true }))
    expect(await readOutline(bytes)).toEqual([
      'Part one @1',
      '  Front @1',
      '  Back @2',
      'Part two @3',
      '  Ünïcode — notes @3',
      '  Front @4',
    ])
    const doc = await PDFDocument.load(bytes)
    expect(doc.catalog.get(PDFName.of('PageMode'))).toBe(PDFName.of('UseOutlines'))
  })

  it.skipIf(!hasPdftohtml)('reads back in poppler, locked or not', async () => {
    const outline = buildOutline(pages, pdfAssets, { files: false })
    expect(popplerTitles(await make(outline))).toEqual(['Part one @1', 'Part two @3'])
    expect(popplerTitles(await make(outline, 'secret'), 'secret')).toEqual([
      'Part one @1',
      'Part two @3',
    ])
  })

  it('adds no outline when there is nothing to mark', async () => {
    const bytes = await make([])
    const doc = await PDFDocument.load(bytes)
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined()
    expect(doc.catalog.get(PDFName.of('PageMode'))).toBeUndefined()
  })

  it('gives each part of a split its own, under the section it starts in', async () => {
    const parts = [
      { name: 'a.pdf', pageIds: ['p1', 'p2'], start: 1 },
      { name: 'b.pdf', pageIds: ['p2', 'p3', 'p4'], start: 1 },
    ].map((part) => ({
      ...part,
      outline: buildOutline(
        part.pageIds.flatMap((id) => pages.find((p) => p.id === id) ?? []),
        pdfAssets,
        { files: false, carried: sectionBefore(pages, part.pageIds[0] ?? '') },
      ),
    }))
    const zip = await buildSplit(
      { settings: settings(), pages, assets: pdfAssets },
      parts,
      async (input) => ({
        pdf: await buildPdf(input, { getBytes: () => jpeg }),
        compression: null,
        fits: true,
      }),
    )
    const files = unzipSync(zip.pdf)
    expect(await readOutline(files['a.pdf'] ?? new Uint8Array())).toEqual(['Part one @1'])
    expect(await readOutline(files['b.pdf'] ?? new Uint8Array())).toEqual([
      'Part one @1',
      'Part two @2',
    ])
  })
})
