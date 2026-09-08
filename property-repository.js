import {
  normalizePropertyRow,
  parsePriceToCents,
  toLegacyProperty,
} from './admin/property-model.mjs';

const PROPERTY_SELECT = '*, property_images(*)';

function safeProviderDetail(error) {
  const code = typeof error?.code === 'string'
    ? error.code.replace(/[^a-z0-9_.-]/gi, '').slice(0, 40)
    : '';
  const message = typeof error?.message === 'string'
    ? error.message
      .replace(/https?:\/\/\S+/gi, '[url]')
      .replace(/(?:service_role|publishable(?:Key)?|api[_-]?key|access[_-]?token|token)=\S+/gi, '[redacted]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    : '';
  return [code, message].filter(Boolean).join(': ');
}

function throwOperationError(operation, error) {
  const detail = safeProviderDetail(error);
  throw new Error(`${operation} failed${detail ? `: ${detail}` : ''}`);
}

function safeStoragePath(path) {
  const normalized = String(path ?? '').replace(/[\r\n]/g, '');
  return normalized.startsWith('properties/')
    ? normalized.slice(0, 240)
    : '[invalid-path]';
}

function throwStorageCleanupError(operation, failedPaths) {
  const pendingPaths = failedPaths.map(({ path }) => safeStoragePath(path));
  const detail = safeProviderDetail(failedPaths[0]?.error);
  const error = new Error(
    `${operation} failed for ${pendingPaths.length} object(s): ${pendingPaths.join(', ')}`
      + (detail ? `: ${detail}` : ''),
  );
  error.code = 'STORAGE_CLEANUP_INCOMPLETE';
  error.pendingPaths = pendingPaths;
  throw error;
}

async function cleanupStorageObjects(storage, paths) {
  try {
    const batchResult = await storage.remove(paths);
    if (!batchResult?.error) return [];
  } catch {
    // A rejected batch must still fall through to per-object cleanup.
  }

  const retryResults = await Promise.all(paths.map(async (path) => {
    try {
      const result = await storage.remove([path]);
      return result?.error ? { path, error: result.error } : null;
    } catch (error) {
      return { path, error };
    }
  }));
  return retryResults.filter(Boolean);
}

async function normalizeProperty(row, publicImageUrl) {
  const property = normalizePropertyRow(row, row?.property_images ?? []);
  return {
    ...property,
    images: await Promise.all(property.images.map((path) => publicImageUrl(path))),
  };
}

async function normalizeLegacyProperty(row, publicImageUrl) {
  return toLegacyProperty(await normalizeProperty(row, publicImageUrl));
}

function inputToPayload(input = {}) {
  return {
    legacy_id: input.legacy_id ?? input.legacyId ?? null,
    title: String(input.title ?? '').trim(),
    type: String(input.type ?? '').trim(),
    location: input.location ?? '',
    neighborhood: input.neighborhood ?? '',
    price_cents: input.price_cents ?? parsePriceToCents(input.price),
    features: Array.isArray(input.features) ? input.features : [],
    is_new: input.is_new ?? input.isNew ?? null,
    purpose: input.purpose ?? null,
    source_url: input.source_url ?? input.sourceUrl ?? null,
    proximidades: Array.isArray(input.proximidades) ? input.proximidades : [],
    description: input.description ?? '',
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    map_url: input.map_url ?? input.mapUrl ?? null,
    status: input.status ?? 'draft',
  };
}

function safeFileName(file) {
  const name = String(file?.name ?? 'image')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return name || 'image';
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function signedStorageUrl(client, path) {
  const storage = client.storage?.from('property-images');
  if (!storage || typeof storage.createSignedUrl !== 'function') {
    throw new Error('Creating property image URL failed: signed URL support unavailable');
  }
  const { data, error } = await storage.createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throwOperationError('Creating property image URL', error);
  return data.signedUrl;
}

export function createPropertyRepository({ client, publicImageUrl } = {}) {
  if (!client) throw new Error('Property repository requires a client');
  const toPublicImageUrl = publicImageUrl ?? ((path) => signedStorageUrl(client, path));

  async function listPublished() {
    const { data, error } = await client
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('status', 'published')
      .order('updated_at', { ascending: false });
    if (error) throwOperationError('Loading published properties', error);
    return Promise.all((data ?? []).map((row) => normalizeLegacyProperty(row, toPublicImageUrl)));
  }

  async function listAdmin(filters = {}) {
    let query = client.from('properties').select(PROPERTY_SELECT).order('updated_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.search) query = query.ilike('title', `%${filters.search}%`);

    const { data, error } = await query;
    if (error) throwOperationError('Loading properties', error);
    return Promise.all((data ?? []).map((row) => normalizeProperty(row, toPublicImageUrl)));
  }

  async function getById(id) {
    const query = client.from('properties').select(PROPERTY_SELECT).eq('id', id);
    const result = typeof query.maybeSingle === 'function'
      ? await query.maybeSingle()
      : await query.single();
    if (result.error) throwOperationError('Loading property', result.error);
    return result.data ? normalizeProperty(result.data, toPublicImageUrl) : null;
  }

  async function save(input, propertyId) {
    const payload = inputToPayload(input);
    const query = propertyId
      ? client.from('properties').update(payload).eq('id', propertyId)
      : client.from('properties').insert(payload);
    const { data, error } = await query.select(PROPERTY_SELECT).single();
    if (error || !data) throwOperationError(propertyId ? 'Updating property' : 'Creating property', error);
    return normalizeProperty(data, toPublicImageUrl);
  }

  async function setStatus(id, status) {
    const { error } = await client.from('properties').update({ status }).eq('id', id);
    if (error) throwOperationError('Updating property status', error);
  }

  async function remove(id) {
    const { data: images, error: imageQueryError } = await client
      .from('property_images')
      .select('storage_path')
      .eq('property_id', id);
    if (imageQueryError) throwOperationError('Loading property images', imageQueryError);

    const { error } = await client.from('properties').delete().eq('id', id);
    if (error) throwOperationError('Deleting property', error);

    const storagePaths = (images ?? []).map((image) => image.storage_path).filter(Boolean);
    if (storagePaths.length === 0) return;

    const storage = client.storage?.from('property-images');
    if (!storage || typeof storage.remove !== 'function') {
      throwStorageCleanupError(
        'Deleting property storage',
        storagePaths.map((path) => ({ path, error: new Error('storage cleanup unavailable') })),
      );
    }
    const failedPaths = await cleanupStorageObjects(storage, storagePaths);
    if (failedPaths.length > 0) throwStorageCleanupError('Deleting property storage', failedPaths);
  }

  async function uploadImage(propertyId, file, sortOrder) {
    if (!file) throw new Error('Image upload requires a file');
    const storagePath = `properties/${propertyId}/${randomId()}-${safeFileName(file)}`;
    const storage = client.storage?.from('property-images');
    if (!storage) throw new Error('Image storage is unavailable');

    const uploadResult = await storage.upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
    if (uploadResult.error) throwOperationError('Uploading property image', uploadResult.error);

    const { data, error } = await client.from('property_images').insert({
      property_id: propertyId,
      storage_path: storagePath,
      sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      alt_text: file.name ?? null,
    }).select().single();
    if (error || !data) {
      await storage.remove([storagePath]);
      throwOperationError('Saving property image', error);
    }

    return { ...data, publicUrl: await toPublicImageUrl(storagePath) };
  }

  async function removeImage(image) {
    const storagePath = image?.storage_path;
    if (!storagePath) throw new Error('Image path is required');

    const { error } = await client.from('property_images').delete().eq('id', image.id);
    if (error) throwOperationError('Deleting property image record', error);

    const storage = client.storage?.from('property-images');
    if (!storage || typeof storage.remove !== 'function') {
      throwStorageCleanupError(
        'Deleting property image storage',
        [{ path: storagePath, error: new Error('storage cleanup unavailable') }],
      );
    }
    const failedPaths = await cleanupStorageObjects(storage, [storagePath]);
    if (failedPaths.length > 0) throwStorageCleanupError('Deleting property image storage', failedPaths);
  }

  return {
    listPublished,
    listAdmin,
    getById,
    save,
    setStatus,
    remove,
    removeProperty: remove,
    uploadImage,
    removeImage,
  };
}
