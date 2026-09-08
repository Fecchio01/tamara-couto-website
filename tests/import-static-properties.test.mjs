import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadStaticProperties,
  buildPropertyUpsert,
  buildImageUploadPlan,
} from '../scripts/import-static-properties.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('importer loads the current static inventory with legacy ids', () => {
  const properties = loadStaticProperties(path.join(repositoryRoot, 'imoveis-data.js'));

  assert.equal(properties.length, 10);
  assert.equal(properties[0].id, '665313');
  assert.equal(properties[0].title, 'Apartamento - condomínio Rossi - Três Barras I');
});

test('importer preserves legacy id, Brazilian price, and every feature string', () => {
  const property = {
    id: 'legacy-1250',
    title: 'Casa de teste',
    type: 'Casa',
    location: 'Campo Grande - MS',
    neighborhood: 'Centro',
    price: 'R$ 1.250.000,50',
    features: ['Quartos: 3', 'Piscina', 'Aceita financiamento'],
    description: 'Descrição completa',
    proximidades: ['Escola'],
    isNew: true,
    purpose: 'venda',
    sourceUrl: 'https://example.test/imovel/legacy-1250',
  };

  assert.deepEqual(buildPropertyUpsert(property), {
    legacy_id: 'legacy-1250',
    title: 'Casa de teste',
    type: 'Casa',
    location: 'Campo Grande - MS',
    neighborhood: 'Centro',
    price_cents: 125000050,
    features: ['Quartos: 3', 'Piscina', 'Aceita financiamento'],
    is_new: true,
    purpose: 'venda',
    source_url: 'https://example.test/imovel/legacy-1250',
    proximidades: ['Escola'],
    description: 'Descrição completa',
    latitude: null,
    longitude: null,
    map_url: null,
    status: 'published',
  });
});

test('importer builds deterministic image paths from repository-relative files', () => {
  const property = {
    id: '665313',
    images: [
      'assets/imoveis/imovel-0/foto-0.jpg',
      'assets/imoveis/imovel-0/foto-1.jpg',
    ],
  };

  const firstPlan = buildImageUploadPlan(property, repositoryRoot);
  const secondPlan = buildImageUploadPlan(property, repositoryRoot);

  assert.deepEqual(firstPlan, secondPlan);
  assert.deepEqual(firstPlan, [
    {
      sourcePath: path.join(repositoryRoot, 'assets/imoveis/imovel-0/foto-0.jpg'),
      storagePath: 'properties/665313/000-foto-0.jpg',
      sortOrder: 0,
      altText: 'foto-0.jpg',
    },
    {
      sourcePath: path.join(repositoryRoot, 'assets/imoveis/imovel-0/foto-1.jpg'),
      storagePath: 'properties/665313/001-foto-1.jpg',
      sortOrder: 1,
      altText: 'foto-1.jpg',
    },
  ]);
  assert.equal(fs.existsSync(firstPlan[0].sourcePath), true);
});

test('importer dry-run reports the inventory without requiring Supabase credentials', async () => {
  const { spawn } = await import('node:child_process');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/import-static-properties.mjs', '--dry-run'], {
      cwd: repositoryRoot,
      env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`dry-run exited with ${code}: ${stderr}`)));
  });

  assert.match(output.stdout, /Dry-run: 10 properties planned/);
  assert.match(output.stdout, /665313/);
  assert.doesNotMatch(output.stdout, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});
