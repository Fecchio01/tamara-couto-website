export function readSupabaseConfig(config = globalThis.TAMARA_SUPABASE_CONFIG) {
  return {
    url: typeof config?.url === 'string' ? config.url.trim() : '',
    publishableKey: typeof config?.publishableKey === 'string' ? config.publishableKey.trim() : '',
  };
}

export function hasSupabaseConfig(config) {
  const normalized = readSupabaseConfig(config);
  try {
    const parsedUrl = new URL(normalized.url);
    return Boolean(
      normalized.publishableKey
      && (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')
      && parsedUrl.hostname,
    );
  } catch {
    return false;
  }
}

export function createSupabaseClient({ config, factory } = {}) {
  const normalized = readSupabaseConfig(config);
  if (!hasSupabaseConfig(normalized)) return null;

  const createClient = factory ?? globalThis.supabase?.createClient;
  if (typeof createClient !== 'function') return null;

  return createClient(normalized.url, normalized.publishableKey);
}

if (globalThis.window) {
  globalThis.window.createSupabaseClient = createSupabaseClient;
}
