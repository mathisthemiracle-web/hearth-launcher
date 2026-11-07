import type { Language } from '../types'
import { FR } from './i18n-fr'

/**
 * English text is the key, so untranslated strings still read naturally.
 * `{name}` placeholders are filled from `vars`.
 */
export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  let value = language === 'fr' ? FR[text] ?? text : text
  if (vars) {
    for (const [key, replacement] of Object.entries(vars)) value = value.replaceAll(`{${key}}`, String(replacement))
  }
  return value
}

export type Translate = (text: string, vars?: Record<string, string | number>) => string
