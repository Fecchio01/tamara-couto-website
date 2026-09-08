import {
  createSupabaseClient,
  hasSupabaseConfig,
  readSupabaseConfig,
} from './supabase-client.js';

const SAFE_MESSAGES = Object.freeze({
  INVALID_CREDENTIALS: 'Não foi possível entrar. Confira o e-mail e a senha.',
  AUTH_UNAVAILABLE: 'O serviço de autenticação está indisponível no momento.',
  SIGNED_OUT: 'Faça login para acessar o painel.',
  SESSION_CHECK_FAILED: 'Não foi possível verificar a sessão. Tente novamente.',
  MEMBERSHIP_CHECK_FAILED: 'Não foi possível verificar a autorização da conta.',
  NOT_ADMIN: 'Esta conta não tem permissão para acessar o painel.',
  SIGN_OUT_FAILED: 'Não foi possível encerrar a sessão com segurança.',
});

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

export async function initializeAdmin({ client } = {}) {
  const root = globalThis.document;
  if (!root) return null;

  const config = readSupabaseConfig(globalThis.TAMARA_SUPABASE_CONFIG);
  if (!hasSupabaseConfig(config)) {
    renderAdminState({ kind: 'setup' }, root);
    return null;
  }

  const resolvedClient = client ?? createSupabaseClient({ config });
  if (!resolvedClient?.auth) {
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
    initializeAdmin,
    renderAdminState,
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
