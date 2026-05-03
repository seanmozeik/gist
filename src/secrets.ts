const KEYCHAIN_SERVICE = 'GIST';
const KEYCHAIN_ACCOUNT = 'GIST';

interface BunSecrets {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

export const SECRET_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'APIFY_API_TOKEN',
  'ASSEMBLYAI_API_KEY',
  'CURSOR_API_KEY',
  'FAL_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'XAI_API_KEY',
  'Z_AI_API_KEY',
] as const;

export type SecretEnvKey = (typeof SECRET_ENV_KEYS)[number];
export type SecretBlob = Partial<Record<SecretEnvKey, string>>;

const SECRET_ENV_KEY_SET = new Set<string>(SECRET_ENV_KEYS);

const SECRET_NAME_ALIASES: Record<string, SecretEnvKey> = {
  agent: 'CURSOR_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  apify: 'APIFY_API_TOKEN',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  cursor: 'CURSOR_API_KEY',
  fal: 'FAL_KEY',
  gemini: 'GEMINI_API_KEY',
  google: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  zai: 'Z_AI_API_KEY',
};

export function normalizeSecretEnvKey(input: string): SecretEnvKey {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (SECRET_ENV_KEY_SET.has(upper)) {
    return upper as SecretEnvKey;
  }
  const alias = SECRET_NAME_ALIASES[trimmed.toLowerCase().replaceAll('-', '_')];
  if (alias) {
    return alias;
  }
  throw new Error(
    `Unknown secret "${input}". Use one of: ${Object.keys(SECRET_NAME_ALIASES).join(', ')}`,
  );
}

function getBunSecrets(): BunSecrets | null {
  const bun = (globalThis as { Bun?: { secrets?: BunSecrets } }).Bun;
  return bun?.secrets ?? null;
}

function requireBunSecrets(): BunSecrets {
  const secrets = getBunSecrets();
  if (!secrets) {
    throw new Error('Bun.secrets is not available in this runtime.');
  }
  return secrets;
}

function isSecretBlob(value: unknown): value is SecretBlob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, val]) => SECRET_ENV_KEY_SET.has(key) && typeof val === 'string',
  );
}

async function readKeychainBlob(): Promise<SecretBlob> {
  const secrets = getBunSecrets();
  if (!secrets) {
    return {};
  }
  const raw = await secrets.get({ name: KEYCHAIN_ACCOUNT, service: KEYCHAIN_SERVICE });
  if (raw === null || raw.trim() === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isSecretBlob(parsed)) {
    throw new Error(`${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT} is not a valid gist secrets blob`);
  }
  return parsed;
}

export async function readSecretsEnv(): Promise<Record<string, string>> {
  try {
    return await readKeychainBlob();
  } catch {
    return {};
  }
}

export function mergeSecretEnv({
  env,
  secrets,
}: {
  env: Record<string, string | undefined>;
  secrets: Record<string, string | undefined>;
}): Record<string, string | undefined> {
  if (Object.keys(secrets).length === 0) {
    return env;
  }
  let changed = false;
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }
    const current = merged[key];
    if (typeof current === 'string' && current.trim().length > 0) {
      continue;
    }
    merged[key] = value;
    changed = true;
  }
  return changed ? merged : env;
}

export async function saveSecret(input: string, value: string): Promise<string> {
  const envKey = normalizeSecretEnvKey(input);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Secret value must not be empty.');
  }
  const blob = await readKeychainBlob();
  await requireBunSecrets().set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify({ ...blob, [envKey]: trimmed }),
  });
  return `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}:${envKey}`;
}

export async function deleteSecret(input: string): Promise<boolean> {
  const envKey = normalizeSecretEnvKey(input);
  const blob = await readKeychainBlob();
  if (blob[envKey] === undefined) {
    return false;
  }
  delete blob[envKey];
  const secrets = requireBunSecrets();
  if (Object.keys(blob).length === 0) {
    await secrets.delete({ name: KEYCHAIN_ACCOUNT, service: KEYCHAIN_SERVICE });
    return true;
  }
  await secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify(blob),
  });
  return true;
}

export async function authStatus(
  env: Record<string, string | undefined>,
): Promise<{ configured: boolean; key: SecretEnvKey; source: string | null }[]> {
  const keychain = await readSecretsEnv();
  return SECRET_ENV_KEYS.map((key) => {
    if (typeof env[key] === 'string' && env[key].trim().length > 0) {
      return { configured: true, key, source: `env:${key}` };
    }
    if (typeof keychain[key] === 'string' && keychain[key].trim().length > 0) {
      return { configured: true, key, source: `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}` };
    }
    return { configured: false, key, source: null };
  });
}
