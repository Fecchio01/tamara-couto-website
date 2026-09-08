import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePropertyRow,
  toLegacyProperty,
  validatePropertyInput,
  parsePriceToCents,
} from '../admin/property-model.mjs';
import { createPropertySource } from '../property-source.js';
import { createPropertyRepository } from '../property-repository.js';

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
