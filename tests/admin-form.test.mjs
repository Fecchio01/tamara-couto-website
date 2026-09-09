import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fillPropertyForm,
  readPropertyForm,
  renderPropertyList,
  updateEditorActions,
} from '../admin.js';

function createForm(values = {}) {
  const fields = new Map(Object.entries(values).map(([name, value]) => [name, {
    name,
    value: typeof value === 'object' ? value.value ?? '' : value,
    checked: typeof value === 'object' ? Boolean(value.checked) : false,
  }]));

  return {
    elements: {
      namedItem(name) {
        return fields.get(name) ?? null;
      },
    },
    querySelector(selector) {
      const match = /^\[name="([^"]+)"\]$/.exec(selector);
      return match ? fields.get(match[1]) ?? null : null;
    },
    field(name) {
      return fields.get(name);
    },
  };
}

function createRenderRoot() {
  const createElement = (tagName) => ({
    tagName,
    children: [],
    dataset: {},
    append(...children) {
      this.children.push(...children);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  });
  const list = {
    children: [],
    replaceChildren() {
      this.children = [];
    },
    append(...children) {
      this.children.push(...children);
    },
  };
  return {
    list,
    getElementById(id) {
      return id === 'propertyList' ? list : null;
    },
    createElement,
  };
}

test('reads the property form and reuses shared Brazilian price parsing', () => {
  const form = createForm({
    title: ' Casa do Lago ',
    type: 'Casa',
    neighborhood: 'Centro',
    location: 'Campo Grande - MS',
    price: 'R$ 1.250.000,50',
    description: 'Descrição',
    features: 'Quartos: 3\nPiscina',
    latitude: '-20.45',
    longitude: '-54.61',
    mapUrl: 'https://maps.example/casa',
    legacy_id: '665313',
    isNew: { checked: true },
    purpose: 'Venda',
    sourceUrl: 'https://example.test/listing',
    proximidades: 'Escola\nMercado',
    status: 'draft',
  });

  assert.deepEqual(readPropertyForm(form), {
    title: 'Casa do Lago',
    type: 'Casa',
    neighborhood: 'Centro',
    location: 'Campo Grande - MS',
    price: 'R$ 1.250.000,50',
    price_cents: 125000050,
    description: 'Descrição',
    features: ['Quartos: 3', 'Piscina'],
    latitude: '-20.45',
    longitude: '-54.61',
    mapUrl: 'https://maps.example/casa',
    legacy_id: '665313',
    isNew: true,
    purpose: 'Venda',
    sourceUrl: 'https://example.test/listing',
    proximidades: ['Escola', 'Mercado'],
    status: 'draft',
  });
});

test('shows the existing site photo in each admin property row', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    IMOVEIS_DATA: [{
      id: '665313',
      images: ['assets/imoveis/imovel-0/foto-0.jpg'],
    }],
  };
  try {
    const root = createRenderRoot();
    renderPropertyList([{
      id: 'remote-665313',
      legacy_id: '665313',
      title: 'Apartamento Rossi',
      type: 'Apartamento',
      price: 'R$ 200.000',
      status: 'published',
      images: [],
    }], root);

    const [row] = root.list.children;
    const image = row.children.flatMap((child) => child.children).find((child) => child.tagName === 'img');
    assert.equal(image.src, 'assets/imoveis/imovel-0/foto-0.jpg');
    assert.equal(image.alt, 'Apartamento Rossi');
  } finally {
    globalThis.window = previousWindow;
  }
});

test('keeps secondary property actions disabled until an existing property is selected', () => {
  const elements = {
    publishPropertyButton: { disabled: false, textContent: '' },
    archivePropertyButton: { disabled: false },
    deletePropertyButton: { disabled: false },
  };

  updateEditorActions(elements, null);
  assert.equal(elements.publishPropertyButton.disabled, true);
  assert.equal(elements.archivePropertyButton.disabled, true);
  assert.equal(elements.deletePropertyButton.disabled, true);

  updateEditorActions(elements, { id: 'property-1', status: 'published' });
  assert.equal(elements.publishPropertyButton.disabled, true);
  assert.equal(elements.archivePropertyButton.disabled, false);
  assert.equal(elements.deletePropertyButton.disabled, false);
});

test('fills required, optional legacy, and image-independent form fields', () => {
  const form = createForm({
    title: '', type: '', neighborhood: '', location: '', price: '', description: '',
    features: '', latitude: '', longitude: '', mapUrl: '', legacy_id: '', isNew: { checked: false },
    purpose: '', sourceUrl: '', proximidades: '', status: 'draft',
  });

  fillPropertyForm(form, {
    title: 'Apartamento Solar',
    type: 'Apartamento',
    neighborhood: 'Jardim dos Estados',
    location: 'Campo Grande - MS',
    price: 'R$ 850.000,00',
    description: 'Pronto para morar',
    features: ['Quartos: 2', 'Varanda'],
    latitude: -20.44,
    longitude: -54.60,
    map_url: 'https://maps.example/solar',
    legacy_id: 'legacy-2',
    is_new: true,
    purpose: 'Aluguel',
    source_url: 'https://example.test/solar',
    proximidades: ['Parque', 'Hospital'],
    status: 'published',
  });

  assert.equal(form.field('title').value, 'Apartamento Solar');
  assert.equal(form.field('type').value, 'Apartamento');
  assert.equal(form.field('price').value, 'R$ 850.000,00');
  assert.equal(form.field('features').value, 'Quartos: 2\nVaranda');
  assert.equal(form.field('latitude').value, '-20.44');
  assert.equal(form.field('mapUrl').value, 'https://maps.example/solar');
  assert.equal(form.field('legacy_id').value, 'legacy-2');
  assert.equal(form.field('isNew').checked, true);
  assert.equal(form.field('purpose').value, 'Aluguel');
  assert.equal(form.field('proximidades').value, 'Parque\nHospital');
  assert.equal(form.field('status').value, 'published');
});

test('allows a draft with no price while published records still require title and category', async () => {
  const { validatePropertyInput } = await import('../admin/property-model.mjs');
  assert.equal(validatePropertyInput({ title: 'Rascunho', type: 'Casa', status: 'draft', price: '' }).valid, true);
  assert.deepEqual(validatePropertyInput({ title: '', type: '', status: 'published' }).errors, ['title', 'type']);
});

test('reads blank optional fields as null without changing draft price behavior', () => {
  const form = createForm({
    title: 'Casa', type: 'Casa', neighborhood: '', location: '', price: '', description: '',
    features: '', latitude: '', longitude: '', mapUrl: '', legacy_id: '', isNew: { checked: false },
    purpose: '', sourceUrl: '', proximidades: '', status: 'draft',
  });
  const input = readPropertyForm(form);

  assert.equal(input.neighborhood, null);
  assert.equal(input.location, null);
  assert.equal(input.latitude, null);
  assert.equal(input.longitude, null);
  assert.equal(input.mapUrl, null);
  assert.equal(input.legacy_id, null);
  assert.equal(input.purpose, null);
  assert.equal(input.sourceUrl, null);
  assert.equal(input.price, '');
  assert.equal(input.price_cents, 0);
});
