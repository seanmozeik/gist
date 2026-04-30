import { describe, expect, it } from 'vitest';

import type { GistConfig } from '../src/config';
import { resolveEnvState } from '../src/run/run-env';

describe('run env', () => {
  it('falls back to config zai.baseUrl when env is blank', () => {
    const configForCli: GistConfig = { zai: { baseUrl: 'https://api.zhipuai.cn/paas/v4' } };

    const state = resolveEnvState({ configForCli, env: {}, envForRun: { Z_AI_BASE_URL: '   ' } });

    expect(state.zaiBaseUrl).toBe('https://api.zhipuai.cn/paas/v4');
  });
});
