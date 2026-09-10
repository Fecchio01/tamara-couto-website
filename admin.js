import {
  createSupabaseClient,
  hasSupabaseConfig,
  readSupabaseConfig,
} from './supabase-client.js';
import { createPropertyRepository } from './property-repository.js';
import {
  formatCentsAsPrice,
  nullIfBlank,
  parsePriceToCents,
  validatePropertyInput,
} from './admin/property-model.mjs';

const SAFE_MESSAGES = Object.freeze({
  INVALID_CREDENTIALS: 'Não foi possível entrar. Confira o e-mail e a senha.',
  AUTH_UNAVAILABLE: 'O serviço de autenticação está indisponível no momento.',
  SIGNED_OUT: 'Faça login para acessar o painel.',
  SESSION_CHECK_FAILED: 'Não foi possível verificar a sessão. Tente novamente.',
  MEMBERSHIP_CHECK_FAILED: 'Não foi possível verificar a autorização da conta.',
  NOT_ADMIN: 'Esta conta não tem permissão para acessar o painel.',
  SIGN_OUT_FAILED: 'Não foi possível encerrar a sessão com segurança.',
  LOAD_PROPERTIES_FAILED: 'Não foi possível carregar os imóveis.',
  SAVE_PROPERTY_FAILED: 'Não foi possível salvar o imóvel.',
  STATUS_PROPERTY_FAILED: 'Não foi possível atualizar o status do imóvel.',
  DELETE_PROPERTY_FAILED: 'Não foi possível excluir o imóvel.',
  IMAGE_UPLOAD_FAILED: 'Não foi possível enviar as fotos.',
  IMAGE_DELETE_FAILED: 'Não foi possível excluir a foto.',
  IMAGE_REORDER_FAILED: 'Não foi possível reordenar as fotos.',
});

export const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formField(form, name) {
  if (!form) return null;
  if (form.elements?.namedItem) {
    const named = form.elements.namedItem(name);
    if (named) return named;
  }
  if (typeof form.querySelector === 'function') return form.querySelector(`[name="${name}"]`);
  return form[name] ?? null;
}

function readField(form, ...names) {
  const field = names.map((name) => formField(form, name)).find(Boolean);
  return field?.value ?? '';
}

function readChecked(form, ...names) {
  const field = names.map((name) => formField(form, name)).find(Boolean);
  return Boolean(field?.checked);
}

function splitFormList(value) {
  return String(value ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildMapUrl({ neighborhood, location } = {}) {
  const query = [neighborhood, location]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(', ');
  if (!query) return '';
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
}

export function readPropertyForm(form = globalThis.document?.getElementById('propertyForm')) {
  const price = readField(form, 'price').trim();
  const neighborhood = readField(form, 'neighborhood').trim();
  const location = readField(form, 'location').trim();
  const enteredMapUrl = readField(form, 'mapUrl', 'map_url').trim();
  return {
    title: readField(form, 'title').trim(),
    type: readField(form, 'type').trim(),
    neighborhood: nullIfBlank(neighborhood),
    location: nullIfBlank(location),
    price,
    price_cents: parsePriceToCents(price),
    description: readField(form, 'description'),
    features: splitFormList(readField(form, 'features')),
    latitude: nullIfBlank(readField(form, 'latitude').trim()),
    longitude: nullIfBlank(readField(form, 'longitude').trim()),
    mapUrl: nullIfBlank(enteredMapUrl || buildMapUrl({ neighborhood, location })),
    legacy_id: nullIfBlank(readField(form, 'legacy_id').trim()),
    isNew: readChecked(form, 'isNew', 'is_new'),
    purpose: nullIfBlank(readField(form, 'purpose').trim()),
    sourceUrl: nullIfBlank(readField(form, 'sourceUrl', 'source_url').trim()),
    proximidades: splitFormList(readField(form, 'proximidades')),
    status: readField(form, 'status') || 'draft',
  };
}

function setFormField(form, names, value) {
  const field = names.map((name) => formField(form, name)).find(Boolean);
  if (!field) return;
  if ('checked' in field && typeof value === 'boolean') field.checked = value;
  else field.value = value == null ? '' : String(value);
}

export function fillPropertyForm(form = globalThis.document?.getElementById('propertyForm'), property = {}) {
  if (!form) return;
  setFormField(form, ['title'], property.title ?? '');
  setFormField(form, ['type'], property.type ?? '');
  setFormField(form, ['neighborhood'], property.neighborhood ?? '');
  setFormField(form, ['location'], property.location ?? '');
  const formPrice = property.price ?? (property.price_cents == null ? '' : formatCentsAsPrice(property.price_cents));
  setFormField(form, ['price'], formPrice);
  setFormField(form, ['description'], property.description ?? '');
  setFormField(form, ['features'], (property.features ?? []).join('\n'));
  setFormField(form, ['latitude'], property.latitude ?? '');
  setFormField(form, ['longitude'], property.longitude ?? '');
  setFormField(form, ['mapUrl', 'map_url'], property.mapUrl ?? property.map_url ?? buildMapUrl(property));
  setFormField(form, ['legacy_id'], property.legacy_id ?? '');
  setFormField(form, ['isNew', 'is_new'], property.isNew ?? property.is_new ?? false);
  setFormField(form, ['purpose'], property.purpose ?? '');
  setFormField(form, ['sourceUrl', 'source_url'], property.sourceUrl ?? property.source_url ?? '');
  setFormField(form, ['proximidades'], (property.proximidades ?? []).join('\n'));
  setFormField(form, ['status'], property.status ?? 'draft');
  setFormField(form, ['propertyId'], property.id ?? '');
}

function textElement(root, tag, text) {
  const element = root.createElement(tag);
  element.textContent = text;
  return element;
}

function staticPropertyFor(property) {
  const key = property?.legacy_id ?? property?.id;
  const staticProperties = globalThis.window?.IMOVEIS_DATA ?? globalThis.IMOVEIS_DATA ?? [];
  return staticProperties.find((item) => String(item?.id ?? '') === String(key ?? '')) ?? null;
}

export function updateEditorActions(elements, property) {
  const hasProperty = Boolean(property?.id);
  if (elements?.publishPropertyButton) {
    elements.publishPropertyButton.disabled = !hasProperty || property.status === 'published';
  }
  if (elements?.archivePropertyButton) {
    elements.archivePropertyButton.disabled = !hasProperty || property.status === 'archived';
  }
  if (elements?.deletePropertyButton) {
    elements.deletePropertyButton.disabled = !hasProperty;
  }
}

export function renderPropertyList(properties = [], root = globalThis.document) {
  const list = root?.getElementById?.('propertyList');
  const empty = root?.getElementById?.('propertyEmpty');
  if (!list || !root?.createElement) return;
  list.replaceChildren();
  const rows = Array.isArray(properties) ? properties : [];
  if (empty) empty.hidden = rows.length > 0;

  for (const property of rows) {
    const item = root.createElement('article');
    item.className = 'property-row';
    item.dataset.propertyId = property.id ?? '';

    const staticProperty = staticPropertyFor(property);
    const thumbnail = property.images?.[0] ?? staticProperty?.images?.[0] ?? '';
    const media = root.createElement('div');
    media.className = 'property-row-media';
    if (thumbnail) {
      const image = root.createElement('img');
      image.src = thumbnail;
      image.alt = property.title || 'Foto do imóvel';
      image.loading = 'lazy';
      media.append(image);
    } else {
      const placeholder = textElement(root, 'span', 'Sem foto');
      placeholder.className = 'property-row-media-placeholder';
      media.append(placeholder);
    }

    const details = root.createElement('div');
    details.className = 'property-row-details';
    details.append(
      textElement(root, 'h3', property.title || 'Sem título'),
      textElement(root, 'p', [property.type, property.neighborhood].filter(Boolean).join(' · ') || 'Sem categoria'),
      textElement(root, 'p', property.price || 'Preço não informado'),
    );

    const meta = root.createElement('div');
    meta.className = 'property-row-meta';
    const status = textElement(root, 'span', property.status || 'draft');
    status.className = `status-badge status-${property.status || 'draft'}`;
    meta.append(status);

    const actions = root.createElement('div');
    actions.className = 'property-row-actions';
    const edit = root.createElement('button');
    edit.type = 'button';
    edit.className = 'button button-secondary';
    edit.dataset.action = 'edit';
    edit.textContent = 'Editar';
    actions.append(edit);
    meta.append(actions);
    item.append(media, details, meta);
    list.append(item);
  }
}

let propertyAdminContext = null;

function propertyImages(property) {
  const records = Array.isArray(property?.property_images)
    ? [...property.property_images].sort((left, right) => Number(left.sort_order) - Number(right.sort_order))
    : [];
  return records.map((record, index) => ({
    ...record,
    publicUrl: property?.images?.[index] ?? record.storage_path,
  }));
}

function showPropertyMessage(message, tone = 'success') {
  const target = propertyAdminContext?.elements?.propertyMessage;
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}

function safePropertyError(error, fallback) {
  return error?.code && SAFE_MESSAGES[error.code] ? SAFE_MESSAGES[error.code] : fallback;
}

function currentPropertyId(form) {
  return readField(form, 'propertyId').trim() || null;
}

function renderPropertyImages(property) {
  const context = propertyAdminContext;
  const list = context?.elements?.imageList;
  if (!list || !context.root?.createElement) return;
  list.replaceChildren();
  const managedImages = propertyImages(property);
  const staticImages = staticPropertyFor(property)?.images ?? [];
  const images = managedImages.length > 0
    ? managedImages
    : staticImages.map((publicUrl, index) => ({
      publicUrl,
      alt_text: `Foto atual do site ${index + 1}`,
      staticPreview: true,
    }));
  context.elements.imageEmpty.hidden = images.length > 0;
  context.elements.imageEmpty.textContent = managedImages.length > 0
    ? ''
    : staticImages.length > 0
      ? 'Estas são as fotos atuais do site. Adicione novas fotos para começar a gerenciar a galeria no Supabase.'
      : 'Salve o imóvel para adicionar fotos.';
  context.elements.imageUpload.disabled = !property?.id;

  images.forEach((image, index) => {
    const item = context.root.createElement('li');
    item.className = 'image-item';
    item.dataset.imageId = image.id ?? '';
    const preview = context.root.createElement('img');
    preview.src = image.publicUrl;
    preview.alt = image.alt_text || `Foto ${index + 1}`;
    preview.loading = 'lazy';
    const controls = context.root.createElement('div');
    controls.className = 'image-controls';
    if (image.staticPreview) {
      controls.className += ' image-controls-static';
      controls.append(textElement(context.root, 'span', 'Foto atual do site'));
      item.append(preview, controls);
      list.append(item);
      return;
    }
    const moveLeft = context.root.createElement('button');
    moveLeft.type = 'button';
    moveLeft.className = 'button button-secondary';
    moveLeft.dataset.imageAction = 'left';
    moveLeft.disabled = index === 0;
    moveLeft.textContent = '←';
    moveLeft.setAttribute('aria-label', `Mover foto ${index + 1} para a esquerda`);
    const moveRight = context.root.createElement('button');
    moveRight.type = 'button';
    moveRight.className = 'button button-secondary';
    moveRight.dataset.imageAction = 'right';
    moveRight.disabled = index === images.length - 1;
    moveRight.textContent = '→';
    moveRight.setAttribute('aria-label', `Mover foto ${index + 1} para a direita`);
    const remove = context.root.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-danger';
    remove.dataset.imageAction = 'delete';
    remove.textContent = 'Excluir';
    controls.append(moveLeft, moveRight, remove);
    item.append(preview, controls);
    list.append(item);
  });
}

async function refreshPropertyList() {
  const context = propertyAdminContext;
  if (!context) return [];
  context.elements.propertyLoading.hidden = false;
  try {
    const properties = await context.repository.listAdmin(context.filters);
    context.properties = properties;
    renderPropertyList(properties, context.root);
    return properties;
  } catch (error) {
    showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.LOAD_PROPERTIES_FAILED), 'error');
    return [];
  } finally {
    context.elements.propertyLoading.hidden = true;
  }
}

async function loadPropertyIntoForm(propertyId) {
  const context = propertyAdminContext;
  if (!context) return;
  const property = context.properties.find((item) => item.id === propertyId)
    ?? await context.repository.getById(propertyId);
  if (!property) return;
  context.activeProperty = property;
  context.elements.propertyEditorPanel?.setAttribute('open', '');
  fillPropertyForm(context.elements.propertyForm, property);
  context.elements.formHeading.textContent = 'Editar imóvel';
  if (context.elements.editorSummaryTitle) context.elements.editorSummaryTitle.textContent = 'Editar imóvel selecionado';
  updateEditorActions(context.elements, property);
  renderPropertyImages(property);
  context.elements.propertyForm.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

async function refreshActiveProperty() {
  const context = propertyAdminContext;
  if (!context?.activeProperty?.id) return;
  const property = await context.repository.getById(context.activeProperty.id);
  if (!property) return;
  context.activeProperty = property;
  context.properties = context.properties.map((item) => item.id === property.id ? property : item);
  fillPropertyForm(context.elements.propertyForm, property);
  if (context.elements.editorSummaryTitle) context.elements.editorSummaryTitle.textContent = 'Editar imóvel selecionado';
  updateEditorActions(context.elements, property);
  renderPropertyImages(property);
}

export async function handlePropertySubmit(event) {
  event?.preventDefault?.();
  const context = propertyAdminContext;
  if (!context) return;
  const form = event?.currentTarget ?? context.elements.propertyForm;
  const input = readPropertyForm(form);
  const validation = validatePropertyInput(input);
  if (!validation.valid) {
    showPropertyMessage(`Preencha: ${validation.errors.join(', ')}.`, 'error');
    return;
  }
  if (event?.submitter?.dataset?.saveStatus) {
    input.status = event.submitter.dataset.saveStatus;
  }

  const button = event?.submitter;
  if (button) button.disabled = true;
  try {
    const saved = await context.repository.save(input, currentPropertyId(form));
    context.activeProperty = saved;
    context.elements.propertyEditorPanel?.setAttribute('open', '');
    fillPropertyForm(form, saved);
    context.elements.formHeading.textContent = 'Editar imóvel';
    if (context.elements.editorSummaryTitle) context.elements.editorSummaryTitle.textContent = 'Editar imóvel selecionado';
    updateEditorActions(context.elements, saved);
    await refreshPropertyList();
    renderPropertyImages(saved);
    showPropertyMessage(input.status === 'published' ? 'Imóvel publicado.' : 'Rascunho salvo.');
  } catch (error) {
    showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.SAVE_PROPERTY_FAILED), 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export async function handleImageUpload(files, propertyId) {
  const context = propertyAdminContext;
  if (!context || !propertyId) return;
  const selectedFiles = Array.from(files ?? []);
  const invalid = selectedFiles.find((file) => !String(file?.type ?? '').toLowerCase().startsWith('image/'));
  if (invalid || selectedFiles.some((file) => Number(file?.size ?? 0) > IMAGE_MAX_SIZE_BYTES)) {
    showPropertyMessage(`Selecione apenas imagens de até ${IMAGE_MAX_SIZE_BYTES / 1024 / 1024} MB.`, 'error');
    return;
  }
  const existingCount = propertyImages(context.activeProperty).length;
  try {
    for (const [index, file] of selectedFiles.entries()) {
      await context.repository.uploadImage(propertyId, file, existingCount + index);
    }
    await refreshActiveProperty();
    showPropertyMessage('Fotos enviadas.');
  } catch (error) {
    showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.IMAGE_UPLOAD_FAILED), 'error');
  }
}

async function reorderPropertyImage(propertyId, images, index, offset) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= images.length) return;
  const ordered = [...images];
  [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
  try {
    await propertyAdminContext.repository.reorderImages(propertyId, ordered);
    await refreshActiveProperty();
    showPropertyMessage('Ordem das fotos atualizada.');
  } catch (error) {
    showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.IMAGE_REORDER_FAILED), 'error');
  }
}

function bindPropertyDashboard(context) {
  const { elements, root } = context;
  elements.propertyForm?.addEventListener('submit', handlePropertySubmit);
  const updateMapField = () => {
    const neighborhood = readField(elements.propertyForm, 'neighborhood').trim();
    const location = readField(elements.propertyForm, 'location').trim();
    const mapField = formField(elements.propertyForm, 'mapUrl') ?? formField(elements.propertyForm, 'map_url');
    if (mapField) mapField.value = buildMapUrl({ neighborhood, location });
  };
  ['neighborhood', 'location'].forEach((name) => {
    formField(elements.propertyForm, name)?.addEventListener('input', updateMapField);
  });
  elements.newPropertyButton?.addEventListener('click', () => {
    context.activeProperty = null;
    elements.propertyEditorPanel?.setAttribute('open', '');
    fillPropertyForm(elements.propertyForm, { status: 'draft' });
    elements.formHeading.textContent = 'Novo imóvel';
    if (elements.editorSummaryTitle) elements.editorSummaryTitle.textContent = 'Novo imóvel';
    updateEditorActions(elements, null);
    renderPropertyImages({});
    showPropertyMessage('');
    elements.propertyForm.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
  elements.filtersForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    context.filters = {
      status: readField(elements.filtersForm, 'status'),
      category: readField(elements.filtersForm, 'category'),
      search: readField(elements.filtersForm, 'search').trim(),
    };
    void refreshPropertyList();
  });
  elements.filtersForm?.addEventListener('input', () => {
    context.filters = {
      status: readField(elements.filtersForm, 'status'),
      category: readField(elements.filtersForm, 'category'),
      search: readField(elements.filtersForm, 'search').trim(),
    };
  });
  elements.propertyList?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest?.('[data-action]');
    const row = actionButton?.closest?.('[data-property-id]');
    if (!actionButton || !row) return;
    const propertyId = row.dataset.propertyId;
    const property = context.properties.find((item) => item.id === propertyId);
    if (!property) return;
    if (actionButton.dataset.action === 'edit') await loadPropertyIntoForm(propertyId);
  });
  elements.editorActions?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest?.('[data-editor-action]');
    const property = context.activeProperty;
    if (!actionButton || !property?.id) return;
    const action = actionButton.dataset.editorAction;
    if (action === 'delete') {
      if (typeof globalThis.confirm === 'function' && !globalThis.confirm('Excluir este imóvel e suas fotos?')) return;
      try {
        await context.repository.remove(property.id);
        context.activeProperty = null;
        fillPropertyForm(elements.propertyForm, { status: 'draft' });
        elements.formHeading.textContent = 'Novo imóvel';
        if (elements.editorSummaryTitle) elements.editorSummaryTitle.textContent = 'Novo imóvel';
        updateEditorActions(elements, null);
        renderPropertyImages({});
        await refreshPropertyList();
        showPropertyMessage('Imóvel excluído.');
      } catch (error) {
        showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.DELETE_PROPERTY_FAILED), 'error');
      }
      return;
    }
    const status = action === 'publish' ? 'published' : action === 'archive' ? 'archived' : null;
    if (!status) return;
    actionButton.disabled = true;
    try {
      await context.repository.setStatus(property.id, status);
      await refreshActiveProperty();
      await refreshPropertyList();
      showPropertyMessage(status === 'published' ? 'Imóvel publicado.' : 'Imóvel arquivado.');
    } catch (error) {
      showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.STATUS_PROPERTY_FAILED), 'error');
    } finally {
      updateEditorActions(elements, context.activeProperty);
    }
  });
  elements.imageUpload?.addEventListener('change', (event) => {
    void handleImageUpload(event.target.files, currentPropertyId(elements.propertyForm));
    event.target.value = '';
  });
  elements.imageList?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest?.('[data-image-action]');
    const item = actionButton?.closest?.('[data-image-id]');
    if (!actionButton || !item || !context.activeProperty) return;
    const images = propertyImages(context.activeProperty);
    const index = images.findIndex((image) => image.id === item.dataset.imageId);
    if (index < 0) return;
    const action = actionButton.dataset.imageAction;
    if (action === 'left') return reorderPropertyImage(context.activeProperty.id, images, index, -1);
    if (action === 'right') return reorderPropertyImage(context.activeProperty.id, images, index, 1);
    if (action === 'delete') {
      try {
        await context.repository.removeImage(images[index]);
        await refreshActiveProperty();
        showPropertyMessage('Foto excluída.');
      } catch (error) {
        showPropertyMessage(safePropertyError(error, SAFE_MESSAGES.IMAGE_DELETE_FAILED), 'error');
      }
    }
  });
}

async function initializePropertyDashboard({ client, repository, root, elements }) {
  if (!elements.propertyForm || !elements.propertyList) return;
  if (!propertyAdminContext || propertyAdminContext.root !== root) {
    propertyAdminContext = {
      client,
      repository: repository ?? createPropertyRepository({ client }),
      root,
      elements,
      filters: {},
      properties: [],
      activeProperty: null,
    };
    bindPropertyDashboard(propertyAdminContext);
    fillPropertyForm(elements.propertyForm, { status: 'draft' });
    renderPropertyImages({});
  }
  await refreshPropertyList();
}

export class AdminAuthError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] ?? 'Não foi possível concluir a operação.');
    this.name = 'AdminAuthError';
    this.code = code;
  }
}

export function deferAuthSync(sync) {
  const schedule = typeof globalThis.queueMicrotask === 'function'
    ? globalThis.queueMicrotask
    : (callback) => globalThis.setTimeout(callback, 0);
  schedule(() => { void sync(); });
}

function createConfiguredError() {
  return new AdminAuthError('AUTH_UNAVAILABLE');
}

function isAdminMembership(row, user) {
  return row?.user_id === user?.id && row?.role === 'admin';
}

async function readMembership(client, userId) {
  let query;
  try {
    query = client
      .from('admin_users')
      .select('user_id, role')
      .eq('user_id', userId)
      .eq('role', 'admin');
  } catch {
    throw new AdminAuthError('MEMBERSHIP_CHECK_FAILED');
  }

  try {
    const result = typeof query.maybeSingle === 'function'
      ? await query.maybeSingle()
      : await query;
    if (result?.error) throw new AdminAuthError('MEMBERSHIP_CHECK_FAILED');
    return result?.data ?? null;
  } catch (error) {
    if (error instanceof AdminAuthError) throw error;
    throw new AdminAuthError('MEMBERSHIP_CHECK_FAILED');
  }
}

export function createAdminAuth({ client, onAuthChange } = {}) {
  let authSubscription = null;

  async function signIn(email, password) {
    if (!client?.auth?.signInWithPassword) throw createConfiguredError();
    if (!String(email ?? '').trim() || !String(password ?? '')) {
      throw new AdminAuthError('INVALID_CREDENTIALS');
    }

    try {
      const { error } = await client.auth.signInWithPassword({
        email: String(email).trim(),
        password: String(password),
      });
      if (error) throw new AdminAuthError('INVALID_CREDENTIALS');
    } catch (error) {
      if (error instanceof AdminAuthError) throw error;
      throw new AdminAuthError('INVALID_CREDENTIALS');
    }
  }

  async function signOut() {
    if (!client?.auth?.signOut) throw createConfiguredError();
    try {
      const { error } = await client.auth.signOut();
      if (error) throw new AdminAuthError('SIGN_OUT_FAILED');
    } catch (error) {
      if (error instanceof AdminAuthError) throw error;
      throw new AdminAuthError('SIGN_OUT_FAILED');
    }
  }

  async function requireAdminSession() {
    if (!client?.auth?.getUser) throw createConfiguredError();

    let user;
    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw new AdminAuthError('SESSION_CHECK_FAILED');
      user = data?.user ?? null;
    } catch (error) {
      if (error instanceof AdminAuthError) throw error;
      throw new AdminAuthError('SESSION_CHECK_FAILED');
    }

    if (!user?.id) throw new AdminAuthError('SIGNED_OUT');

    const membership = await readMembership(client, user.id);
    if (!isAdminMembership(membership, user)) throw new AdminAuthError('NOT_ADMIN');
    return user;
  }

  function subscribe() {
    if (authSubscription || !client?.auth?.onAuthStateChange) return authSubscription;

    const result = client.auth.onAuthStateChange((event) => {
      if (typeof onAuthChange === 'function') onAuthChange(event);
    });
    authSubscription = result?.data?.subscription ?? null;
    return authSubscription;
  }

  return { signIn, signOut, requireAdminSession, subscribe };
}

function getPageElements(root = globalThis.document) {
  if (!root?.getElementById) return {};
  return {
    loading: root.getElementById('loadingState'),
    setup: root.getElementById('setupState'),
    login: root.getElementById('loginState'),
    denied: root.getElementById('deniedState'),
    dashboard: root.getElementById('dashboardState'),
    loginMessage: root.getElementById('loginMessage'),
    loadingMessage: root.getElementById('loadingMessage'),
    dashboardMessage: root.getElementById('dashboardMessage'),
    loginButton: root.getElementById('loginButton'),
    userLabel: root.getElementById('adminUserLabel'),
    propertyLoading: root.getElementById('propertyLoading'),
    propertyEmpty: root.getElementById('propertyEmpty'),
    propertyList: root.getElementById('propertyList'),
    propertyForm: root.getElementById('propertyForm'),
    filtersForm: root.getElementById('propertyFilters'),
    newPropertyButton: root.getElementById('newPropertyButton'),
    propertyEditorPanel: root.getElementById('propertyEditorPanel'),
    editorSummaryTitle: root.getElementById('editorSummaryTitle'),
    formHeading: root.getElementById('propertyFormHeading'),
    propertyMessage: root.getElementById('propertyMessage'),
    editorActions: root.getElementById('editorActions'),
    publishPropertyButton: root.getElementById('publishPropertyButton'),
    archivePropertyButton: root.getElementById('archivePropertyButton'),
    deletePropertyButton: root.getElementById('deletePropertyButton'),
    imageUpload: root.getElementById('imageUpload'),
    imageList: root.getElementById('imageList'),
    imageEmpty: root.getElementById('imageEmpty'),
  };
}

export function renderAdminState(state, root = globalThis.document) {
  const elements = getPageElements(root);
  const active = state?.kind ?? state;
  const message = Object.values(SAFE_MESSAGES).includes(state?.message) ? state.message : '';
  const panels = [elements.loading, elements.setup, elements.login, elements.denied, elements.dashboard];
  panels.filter(Boolean).forEach((panel) => { panel.hidden = true; });

  const panel = {
    loading: elements.loading,
    setup: elements.setup,
    'signed-out': elements.login,
    denied: elements.denied,
    admin: elements.dashboard,
  }[active];
  if (panel) panel.hidden = false;

  if (elements.loginMessage) {
    elements.loginMessage.textContent = active === 'signed-out' ? message : '';
    elements.loginMessage.dataset.tone = message ? 'error' : '';
  }
  if (elements.loadingMessage) {
    elements.loadingMessage.textContent = active === 'loading' ? message : '';
    elements.loadingMessage.dataset.tone = message ? 'error' : '';
  }
  if (elements.dashboardMessage) {
    elements.dashboardMessage.textContent = active === 'admin' ? message : '';
    elements.dashboardMessage.dataset.tone = message ? 'error' : '';
  }
  if (elements.loginButton) elements.loginButton.disabled = active === 'loading';
  if (elements.userLabel && active === 'admin') {
    const email = typeof state?.user?.email === 'string' ? state.user.email : '';
    elements.userLabel.textContent = email ? `Sessão ativa: ${email}` : 'Sessão administrativa ativa.';
  }
}

let defaultAuth;
function getDefaultAuth() {
  if (!defaultAuth) {
    defaultAuth = createAdminAuth({
      client: createSupabaseClient(),
    });
  }
  return defaultAuth;
}

export function signIn(email, password) {
  return getDefaultAuth().signIn(email, password);
}

export function signOut() {
  return getDefaultAuth().signOut();
}

export function requireAdminSession() {
  return getDefaultAuth().requireAdminSession();
}

let pageController;
let pageSync;

export async function initializeAdmin({ client, repository } = {}) {
  const root = globalThis.document;
  if (!root) return null;

  const config = readSupabaseConfig(globalThis.TAMARA_SUPABASE_CONFIG);
  const configured = hasSupabaseConfig(config);
  const resolvedClient = client ?? (configured ? createSupabaseClient({ config }) : null);
  if (configured && !resolvedClient?.auth) {
    renderAdminState({ kind: 'setup' }, root);
    return null;
  }

  if (pageController) return pageController;

  pageController = createAdminAuth({
    client: resolvedClient,
    onAuthChange: () => deferAuthSync(syncAdminState),
  });
  const elements = getPageElements(root);
  const loginForm = root.getElementById('loginForm');
  const logoutButton = root.getElementById('logoutButton');
  const deniedBackButton = root.getElementById('deniedBackButton');
  let currentState = { kind: 'loading' };

  function showState(state) {
    currentState = state;
    renderAdminState(state, root);
  }

  async function syncAdminState() {
    if (pageSync) return pageSync;
    pageSync = (async () => {
      showState({ kind: 'loading' });
      try {
        const user = await pageController.requireAdminSession();
        showState({ kind: 'admin', user });
        await initializePropertyDashboard({
          client: resolvedClient,
          repository,
          root,
          elements,
        });
      } catch (error) {
        if (error?.code === 'NOT_ADMIN') {
          try {
            await pageController.signOut();
            showState({ kind: 'denied' });
          } catch {
            showState({ ...currentState, message: SAFE_MESSAGES.SIGN_OUT_FAILED });
          }
        } else if (error?.code === 'SIGNED_OUT') {
          showState({ kind: 'signed-out' });
        } else if (error?.code === 'AUTH_UNAVAILABLE') {
          showState({ kind: 'signed-out', message: SAFE_MESSAGES.AUTH_UNAVAILABLE });
        } else {
          showState({ kind: 'signed-out', message: SAFE_MESSAGES.SESSION_CHECK_FAILED });
        }
      } finally {
        pageSync = null;
      }
    })();
    return pageSync;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      try {
        showState({ kind: 'loading' });
        await pageController.signIn(formData.get('email'), formData.get('password'));
        loginForm.reset();
        await syncAdminState();
      } catch (error) {
        showState({
          kind: 'signed-out',
          message: error?.code === 'AUTH_UNAVAILABLE'
            ? SAFE_MESSAGES.AUTH_UNAVAILABLE
            : SAFE_MESSAGES.INVALID_CREDENTIALS,
        }, root);
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      try {
        await pageController.signOut();
        showState({ kind: 'signed-out' });
      } catch {
        showState({ ...currentState, message: SAFE_MESSAGES.SIGN_OUT_FAILED });
      } finally {
        logoutButton.disabled = false;
      }
    });
  }

  if (deniedBackButton) {
    deniedBackButton.addEventListener('click', () => showState({ kind: 'signed-out' }));
  }

  pageController.subscribe();
  await syncAdminState();
  return pageController;
}

if (globalThis.window) {
  globalThis.window.AdminPanel = {
    createAdminAuth,
    fillPropertyForm,
    handleImageUpload,
    handlePropertySubmit,
    initializeAdmin,
    readPropertyForm,
    renderPropertyList,
    renderAdminState,
    updateEditorActions,
    requireAdminSession,
    signIn,
    signOut,
  };
  const start = () => { void initializeAdmin(); };
  if (globalThis.document?.readyState === 'loading') {
    globalThis.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
