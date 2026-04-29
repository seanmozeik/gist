import type { CliProvider } from '../config.js';
import { resolveConfigState } from './run-config.js';
import { resolveEnvState } from './run-env.js';

export function resolveRunContextState({
  env,
  envForRun,
  programOpts,
  languageExplicitlySet,
  videoModeExplicitlySet,
  cliFlagPresent,
  cliProviderArg,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  programOpts: Record<string, unknown>;
  languageExplicitlySet: boolean;
  videoModeExplicitlySet: boolean;
  cliFlagPresent: boolean;
  cliProviderArg: CliProvider | null;
}) {
  const configState = resolveConfigState({
    cliFlagPresent,
    cliProviderArg,
    envForRun,
    languageExplicitlySet,
    programOpts,
    videoModeExplicitlySet,
  });
  const envState = resolveEnvState({ configForCli: configState.configForCli, env, envForRun });
  return { ...configState, ...envState };
}
