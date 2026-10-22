/*
 * Runs before first paint (a blocking script in <head>) so the right palette is
 * on <html> before anything renders; doing it in React would flash light for
 * anyone on the dark theme. A file, not inline: the CSP is script-src 'self'.
 * The `mb-theme` key is the one mattblack.space uses; Collated has its own
 * origin now, so the choice is its own.
 */
;(function () {
  try {
    var stored = localStorage.getItem('mb-theme')
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    document.documentElement.dataset.theme = theme
  } catch {
    /* storage can throw in private mode; the light default already applies */
  }
})()
