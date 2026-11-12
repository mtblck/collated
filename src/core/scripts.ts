/**
 * What the text layer needs to know about a word's script (#139): whether it
 * runs right to left, and whether its words are written without spaces.
 */

/** Letters of the right-to-left scripts. (Their marks are mostly in no script.) */
const RTL = /[\p{sc=Hebrew}\p{sc=Arabic}\p{sc=Syriac}\p{sc=Thaana}\p{sc=Nko}]/u
/** Characters that keep left-to-right order inside a right-to-left word. */
const LTR = /[\p{L}\p{Nd}]/u
const MARK = /\p{M}/u
const DIGIT = /\p{Nd}/u

/** Whether `text` has a right-to-left letter, so it's written right to left. */
export const isRightToLeft = (text: string) => RTL.test(text)

/** Letters of the left-to-right alphabets OCR reads. */
const ALPHABET = /[\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}\p{sc=Hangul}]/u

/** Whether `text` has a letter of a left-to-right alphabet (not digits). */
export const hasLeftToRightLetter = (text: string) => ALPHABET.test(text)

/**
 * A right-to-left word in the order its characters sit on the page, left to
 * right: the Unicode bidirectional algorithm's reordering for a word in a
 * right-to-left line. Its letters reverse; runs of digits and Latin letters
 * inside it (`2024`, `PDF`, and Arabic-Indic digits too) keep their order, with
 * a separator between two of their characters (`3.5`, `1,000`) kept inside the
 * run. Combining marks reverse with their letter, so come just before it, as
 * the algorithm's rule L2 leaves them, except marks ending the word, which
 * are left out (see below). Brackets aren't mirrored, as pdf.js and
 * Poppler don't mirror them back.
 *
 * Text extraction (pdf.js, pdftotext) reads a run of right-to-left glyphs back
 * in this order and reverses it, so the word is searched and copied in its
 * logical order. Text with no right-to-left letter comes back unchanged.
 */
export const visualOrder = (text: string) => {
  if (!isRightToLeft(text)) return text
  const chars = Array.from(text)
  // Digits first: Arabic-Indic ones are in the Arabic script but read left to right.
  const kind = chars.map((ch) =>
    DIGIT.test(ch) ? 'l' : RTL.test(ch) ? 'r' : LTR.test(ch) ? 'l' : 'n',
  )
  // A mark goes with the character before it.
  for (let i = 1; i < chars.length; i++) {
    if (MARK.test(chars[i] ?? '')) kind[i] = kind[i - 1] ?? 'n'
  }
  // One neutral between left-to-right characters joins them ("3.5").
  for (let i = 1; i < chars.length - 1; i++) {
    if (kind[i] === 'n' && kind[i - 1] === 'l' && kind[i + 1] === 'l') kind[i] = 'l'
  }
  // Marks that end the word would come first on the page, with no letter
  // before them; pdf.js and Poppler join them to the word on their left
  // instead, and split this one. They're left out, which search ignores anyway
  // (the tanwin in أهلاً, a point on a final Hebrew letter).
  while (chars.length > 1 && kind.at(-1) !== 'l' && MARK.test(chars.at(-1) ?? '')) {
    chars.pop()
    kind.pop()
  }
  // Everything reverses except the left-to-right runs, which move as a unit.
  const units: string[] = []
  chars.forEach((ch, i) => {
    const last = units.length - 1
    if (last >= 0 && kind[i] === 'l' && kind[i - 1] === 'l')
      units[last] = `${units[last] ?? ''}${ch}`
    else units.push(ch)
  })
  return units.reverse().join('')
}

/**
 * Characters of scripts written without spaces between words: Chinese
 * characters, kana, and their full-width punctuation. (Korean puts spaces
 * between words, so Hangul isn't one of them.)
 */
const UNSPACED =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\u3000-\u303f\u30fc\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/u

/** Whether `ch` (one character) belongs to a script written without spaces. */
export const isUnspaced = (ch: string | undefined) => !!ch && UNSPACED.test(ch)

/** Whether a word ends with a character that takes no space after it. */
export const endsUnspaced = (text: string) => isUnspaced(Array.from(text).at(-1))

/** Whether a word starts with a character that takes no space before it. */
export const startsUnspaced = (text: string) => isUnspaced(Array.from(text)[0])
