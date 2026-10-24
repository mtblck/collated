import { describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, saveSettings } from './settingsStorage'

const memory = () => {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v)
    },
  }
}

describe('settings storage', () => {
  it('defaults to the locale’s paper', () => {
    expect(defaultSettings('en-US')).toMatchObject({ size: 'letter', unit: 'in', margin: 0 })
    expect(defaultSettings('en-GB')).toMatchObject({ size: 'a4', unit: 'mm' })
  })

  it('round-trips page setup but never the title', () => {
    const store = memory()
    saveSettings(store, {
      ...defaultSettings('en-US'),
      size: 'legal',
      margin: 18,
      title: 'Private',
    })
    const loaded = loadSettings(store, 'en-GB')
    expect(loaded).toMatchObject({ size: 'legal', unit: 'in', margin: 18, title: '' })
  })

  it('remembers how the watermark looks, never what it says or where', () => {
    const store = memory()
    saveSettings(store, {
      ...defaultSettings('en-US'),
      watermark: {
        show: true,
        text: 'Copy for Acme Bank only',
        position: 'footer',
        size: 'large',
        opacity: 0.6,
        colour: '#C0392B',
        flatten: true,
        pageIds: ['p1'],
      },
    })
    expect(store.getItem('collated:settings')).not.toContain('Acme')
    expect(loadSettings(store, 'en-US').watermark).toEqual({
      show: false,
      text: '',
      position: 'footer',
      size: 'large',
      opacity: 0.6,
      colour: '#c0392b',
      flatten: true,
      pageIds: null,
    })
    store.setItem(
      'collated:settings',
      JSON.stringify({ watermark: { opacity: -1, colour: 'red', size: 'huge' } }),
    )
    expect(loadSettings(store, 'en-US').watermark).toMatchObject({
      opacity: 0.1,
      colour: '#808080',
      size: 'medium',
    })
  })

  it('falls back field by field on bad data', () => {
    const store = memory()
    store.setItem(
      'collated:settings',
      JSON.stringify({
        size: 'b5',
        unit: 'cm',
        margin: -4,
        orientation: 'portrait',
        quality: 'ultra',
        maxBytes: -1,
      }),
    )
    expect(loadSettings(store, 'en-GB')).toMatchObject({
      size: 'a4',
      unit: 'mm',
      margin: 0,
      orientation: 'portrait',
      quality: 'original',
      maxBytes: null,
    })
    store.setItem('collated:settings', '{nope')
    expect(loadSettings(store, 'en-GB')).toEqual(defaultSettings('en-GB'))
  })

  it('clamps the page-number start to the field’s range', () => {
    const store = memory()
    const start = (value: unknown) => {
      store.setItem('collated:settings', JSON.stringify({ pageNumbers: { start: value } }))
      return loadSettings(store, 'en-GB').pageNumbers.start
    }
    expect(start(-3)).toBe(0)
    expect(start(12.4)).toBe(12)
    expect(start(9999)).toBe(9999)
    expect(start(1e9)).toBe(9999)
    expect(start('7')).toBe(1)
  })

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadSettings(throwing, 'en-US').size).toBe('letter')
    expect(() => {
      saveSettings(throwing, defaultSettings('en-US'))
    }).not.toThrow()
  })
})
