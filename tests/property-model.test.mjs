import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePropertyRow,
  toLegacyProperty,
  validatePropertyInput,
  parsePriceToCents,
} from '../admin/property-model.mjs';

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
