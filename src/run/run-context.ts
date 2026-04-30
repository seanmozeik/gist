import type { CliProvider } from '../config';
import { resolveConfigState } from './run-config';
import { resolveEnvState } from './run-env';

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
