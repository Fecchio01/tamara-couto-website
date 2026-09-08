import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  nullIfBlank,
  parseOptionalNumber,
  parsePriceToCents,
} from '../admin/property-model.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_DATA_FILE = path.join(REPOSITORY_ROOT, 'imoveis-data.js');
const IMAGE_BUCKET = 'property-images';

function asArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function readOptionalProperty(property, ...names) {
  for (const name of names) {
    if (property?.[name] !== undefined) return property[name];
  }
  return undefined;
}

/** Load the legacy browser data file without importing browser globals. */
export function loadStaticProperties(filePath = DEFAULT_DATA_FILE) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { window: {}, console };
  const properties = vm.runInNewContext(`${source}\nIMOVEIS_DATA`, sandbox, {
    filename: filePath,
  });

  if (!Array.isArray(properties)) {
    throw new Error(`Static property data must be an array: ${filePath}`);
  }
  return properties;
}

/** Convert one legacy row into the properties table payload. */
export function buildPropertyUpsert(property = {}) {
  const legacyId = readOptionalProperty(property, 'legacy_id', 'legacyId', 'id');
  if (legacyId === undefined || legacyId === null || String(legacyId).trim() === '') {
    throw new Error('Static property is missing its legacy id');
  }

  const price = property.price_cents === undefined
    ? parsePriceToCents(property.price)
    : Number(property.price_cents);
  const status = ['draft', 'published', 'archived'].includes(property.status)
    ? property.status
    : 'published';

  return {
    legacy_id: String(legacyId).trim(),
    title: String(property.title ?? '').trim(),
    type: String(property.type ?? '').trim(),
    location: nullIfBlank(property.location),
    neighborhood: nullIfBlank(property.neighborhood),
    price_cents: Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0,
    features: asArray(property.features),
    is_new: property.is_new ?? property.isNew ?? null,
    purpose: nullIfBlank(property.purpose),
    source_url: nullIfBlank(readOptionalProperty(property, 'source_url', 'sourceUrl')),
    proximidades: asArray(property.proximidades),
    description: String(property.description ?? ''),
    latitude: parseOptionalNumber(property.latitude),
    longitude: parseOptionalNumber(property.longitude),
    map_url: nullIfBlank(readOptionalProperty(property, 'map_url', 'mapUrl')),
    status,
  };
}

function safePathSegment(value, fallback) {
  const segment = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-');
  return segment || fallback;
}

function rejectReservedPathSegments(value, label) {
  const segments = String(value).replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${label} contains reserved path segment`);
  }
}

function safeFileName(value, fallback) {
  const baseName = path.posix.basename(String(value ?? '').replaceAll('\\', '/'));
  return safePathSegment(baseName, fallback).toLowerCase();
}

/** Build stable local-file to storage mappings for one property's gallery. */
export function buildImageUploadPlan(property = {}, repositoryRoot = REPOSITORY_ROOT) {
  const legacyId = readOptionalProperty(property, 'legacy_id', 'legacyId', 'id');
  if (legacyId === undefined || legacyId === null || String(legacyId).trim() === '') {
    throw new Error('Static property is missing its legacy id');
  }
  rejectReservedPathSegments(legacyId, 'Legacy id');

  const root = path.resolve(repositoryRoot);
  const idSegment = safePathSegment(legacyId, 'property');
  return asArray(property.images).map((image, sortOrder) => {
    const relativePath = String(image ?? '').trim();
    if (!relativePath) throw new Error(`Property ${legacyId} has an empty image path`);
    rejectReservedPathSegments(relativePath, 'Image path');

    const sourcePath = path.resolve(root, relativePath);
    const relativeSourcePath = path.relative(root, sourcePath);
    if (
      relativeSourcePath === '..'
      || relativeSourcePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeSourcePath)
    ) {
      throw new Error(`Image path escapes repository root: ${relativePath}`);
    }

    const altText = path.posix.basename(relativePath.replaceAll('\\', '/'));
    return {
      sourcePath,
      storagePath: `properties/${idSegment}/${String(sortOrder).padStart(3, '0')}-${safeFileName(relativePath, `image-${sortOrder}`)}`,
      sortOrder,
      altText,
    };
  });
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    property: null,
    replaceImages: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--replace-images') {
      options.replaceImages = true;
    } else if (argument === '--property') {
      options.property = argv[index + 1];
      index += 1;
      if (!options.property) throw new Error('--property requires a legacy id');
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

export function filterProperties(properties, legacyId) {
  if (!legacyId) return properties;
  return properties.filter((property) => String(property.legacy_id ?? property.id) === String(legacyId));
}

function buildDryRunRecord(property, repositoryRoot) {
  const payload = buildPropertyUpsert(property);
  const images = buildImageUploadPlan(property, repositoryRoot);
  return {
    legacy_id: payload.legacy_id,
    title: payload.title,
    type: payload.type,
    status: payload.status,
    price_cents: payload.price_cents,
    image_count: images.length,
    storage_paths: images.map((image) => image.storagePath),
  };
}

export function printDryRun(properties, { repositoryRoot = REPOSITORY_ROOT, output = console.log } = {}) {
  const records = properties.map((property) => buildDryRunRecord(property, repositoryRoot));
  output(`Dry-run: ${records.length} properties planned`);
  records.slice(0, 3).forEach((record, index) => {
    output(`Plan ${index + 1}: ${JSON.stringify(record)}`);
  });
  return records;
}

function encodePath(pathValue) {
  return String(pathValue).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[extension] ?? 'application/octet-stream';
}

function preflightImagePlans(plans) {
  return plans.map((plan) => {
    const contentType = mimeTypeFor(plan.sourcePath);
    if (contentType === 'application/octet-stream') {
      const error = new Error(`Unsupported image MIME type: ${plan.sourcePath}`);
      error.code = 'UNSUPPORTED_IMAGE_MIME';
      throw error;
    }

    const stats = fs.statSync(plan.sourcePath);
    if (!stats.isFile()) {
      const error = new Error(`Image path is not a file: ${plan.sourcePath}`);
      error.code = 'INVALID_IMAGE_FILE';
      throw error;
    }

    const contents = fs.readFileSync(plan.sourcePath);
    if (contents.length === 0) {
      const error = new Error(`Image file is empty: ${plan.sourcePath}`);
      error.code = 'EMPTY_IMAGE_FILE';
      throw error;
    }

    return { ...plan, contents, contentType };
  });
}

export function preflightProperties(properties, repositoryRoot = REPOSITORY_ROOT) {
  return properties.map((property) => ({
    property,
    payload: buildPropertyUpsert(property),
    plans: preflightImagePlans(buildImageUploadPlan(property, repositoryRoot)),
  }));
}

function createSupabaseRestClient({ url, serviceRoleKey, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('Node fetch is unavailable');
  const baseUrl = url.replace(/\/$/, '');
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  async function request(endpoint, init = {}) {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        ...baseHeaders,
        ...(init.body && !(init.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase request failed (${response.status})`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    async upsertProperty(payload) {
      const rows = await request('/rest/v1/properties?on_conflict=legacy_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([payload]),
      });
      if (!Array.isArray(rows) || !rows[0]?.id) throw new Error('Supabase property upsert returned no id');
      return rows[0];
    },
    async listImages(propertyId) {
      return request(`/rest/v1/property_images?property_id=eq.${encodeURIComponent(propertyId)}&select=id,storage_path`);
    },
    async deleteImageRecord(imageId) {
      await request(`/rest/v1/property_images?id=eq.${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    },
    async deleteObject(storagePath) {
      await request(`/storage/v1/object/${IMAGE_BUCKET}/${encodePath(storagePath)}`, {
        method: 'DELETE',
      });
    },
    async uploadObject(storagePath, contents, contentType, replaceImages) {
      await request(`/storage/v1/object/${IMAGE_BUCKET}/${encodePath(storagePath)}`, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'x-upsert': replaceImages ? 'true' : 'false',
        },
        body: contents,
      });
    },
    async upsertImage(image) {
      const rows = await request('/rest/v1/property_images?on_conflict=storage_path', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([image]),
      });
      if (!Array.isArray(rows) || !rows[0]) throw new Error('Supabase image upsert returned no row');
      return rows[0];
    },
  };
}

export async function importProperties(properties, {
  repositoryRoot = REPOSITORY_ROOT,
  url,
  serviceRoleKey,
  replaceImages = false,
  fetchImpl,
  output = console.log,
} = {}) {
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for import');
  const preparedProperties = preflightProperties(properties, repositoryRoot);
  const client = createSupabaseRestClient({ url, serviceRoleKey, fetchImpl });
  let imageCount = 0;

  for (const { property, payload, plans } of preparedProperties) {
    const row = await client.upsertProperty(payload);
    const existingImages = await client.listImages(row.id);
    const existingPaths = new Set((existingImages ?? []).map((image) => image.storage_path));
    if (replaceImages) {
      const plannedPaths = new Set(plans.map((plan) => plan.storagePath));
      for (const image of existingImages ?? []) {
        if (plannedPaths.has(image.storage_path)) continue;
        await client.deleteImageRecord(image.id);
        await client.deleteObject(image.storage_path);
      }
    }

    for (const plan of plans) {
      if (!replaceImages && existingPaths.has(plan.storagePath)) continue;
      await client.uploadObject(plan.storagePath, plan.contents, plan.contentType, replaceImages);
      await client.upsertImage({
        property_id: row.id,
        storage_path: plan.storagePath,
        sort_order: plan.sortOrder,
        alt_text: plan.altText,
      });
      imageCount += 1;
    }
    output(`Imported ${row.legacy_id ?? property.id} (${plans.length} images planned)`);
  }

  return { propertyCount: properties.length, imageCount };
}

function printUsage(output = console.log) {
  output('Usage: node scripts/import-static-properties.mjs [--dry-run] [--property <legacy_id>] [--replace-images]');
  output('Dry-run is side-effect free and does not require Supabase credentials.');
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const properties = filterProperties(loadStaticProperties(), options.property);
  if (options.dryRun) {
    printDryRun(properties);
    return;
  }

  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local environment, or use --dry-run');
  }

  const result = await importProperties(properties, {
    repositoryRoot: REPOSITORY_ROOT,
    url,
    serviceRoleKey,
    replaceImages: options.replaceImages,
  });
  console.log(`Import complete: ${result.propertyCount} properties, ${result.imageCount} images`);
}

if (pathToFileURL(path.resolve(process.argv[1] ?? '')).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
