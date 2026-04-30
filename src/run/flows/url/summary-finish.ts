import type { ExtractedLinkContent } from '../../../content/index';
import { parseGatewayStyleModelId } from '../../../llm/model-id';
import { buildLengthPartsForFinishLine } from '../../finish-line';
import type { ModelAttempt } from '../../types';
import type { UrlFlowContext } from './types';

export function buildFinishExtras({
  extracted,
  metricsDetailed,
  transcriptionCostLabel,
}: {
  extracted: ExtractedLinkContent;
  metricsDetailed: boolean;
  transcriptionCostLabel: string | null;
}) {
  const parts = [
    ...(buildLengthPartsForFinishLine(extracted, metricsDetailed) ?? []),
    ...(transcriptionCostLabel ? [transcriptionCostLabel] : []),
  ];
  return parts.length > 0 ? parts : null;
}

export function pickModelForFinishLine(
  llmCalls: UrlFlowContext['model']['llmCalls'],
  fallback: string | null,
) {
  const lastCall = llmCalls.at(-1);
  if (lastCall?.model) {
    return lastCall.model;
  }

  return fallback;
}

export function buildModelMetaFromAttempt(attempt: ModelAttempt) {
  if (attempt.transport === 'cli') {
    return { canonical: attempt.userModelId, provider: 'cli' as const };
  }
  const parsed = parseGatewayStyleModelId(attempt.llmModelId ?? attempt.userModelId);
  const canonical = attempt.userModelId.toLowerCase().startsWith('openrouter/')
    ? attempt.userModelId
    : parsed.canonical;
  return { canonical, provider: parsed.provider };
}
