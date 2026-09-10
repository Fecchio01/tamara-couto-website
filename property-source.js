import { createSupabaseClient, hasSupabaseConfig, readSupabaseConfig } from './supabase-client.js';
import { createPropertyRepository } from './property-repository.js';

function defaultFallback() {
  return globalThis.window?.IMOVEIS_DATA ?? globalThis.IMOVEIS_DATA ?? [];
}

function preserveStaticGalleries(properties, fallback) {
  const fallbackById = new Map(
    (fallback ?? []).map((property) => [String(property?.id ?? ''), property]),
  );

  return (properties ?? []).map((property) => {
    if (Array.isArray(property?.images) && property.images.length > 0) return property;
    const staticProperty = fallbackById.get(String(property?.id ?? ''));
    if (!staticProperty?.images?.length) return property;
    return { ...property, images: [...staticProperty.images] };
  });
}

async function defaultPublicImageUrl(client, path) {
  try {
    const parsed = new URL(String(path ?? ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    // Storage paths are handled below.
  }
  const storage = client.storage?.from('property-images');
  if (!storage || typeof storage.createSignedUrl !== 'function') {
    throw new Error('Creating property image URL failed: signed URL support unavailable');
  }
  const { data, error } = await storage.createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    const detail = typeof error?.message === 'string' ? error.message.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 200) : '';
    throw new Error(`Creating property image URL failed${detail ? `: ${detail}` : ''}`);
  }
  return data.signedUrl;
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
        const remoteProperties = await repository.listPublished();
        return preserveStaticGalleries(remoteProperties, staticProperties);
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
