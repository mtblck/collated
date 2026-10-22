import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

/** The theme choice, kept in this origin's storage (the key is shared with mattblack.space's apps). */
export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const toggle = () => {
    setTheme(next)
    try {
      localStorage.setItem('mb-theme', next)
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }
  return { theme, next, toggle }
}
