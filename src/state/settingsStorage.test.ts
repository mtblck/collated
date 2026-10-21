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

  it('falls back field by field on bad data', () => {
    const store = memory()
    store.setItem(
      'collated:settings',
      JSON.stringify({ size: 'b5', unit: 'cm', margin: -4, orientation: 'portrait' }),
    )
    expect(loadSettings(store, 'en-GB')).toMatchObject({
      size: 'a4',
      unit: 'mm',
      margin: 0,
      orientation: 'portrait',
    })
    store.setItem('collated:settings', '{nope')
    expect(loadSettings(store, 'en-GB')).toEqual(defaultSettings('en-GB'))
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
