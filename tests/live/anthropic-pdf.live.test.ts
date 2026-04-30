import { describe, expect, it } from 'vitest';

import { generateTextWithModelId } from '../../src/llm/generate-text';
import { buildDocumentPrompt } from '../helpers/document-prompt';
import { buildMinimalPdf } from '../helpers/pdf';

const LIVE = process.env.GIST_LIVE_TEST === '1';

function shouldSoftSkipLiveError(message: string): boolean {
  return /(model.*not found|does not exist|permission|access|unauthorized|forbidden|404|not_found|model_not_found|unsupported|invalid_request)/i.test(
    message,
  );
}

(LIVE ? describe : describe.skip)('live anthropic PDF', () => {
  const timeoutMs = 120_000;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null;

  it(
    'gists PDF attachments',
    async () => {
      if (!anthropicApiKey) {
        it.skip('requires ANTHROPIC_API_KEY', () => {
          /* Empty */
        });
        return;
      }

      try {
        const pdfBytes = buildMinimalPdf('Hello PDF');
        const result = await generateTextWithModelId({
          apiKeys: {
            anthropicApiKey,
            googleApiKey: null,
            openaiApiKey: null,
            openrouterApiKey: null,
            xaiApiKey: null,
          },
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 256,
          modelId: 'anthropic/claude-opus-4-5',
          prompt: buildDocumentPrompt({
            bytes: pdfBytes,
            filename: 'hello.pdf',
            text: 'Gist the attached PDF in one sentence.',
          }),
          timeoutMs,
        });
        expect(result.text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );
});
