import {
  normalizePropertyRow,
  parsePriceToCents,
  toLegacyProperty,
} from './admin/property-model.mjs';

const PROPERTY_SELECT = '*, property_images(*)';

function throwOperationError(operation) {
  throw new Error(`${operation} failed`);
}

function normalizeProperty(row, publicImageUrl) {
  const property = normalizePropertyRow(row, row?.property_images ?? []);
  return {
    ...property,
    images: property.images.map((path) => publicImageUrl(path)),
  };
}

function normalizeLegacyProperty(row, publicImageUrl) {
  return toLegacyProperty(normalizeProperty(row, publicImageUrl));
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

function publicStorageUrl(client, path) {
  const result = client.storage?.from('property-images')?.getPublicUrl(path);
  return result?.data?.publicUrl ?? path;
}

export function createPropertyRepository({ client, publicImageUrl } = {}) {
  if (!client) throw new Error('Property repository requires a client');
  const toPublicImageUrl = publicImageUrl ?? ((path) => publicStorageUrl(client, path));

  async function listPublished() {
    const { data, error } = await client
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('status', 'published')
      .order('updated_at', { ascending: false });
    if (error) throwOperationError('Loading published properties');
    return (data ?? []).map((row) => normalizeLegacyProperty(row, toPublicImageUrl));
  }

  async function listAdmin(filters = {}) {
    let query = client.from('properties').select(PROPERTY_SELECT).order('updated_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.search) query = query.ilike('title', `%${filters.search}%`);

    const { data, error } = await query;
    if (error) throwOperationError('Loading properties');
    return (data ?? []).map((row) => normalizeProperty(row, toPublicImageUrl));
  }

  async function getById(id) {
    const query = client.from('properties').select(PROPERTY_SELECT).eq('id', id);
    const result = typeof query.maybeSingle === 'function'
      ? await query.maybeSingle()
      : await query.single();
    if (result.error) throwOperationError('Loading property');
    return result.data ? normalizeProperty(result.data, toPublicImageUrl) : null;
  }

  async function save(input, propertyId) {
    const payload = inputToPayload(input);
    const query = propertyId
      ? client.from('properties').update(payload).eq('id', propertyId)
      : client.from('properties').insert(payload);
    const { data, error } = await query.select(PROPERTY_SELECT).single();
    if (error || !data) throwOperationError(propertyId ? 'Updating property' : 'Creating property');
    return normalizeProperty(data, toPublicImageUrl);
  }

  async function setStatus(id, status) {
    const { error } = await client.from('properties').update({ status }).eq('id', id);
    if (error) throwOperationError('Updating property status');
  }

  async function remove(id) {
    const { error } = await client.from('properties').delete().eq('id', id);
    if (error) throwOperationError('Deleting property');
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
    if (uploadResult.error) throwOperationError('Uploading property image');

    const { data, error } = await client.from('property_images').insert({
      property_id: propertyId,
      storage_path: storagePath,
      sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      alt_text: file.name ?? null,
    }).select().single();
    if (error || !data) {
      await storage.remove([storagePath]);
      throwOperationError('Saving property image');
    }

    return { ...data, publicUrl: toPublicImageUrl(storagePath) };
  }

  async function removeImage(image) {
    const storage = client.storage?.from('property-images');
    if (!storage) throw new Error('Image storage is unavailable');
    const storagePath = image?.storage_path;
    if (!storagePath) throw new Error('Image path is required');

    const storageResult = await storage.remove([storagePath]);
    if (storageResult.error) throwOperationError('Deleting property image');
    const { error } = await client.from('property_images').delete().eq('id', image.id);
    if (error) throwOperationError('Deleting property image record');
  }

  return {
    listPublished,
    listAdmin,
    getById,
    save,
    setStatus,
    remove,
    uploadImage,
    removeImage,
  };
}
