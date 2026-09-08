import { createSupabaseClient, hasSupabaseConfig, readSupabaseConfig } from './supabase-client.js';
import { createPropertyRepository } from './property-repository.js';

function defaultFallback() {
  return globalThis.window?.IMOVEIS_DATA ?? globalThis.IMOVEIS_DATA ?? [];
}

function defaultPublicImageUrl(client, path) {
  return client.storage?.from('property-images')?.getPublicUrl(path)?.data?.publicUrl ?? path;
}

export function createPropertySource({ config, client, fallback, publicImageUrl } = {}) {
  const normalizedConfig = readSupabaseConfig(config ?? globalThis.window?.TAMARA_SUPABASE_CONFIG);
  const staticProperties = fallback ?? defaultFallback();
  const configured = hasSupabaseConfig(normalizedConfig);
  const resolvedClient = configured ? (client ?? createSupabaseClient({ config: normalizedConfig })) : null;
  const repository = resolvedClient
    ? createPropertyRepository({
      client: resolvedClient,
      publicImageUrl: publicImageUrl ?? ((path) => defaultPublicImageUrl(resolvedClient, path)),
    })
    : null;

  return {
    async loadPublicProperties() {
      if (!repository) return staticProperties;
      try {
        return await repository.listPublished();
      } catch {
        return staticProperties;
      }
    },
  };
}

export async function loadPublicProperties(options = {}) {
  return createPropertySource(options).loadPublicProperties();
}

if (globalThis.window) {
  globalThis.window.createPropertySource = createPropertySource;
  globalThis.window.loadPublicProperties = loadPublicProperties;
}
