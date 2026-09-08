const REQUIRED_PROPERTY_FIELDS = ['title', 'type'];

export function parsePriceToCents(value) {
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }

  const input = String(value ?? '')
    .trim()
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.');

  if (!input) return 0;

  const parsed = Number(input.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function formatCentsAsPrice(cents) {
  const amount = Number(cents ?? 0) / 100;
  return `R$ ${amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function normalizePropertyRow(row, imageRows = []) {
  const orderedImages = [...(imageRows ?? [])]
    .sort((left, right) => Number(left.sort_order) - Number(right.sort_order))
    .map((image) => image.storage_path);

  const property = {
    ...row,
    features: row.features ?? [],
    description: row.description ?? '',
    proximidades: row.proximidades ?? [],
    price: formatCentsAsPrice(row.price_cents),
    images: orderedImages,
  };

  for (const [legacyField, databaseField] of [
    ['isNew', 'is_new'],
    ['sourceUrl', 'source_url'],
  ]) {
    const value = row[databaseField] ?? row[legacyField];
    if (value !== undefined) property[legacyField] = value;
  }
  if (row.purpose !== undefined) property.purpose = row.purpose;

  return property;
}

export function toLegacyProperty(property) {
  const legacyProperty = {
    id: property.legacy_id ?? property.id,
    title: property.title ?? '',
    type: property.type ?? '',
    location: property.location ?? '',
    neighborhood: property.neighborhood ?? '',
    price: property.price ?? formatCentsAsPrice(property.price_cents),
    features: property.features ?? [],
    description: property.description ?? '',
    images: property.images ?? [],
    proximidades: property.proximidades ?? [],
  };

  for (const [legacyField, databaseField] of [
    ['isNew', 'is_new'],
    ['purpose', 'purpose'],
    ['sourceUrl', 'source_url'],
  ]) {
    const value = property[legacyField] ?? property[databaseField];
    if (value !== undefined) legacyProperty[legacyField] = value;
  }

  return legacyProperty;
}

export function validatePropertyInput(input) {
  const errors = REQUIRED_PROPERTY_FIELDS.filter((field) => {
    const value = input?.[field];
    return value === undefined || value === null || String(value).trim() === '';
  });

  return { valid: errors.length === 0, errors };
}
