import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Asset, DocState, Page, Settings } from '../src/core/model'
import { DEFAULT_TRANSFORM } from '../src/core/model'

export const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)))

export const settings = (patch: Partial<Settings> = {}): Settings => ({
  size: 'a4',
  custom: { width: 612, height: 792 },
  unit: 'mm',
  orientation: 'auto',
  margin: 0,
  title: '',
  quality: 'original',
  maxBytes: null,
  imageDpi: 300,
  pageNumbers: { show: false, position: 'bottom-center', start: 1 },
  ...patch,
})

export const asset = (id: string, patch: Partial<Asset> = {}): Asset => ({
  id,
  bytesId: id,
  name: `${id}.jpg`,
  width: 240,
  height: 160,
  format: 'jpeg',
  storedTurns: 0,
  thumbUrl: `blob:${id}`,
  byteLength: 1000,
  ...patch,
})

export const page = (id: string, assetId: string, patch: Partial<Page> = {}): Page => ({
  id,
  assetId,
  ...DEFAULT_TRANSFORM,
  ...patch,
})

export const doc = (pageCount: number, patch: Partial<DocState> = {}): DocState => {
  const assets = Object.fromEntries(
    Array.from({ length: pageCount }, (_, i) => [`a${i}`, asset(`a${i}`)]),
  )
  return {
    settings: settings(),
    assets,
    pages: Array.from({ length: pageCount }, (_, i) => page(`p${i}`, `a${i}`)),
    ...patch,
  }
}
