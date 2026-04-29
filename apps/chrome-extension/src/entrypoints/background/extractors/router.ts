import { shouldPreferUrlMode } from '@steipete/summarize-core/content/url';

import { pageReadabilityExtractor } from './page-readability';
import { redditThreadExtractor } from './reddit-thread';
import type { Extractor, ExtractorContext, ExtractorResult } from './types';
import { urlDaemonExtractor } from './url-daemon';

const extractors: Extractor[] = [
  redditThreadExtractor,
  pageReadabilityExtractor,
  urlDaemonExtractor,
];

export async function routeExtract(ctx: ExtractorContext): Promise<ExtractorResult | null> {
  const preferUrl = shouldPreferUrlMode(ctx.url);
  ctx.log('extractor.route.start', { preferUrl, tabId: ctx.tabId });
  if (preferUrl) {
    ctx.log('extractor.route.preferUrlHardSwitch', { tabId: ctx.tabId });
    return null;
  }

  for (const extractor of extractors) {
    const matched = extractor.match(ctx);
    ctx.log('extractor.try', { extractor: extractor.name, matched });
    if (!matched) {continue;}

    try {
      const result = await extractor.extract(ctx);
      if (!result) {
        ctx.log('extractor.fail', { extractor: extractor.name, reason: 'no-result' });
        continue;
      }
      ctx.log('extractor.success', {
        characters: result.extracted.text.length,
        extractor: extractor.name,
        source: result.source,
        truncated: result.extracted.truncated,
      });
      return result;
    } catch (error) {
      ctx.log('extractor.fail', {
        extractor: extractor.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  ctx.log('extractor.route.fail', { reason: 'no-extractor-result' });
  return null;
}

export type { ExtractLog, ExtractorContext, ExtractorResult } from './types';
