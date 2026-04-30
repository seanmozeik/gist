const NORMALIZE_PATTERN = /[^a-z0-9-]+/g;

export type OutputLanguage =
  | { kind: 'auto' }
  | {
      kind: 'fixed';
      /**
       * BCP-47-ish language tag (e.g. "en", "de", "en-US").
       *
       * Note: we keep this mostly user-provided; the model does the heavy lifting.
       */
      tag: string;
      /**
       * Human-friendly label for prompts (e.g. "English", "German").
       */
      label: string;
    };

const LANGUAGE_ALIASES: Record<string, { tag: string; label: string }> = {
  ar: { label: 'Arabic', tag: 'ar' },
  arabic: { label: 'Arabic', tag: 'ar' },
  chinese: { label: 'Chinese', tag: 'zh' },
  cs: { label: 'Czech', tag: 'cs' },

  czech: { label: 'Czech', tag: 'cs' },
  da: { label: 'Danish', tag: 'da' },
  danish: { label: 'Danish', tag: 'da' },
  de: { label: 'German', tag: 'de' },

  'de-de': { label: 'German', tag: 'de-DE' },
  deutsch: { label: 'German', tag: 'de' },
  dutch: { label: 'Dutch', tag: 'nl' },
  en: { label: 'English', tag: 'en' },
  'en-gb': { label: 'English', tag: 'en-GB' },

  'en-us': { label: 'English', tag: 'en-US' },
  english: { label: 'English', tag: 'en' },

  es: { label: 'Spanish', tag: 'es' },
  'es-es': { label: 'Spanish', tag: 'es-ES' },

  'es-mx': { label: 'Spanish', tag: 'es-MX' },
  espanol: { label: 'Spanish', tag: 'es' },
  fi: { label: 'Finnish', tag: 'fi' },
  finnish: { label: 'Finnish', tag: 'fi' },

  fr: { label: 'French', tag: 'fr' },
  french: { label: 'French', tag: 'fr' },

  german: { label: 'German', tag: 'de' },
  hi: { label: 'Hindi', tag: 'hi' },

  hindi: { label: 'Hindi', tag: 'hi' },
  it: { label: 'Italian', tag: 'it' },

  italian: { label: 'Italian', tag: 'it' },
  ja: { label: 'Japanese', tag: 'ja' },

  japanese: { label: 'Japanese', tag: 'ja' },
  ko: { label: 'Korean', tag: 'ko' },

  korean: { label: 'Korean', tag: 'ko' },
  nl: { label: 'Dutch', tag: 'nl' },

  no: { label: 'Norwegian', tag: 'no' },
  norwegian: { label: 'Norwegian', tag: 'no' },

  pl: { label: 'Polish', tag: 'pl' },
  polish: { label: 'Polish', tag: 'pl' },

  portuguese: { label: 'Portuguese', tag: 'pt' },
  pt: { label: 'Portuguese', tag: 'pt' },

  'pt-br': { label: 'Portuguese (Brazil)', tag: 'pt-BR' },
  'pt-pt': { label: 'Portuguese (Portugal)', tag: 'pt-PT' },

  ru: { label: 'Russian', tag: 'ru' },
  russian: { label: 'Russian', tag: 'ru' },
  spanish: { label: 'Spanish', tag: 'es' },
  sv: { label: 'Swedish', tag: 'sv' },
  swedish: { label: 'Swedish', tag: 'sv' },
  tr: { label: 'Turkish', tag: 'tr' },

  turkish: { label: 'Turkish', tag: 'tr' },
  uk: { label: 'Ukrainian', tag: 'uk' },

  ukrainian: { label: 'Ukrainian', tag: 'uk' },
  zh: { label: 'Chinese', tag: 'zh' },

  'zh-cn': { label: 'Chinese (Simplified)', tag: 'zh-CN' },
  'zh-hans': { label: 'Chinese (Simplified)', tag: 'zh-Hans' },

  'zh-hant': { label: 'Chinese (Traditional)', tag: 'zh-Hant' },
  'zh-tw': { label: 'Chinese (Traditional)', tag: 'zh-TW' },
};

const looksLikeLanguageTag = (value: string): boolean =>
  // Keep this loose: the model can handle tags like "en-US" or "pt-BR".
  /^[a-zA-Z]{2,3}([_-][a-zA-Z0-9]{2,8})*$/.test(value);

function normalizeLanguageTag(value: string): string {
  const parts = value
    .replaceAll('_', '-')
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return value;
  }
  const headRaw = parts[0];
  if (!headRaw) {
    return value;
  }
  const rest = parts.slice(1);
  const head = headRaw.toLowerCase();
  const tail = rest.map((p) =>
    p.length === 2 ? p.toUpperCase() : p.slice(0, 1).toUpperCase() + p.slice(1),
  );
  return [head, ...tail].join('-');
}

function sanitizeFreeForm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replaceAll(/\s+/g, ' ').slice(0, 64);
}

export function parseOutputLanguage(raw: string): OutputLanguage {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Invalid --language: must not be empty.');
  }
  const compact = trimmed
    .toLowerCase()
    .replaceAll('_', '-')
    .replaceAll(NORMALIZE_PATTERN, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
  if (compact === 'auto') {
    return { kind: 'auto' };
  }

  const alias = LANGUAGE_ALIASES[compact];
  if (alias) {
    return { kind: 'fixed', label: alias.label, tag: alias.tag };
  }

  if (looksLikeLanguageTag(trimmed)) {
    const tag = normalizeLanguageTag(trimmed);
    return { kind: 'fixed', label: tag, tag };
  }

  const freeForm = sanitizeFreeForm(trimmed);
  return { kind: 'fixed', label: freeForm, tag: freeForm };
}

export function resolveOutputLanguage(raw: string | null | undefined): OutputLanguage {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return { kind: 'auto' };
  }
  try {
    return parseOutputLanguage(value);
  } catch {
    return { kind: 'auto' };
  }
}

export function formatOutputLanguageInstruction(language: OutputLanguage): string {
  if (language.kind === 'auto') {
    return "Match the dominant source language. If you can't confidently detect it, use English.";
  }
  return `Write the answer in ${language.label}.`;
}

export function formatOutputLanguageForJson(
  language: OutputLanguage,
): { mode: 'auto' } | { mode: 'fixed'; tag: string; label: string } {
  return language.kind === 'auto'
    ? { mode: 'auto' }
    : { label: language.label, mode: 'fixed', tag: language.tag };
}
