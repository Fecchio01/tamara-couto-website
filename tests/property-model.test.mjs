import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  normalizePropertyRow,
  toLegacyProperty,
  validatePropertyInput,
  parsePriceToCents,
} from '../admin/property-model.mjs';
import { createPropertySource } from '../property-source.js';
import { createPropertyRepository, inputToPayload } from '../property-repository.js';

test('normalizes a database property and its ordered images', () => {
  const property = normalizePropertyRow(
    { id: 'p-1', legacy_id: '665313', title: 'Casa', type: 'Casa', price_cents: 25000000, status: 'published', features: ['Quartos: 3'] },
    [
      { storage_path: 'properties/p-1/02.jpg', sort_order: 2 },
      { storage_path: 'properties/p-1/01.jpg', sort_order: 1 },
    ],
  );
  assert.equal(property.price, 'R$ 250.000,00');
  assert.deepEqual(property.images, ['properties/p-1/01.jpg', 'properties/p-1/02.jpg']);
});

test('maps normalized data back to the public legacy shape', () => {
  const legacy = toLegacyProperty({ id: 'p-1', legacy_id: '665313', title: 'Casa', type: 'Casa', location: 'Campo Grande - MS', neighborhood: 'Centro', price_cents: 25000000, features: [], description: '', images: [], status: 'published' });
  assert.equal(legacy.id, '665313');
  assert.equal(legacy.price, 'R$ 250.000,00');
});

test('rejects an unpublished property without a title or category', () => {
  const result = validatePropertyInput({ title: '', type: '', status: 'draft' });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['title', 'type']);
});

test('parses Brazilian price input into integer centavos', () => {
  assert.equal(parsePriceToCents('R$ 1.250.000,50'), 125000050);
});

test('falls back to static properties when Supabase configuration is blank', async () => {
  const fallback = [{ id: 'static-1', title: 'Static property' }];
  const source = createPropertySource({
    config: { url: '', publishableKey: '' },
    client: { from() { throw new Error('must not query without configuration'); } },
    fallback,
  });

  assert.deepEqual(await source.loadPublicProperties(), fallback);
});

test('falls back to static properties when the public query rejects', async () => {
  const fallback = [{ id: 'static-2', title: 'Static property' }];
  const source = createPropertySource({
    config: { url: 'https://example.supabase.co', publishableKey: 'publishable-key' },
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              order() {
                return Promise.reject(new Error('network unavailable'));
              },
            };
          },
        };
      },
    },
    fallback,
  });

  assert.deepEqual(await source.loadPublicProperties(), fallback);
});

test('keeps the static gallery while migrated remote properties have no images yet', async () => {
  const fallback = [{
    id: '665313',
    title: 'Apartamento local',
    images: ['assets/imoveis/imovel-0/foto-0.jpg'],
  }];
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      return Promise.resolve({
        data: [{
          id: 'remote-665313',
          legacy_id: '665313',
          title: 'Apartamento remoto atualizado',
          type: 'Apartamento',
          price_cents: 20000000,
          status: 'published',
          property_images: [],
        }],
        error: null,
      });
    },
  };
  const source = createPropertySource({
    config: { url: 'https://example.supabase.co', publishableKey: 'publishable-key' },
    client: { from() { return query; } },
    fallback,
  });

  const [property] = await source.loadPublicProperties();
  assert.equal(property.title, 'Apartamento remoto atualizado');
  assert.deepEqual(property.images, ['assets/imoveis/imovel-0/foto-0.jpg']);
});

test('repository maps published rows and storage paths to the public property shape', async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      return Promise.resolve({
        data: [{
          id: 'p-2',
          legacy_id: '665313',
          title: 'Casa publicada',
          type: 'Casa',
          price_cents: 25000000,
          status: 'published',
          features: ['Quartos: 3'],
          property_images: [
            { id: 'image-2', storage_path: 'properties/p-2/02.jpg', sort_order: 2 },
            { id: 'image-1', storage_path: 'properties/p-2/01.jpg', sort_order: 1 },
          ],
        }],
        error: null,
      });
    },
  };
  const repository = createPropertyRepository({
    client: { from() { return query; } },
    publicImageUrl: (path) => `https://cdn.example/${path}`,
  });

  assert.deepEqual(await repository.listPublished(), [{
    id: '665313',
    title: 'Casa publicada',
    type: 'Casa',
    location: '',
    neighborhood: '',
    price: 'R$ 250.000,00',
    features: ['Quartos: 3'],
    description: '',
    images: [
      'https://cdn.example/properties/p-2/01.jpg',
      'https://cdn.example/properties/p-2/02.jpg',
    ],
    proximidades: [],
  }]);
});

test('maps optional inventory fields from database rows to the legacy shape', () => {
  const property = normalizePropertyRow({
    id: 'p-optional',
    title: 'Galpão',
    type: 'Imóvel Comercial',
    price_cents: 1800000,
    is_new: true,
    purpose: 'Aluguel',
    source_url: 'https://example.test/source',
    proximidades: ['Mercado'],
  });

  assert.equal(property.isNew, true);
  assert.equal(property.purpose, 'Aluguel');
  assert.equal(property.sourceUrl, 'https://example.test/source');
  assert.deepEqual(toLegacyProperty(property), {
    id: 'p-optional',
    title: 'Galpão',
    type: 'Imóvel Comercial',
    location: '',
    neighborhood: '',
    price: 'R$ 18.000,00',
    features: [],
    description: '',
    images: [],
    proximidades: ['Mercado'],
    isNew: true,
    purpose: 'Aluguel',
    sourceUrl: 'https://example.test/source',
  });
});

test('uses signed URLs for private property images', async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      return Promise.resolve({
        data: [{
          id: 'p-private',
          title: 'Casa privada',
          type: 'Casa',
          price_cents: 100,
          status: 'published',
          property_images: [{ storage_path: 'properties/p-private/home.jpg', sort_order: 0 }],
        }],
        error: null,
      });
    },
  };
  const repository = createPropertyRepository({
    client: {
      from() { return query; },
      storage: {
        from() {
          return {
            createSignedUrl: async (path, expiresIn) => ({
              data: { signedUrl: `signed:${path}:${expiresIn}` },
              error: null,
            }),
          };
        },
      },
    },
  });

  const [property] = await repository.listPublished();
  assert.equal(property.images[0], 'signed:properties/p-private/home.jpg:3600');
});

test('returns fallback without querying for malformed configuration', async () => {
  let queryCount = 0;
  const fallback = [{ id: 'malformed-config-fallback' }];
  const source = createPropertySource({
    config: { url: 'not a URL', publishableKey: 'key' },
    client: { from() { queryCount += 1; return {}; } },
    fallback,
  });

  assert.deepEqual(await source.loadPublicProperties(), fallback);
  assert.equal(queryCount, 0);
});

test('uses the browser global static array when no fallback argument is provided', async () => {
  const fallback = [{ id: 'browser-global-fallback' }];
  const previousWindow = globalThis.window;
  globalThis.window = { IMOVEIS_DATA: fallback };
  try {
    const source = createPropertySource({ config: {} });
    assert.deepEqual(await source.loadPublicProperties(), fallback);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('exposes the static inventory on window for browser consumers', () => {
  const dataScript = fs.readFileSync(new URL('../imoveis-data.js', import.meta.url), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(dataScript, sandbox);
  assert.ok(Array.isArray(sandbox.window.IMOVEIS_DATA));
});

test('initializes public handlers before a pending remote request resolves', async () => {
  let domReady;
  const listeners = {};
  const element = {
    addEventListener() {},
    replaceChildren() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return '0'; },
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
  };
  const document = {
    addEventListener(name, handler) {
      listeners[name] = handler;
      if (name === 'DOMContentLoaded') domReady = handler;
    },
    querySelector(selector) {
      return selector === '.properties-grid' ? {
        ...element,
        insertAdjacentHTML() {},
        innerHTML: '',
      } : element;
    },
    querySelectorAll() { return []; },
    getElementById() { return element; },
    dispatchEvent() {},
  };
  let resolveRemote;
  const remoteRequest = new Promise((resolve) => { resolveRemote = resolve; });
  const sandbox = {
    document,
    window: { loadPublicProperties: () => remoteRequest },
    IMOVEIS_DATA: [{ id: 'first-paint', title: 'Casa', type: 'Casa', price: 'R$ 1', images: ['one.jpg'], features: [] }],
    Event,
    navigator: {},
    setTimeout,
    encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../imoveis-ui.js', import.meta.url), 'utf8'), sandbox);

  const run = domReady();
  await Promise.resolve();
  assert.equal(typeof sandbox.window.shareImovel, 'function');
  resolveRemote(sandbox.IMOVEIS_DATA);
  await run;
});

test('removes property storage objects before deleting the property', async () => {
  const calls = [];
  const imageQuery = {
    select() { return this; },
    eq() {
      return Promise.resolve({
        data: [{ storage_path: 'properties/p-remove/a.jpg' }, { storage_path: 'properties/p-remove/b.jpg' }],
        error: null,
      });
    },
  };
  const propertyQuery = {
    delete() { calls.push('property-delete'); return this; },
    eq() { return Promise.resolve({ data: [], error: null }); },
  };
  const storage = {
    remove(paths) {
      calls.push(['storage-remove', paths]);
      return Promise.resolve({ data: paths, error: null });
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        if (table === 'property_images') return imageQuery;
        if (table === 'properties') return propertyQuery;
        throw new Error(`unexpected table ${table}`);
      },
      storage: { from() { return storage; } },
    },
  });

  await repository.remove('p-remove');
  assert.deepEqual(calls, [
    'property-delete',
    ['storage-remove', ['properties/p-remove/a.jpg', 'properties/p-remove/b.jpg']],
  ]);
});

test('does not remove storage objects when property deletion fails', async () => {
  const calls = [];
  const imageQuery = {
    select() { return this; },
    eq() {
      return Promise.resolve({
        data: [{ storage_path: 'properties/p-fail/a.jpg' }],
        error: null,
      });
    },
  };
  const propertyQuery = {
    delete() { calls.push('property-delete'); return this; },
    eq() {
      return Promise.resolve({
        data: null,
        error: { code: '23503', message: 'property delete rejected' },
      });
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        if (table === 'property_images') return imageQuery;
        if (table === 'properties') return propertyQuery;
        throw new Error(`unexpected table ${table}`);
      },
      storage: {
        from() {
          return {
            remove() {
              calls.push('storage-remove');
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      },
    },
  });

  await assert.rejects(repository.remove('p-fail'), /Deleting property failed: 23503: property delete rejected/);
  assert.deepEqual(calls, ['property-delete']);
});

test('reports incomplete storage cleanup after property deletion', async () => {
  const imageQuery = {
    select() { return this; },
    eq() {
      return Promise.resolve({
        data: [{ storage_path: 'properties/p-cleanup/a.jpg' }],
        error: null,
      });
    },
  };
  const propertyQuery = {
    delete() { return this; },
    eq() { return Promise.resolve({ data: [], error: null }); },
  };
  const storage = {
    remove() {
      return Promise.resolve({
        data: null,
        error: { code: 'STORAGE403', message: 'cleanup denied' },
      });
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        if (table === 'property_images') return imageQuery;
        if (table === 'properties') return propertyQuery;
        throw new Error(`unexpected table ${table}`);
      },
      storage: { from() { return storage; } },
    },
  });

  await assert.rejects(
    repository.remove('p-cleanup'),
    /Deleting property storage failed for 1 object\(s\): properties\/p-cleanup\/a\.jpg: STORAGE403: cleanup denied/,
  );
});

test('retries individual storage cleanup when batch removal throws', async () => {
  const calls = [];
  const imageQuery = {
    select() { return this; },
    eq() {
      return Promise.resolve({
        data: [{ storage_path: 'properties/p-retry/a.jpg' }, { storage_path: 'properties/p-retry/b.jpg' }],
        error: null,
      });
    },
  };
  const propertyQuery = {
    delete() { calls.push('property-delete'); return this; },
    eq() { return Promise.resolve({ data: [], error: null }); },
  };
  let batchAttempt = true;
  const storage = {
    remove(paths) {
      calls.push(['storage-remove', paths]);
      if (batchAttempt) {
        batchAttempt = false;
        return Promise.reject(new Error('batch unavailable'));
      }
      return Promise.resolve({ data: paths, error: null });
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        if (table === 'property_images') return imageQuery;
        if (table === 'properties') return propertyQuery;
        throw new Error(`unexpected table ${table}`);
      },
      storage: { from() { return storage; } },
    },
  });

  await repository.remove('p-retry');
  assert.deepEqual(calls, [
    'property-delete',
    ['storage-remove', ['properties/p-retry/a.jpg', 'properties/p-retry/b.jpg']],
    ['storage-remove', ['properties/p-retry/a.jpg']],
    ['storage-remove', ['properties/p-retry/b.jpg']],
  ]);
});

test('does not remove storage when image metadata deletion fails', async () => {
  const calls = [];
  const imageQuery = {
    delete() { calls.push('sql-delete'); return this; },
    eq() {
      return Promise.resolve({
        data: null,
        error: { code: '23503', message: 'metadata delete rejected' },
      });
    },
  };
  const storage = {
    remove() {
      calls.push('storage-remove');
      return Promise.resolve({ data: null, error: null });
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        if (table === 'property_images') return imageQuery;
        throw new Error(`unexpected table ${table}`);
      },
      storage: { from() { return storage; } },
    },
  });

  await assert.rejects(
    repository.removeImage({ id: 'image-fail', storage_path: 'properties/p-fail/a.jpg' }),
    /Deleting property image record failed: 23503: metadata delete rejected/,
  );
  assert.deepEqual(calls, ['sql-delete']);
});

test('reports a safe pending path when image storage cleanup remains incomplete', async () => {
  const calls = [];
  const imageQuery = {
    delete() { calls.push('sql-delete'); return this; },
    eq() { return Promise.resolve({ data: [], error: null }); },
  };
  const storage = {
    remove(paths) {
      calls.push(['storage-remove', paths]);
      return Promise.reject(Object.assign(new Error('storage unavailable'), { code: 'STORAGE503' }));
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        if (table === 'property_images') return imageQuery;
        throw new Error(`unexpected table ${table}`);
      },
      storage: { from() { return storage; } },
    },
  });

  await assert.rejects(
    repository.removeImage({ id: 'image-storage-fail', storage_path: 'properties/p-image/a.jpg' }),
    /Deleting property image storage failed for 1 object\(s\): properties\/p-image\/a\.jpg: STORAGE503: storage unavailable/,
  );
  assert.deepEqual(calls, [
    'sql-delete',
    ['storage-remove', ['properties/p-image/a.jpg']],
    ['storage-remove', ['properties/p-image/a.jpg']],
  ]);
});

test('preserves safe provider error code and message', async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'No rows found' } });
    },
  };
  const repository = createPropertyRepository({ client: { from() { return query; } } });

  await assert.rejects(repository.listPublished(), /Loading published properties failed: PGRST116: No rows found/);
});

test('redacts service role secrets from provider error details', async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      return Promise.resolve({
        data: null,
        error: { message: 'service_role=do-not-leak-this-value' },
      });
    },
  };
  const repository = createPropertyRepository({ client: { from() { return query; } } });

  await assert.rejects(
    repository.listPublished(),
    (error) => {
      assert.match(error.message, /Loading published properties failed/);
      assert.doesNotMatch(error.message, /do-not-leak-this-value/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
});

test('redacts service-role environment variable secrets from provider error details', async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      return Promise.resolve({
        data: null,
        error: { message: 'SUPABASE_SERVICE_ROLE_KEY=do-not-leak-env-value' },
      });
    },
  };
  const repository = createPropertyRepository({ client: { from() { return query; } } });

  await assert.rejects(
    repository.listPublished(),
    (error) => {
      assert.doesNotMatch(error.message, /do-not-leak-env-value/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
});

test('reorders property images through repository metadata updates', async () => {
  const calls = [];
  const imageQuery = {
    update(payload) {
      const chain = {
        eq(column, value) {
          calls.push({ payload, column, value });
          return column === 'id'
            ? { eq: chain.eq.bind(chain) }
            : Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
  const repository = createPropertyRepository({
    client: {
      from(table) {
        assert.equal(table, 'property_images');
        return imageQuery;
      },
    },
  });

  await repository.reorderImages('property-1', [
    { id: 'image-b', storage_path: 'properties/property-1/b.jpg' },
    { id: 'image-a', storage_path: 'properties/property-1/a.jpg' },
  ]);

  assert.deepEqual(calls, [
    { payload: { sort_order: 0 }, column: 'id', value: 'image-b' },
    { payload: { sort_order: 0 }, column: 'property_id', value: 'property-1' },
    { payload: { sort_order: 1 }, column: 'id', value: 'image-a' },
    { payload: { sort_order: 1 }, column: 'property_id', value: 'property-1' },
  ]);
});

test('normalizes blank optional form values to database nulls', () => {
  assert.deepEqual(inputToPayload({
    title: 'Casa segura',
    type: 'Casa',
    legacy_id: '   ',
    location: ' ',
    neighborhood: '',
    latitude: '',
    longitude: '  ',
    mapUrl: '',
    purpose: '',
    sourceUrl: ' ',
    description: '',
    features: [],
    proximidades: [],
    status: 'draft',
  }), {
    legacy_id: null,
    title: 'Casa segura',
    type: 'Casa',
    location: null,
    neighborhood: null,
    price_cents: 0,
    features: [],
    is_new: null,
    purpose: null,
    source_url: null,
    proximidades: [],
    description: '',
    latitude: null,
    longitude: null,
    map_url: null,
    status: 'draft',
  });
});

test('repository CRUD sends normalized optional values to Supabase', async () => {
  let capturedPayload;
  const query = {
    insert(payload) {
      capturedPayload = payload;
      return {
        select() {
          return {
            single: async () => ({
              data: { id: 'property-optional', ...payload, property_images: [] },
              error: null,
            }),
          };
        },
      };
    },
  };
  const repository = createPropertyRepository({
    client: { from(table) { assert.equal(table, 'properties'); return query; } },
    publicImageUrl: (path) => path,
  });

  await repository.save({ title: 'Casa segura', type: 'Casa', legacy_id: '', latitude: '', longitude: '', mapUrl: '', sourceUrl: '' });

  assert.equal(capturedPayload.legacy_id, null);
  assert.equal(capturedPayload.latitude, null);
  assert.equal(capturedPayload.longitude, null);
  assert.equal(capturedPayload.map_url, null);
  assert.equal(capturedPayload.source_url, null);
});
