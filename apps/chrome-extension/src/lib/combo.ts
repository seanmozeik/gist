export function resolvePresetOrCustom({
  value,
  presets,
}: {
  value: string;
  presets: Iterable<string>;
}): { presetValue: string; customValue: string; isCustom: boolean } {
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  const presetSet = new Set(Array.from(presets, (p) => p.toLowerCase()));
  if (presetSet.has(lowered)) {
    return { customValue: '', isCustom: false, presetValue: lowered };
  }
  return { customValue: trimmed, isCustom: true, presetValue: 'custom' };
}

export function readPresetOrCustomValue({
  presetValue,
  customValue,
  defaultValue,
}: {
  presetValue: string;
  customValue: string;
  defaultValue: string;
}): string {
  const presetTrimmed = presetValue.trim();
  if (presetTrimmed === 'custom') {
    const customTrimmed = customValue.trim();
    return customTrimmed || defaultValue;
  }
  return presetTrimmed || defaultValue;
}
