import test from 'node:test';
import assert from 'node:assert/strict';

function createRoot() {
  const ids = [
    'loadingState', 'setupState', 'loginState', 'deniedState', 'dashboardState',
    'loginMessage', 'loadingMessage', 'dashboardMessage', 'loginButton',
    'adminUserLabel', 'loginForm', 'logoutButton', 'deniedBackButton',
  ];
  const elements = new Map(ids.map((id) => [id, {
    hidden: true,
    textContent: '',
    dataset: {},
    disabled: false,
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    reset() {},
  }]));
  return {
    getElementById(id) { return elements.get(id) ?? null; },
    element(id) { return elements.get(id); },
  };
}

function createClient({ signOutFails = false } = {}) {
  let authCallback;
  let callbackActive = false;
  let getUserCalls = 0;
  let getUserCalledDuringCallback = false;

  const client = {
    auth: {
      async getUser() {
        getUserCalls += 1;
        if (callbackActive) getUserCalledDuringCallback = true;
        return { data: { user: { id: 'admin-1', email: 'admin@example.test' } }, error: null };
      },
      async signOut() {
        return signOutFails ? { error: new Error('provider detail') } : { error: null };
      },
      onAuthStateChange(callback) {
        authCallback = (...args) => {
          callbackActive = true;
          try { return callback(...args); } finally { callbackActive = false; }
        };
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: { user_id: 'admin-1', role: 'admin' }, error: null };
        },
      };
    },
    emitAuthChange() { authCallback('SIGNED_IN', {}); },
    getUserCalls() { return getUserCalls; },
    getUserCalledDuringCallback() { return getUserCalledDuringCallback; },
  };
  return client;
}

async function withAdminPage(testBody) {
  const previousDocument = globalThis.document;
  const previousConfig = globalThis.TAMARA_SUPABASE_CONFIG;
  const root = createRoot();
  globalThis.document = root;
  globalThis.TAMARA_SUPABASE_CONFIG = {
    url: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
  };
  try {
    await testBody(root);
  } finally {
    globalThis.document = previousDocument;
    globalThis.TAMARA_SUPABASE_CONFIG = previousConfig;
  }
}

test('defers auth-state synchronization until after the Supabase callback returns', async () => {
  const { initializeAdmin } = await import('../admin.js?admin-auth-defer');
  const client = createClient();

  await withAdminPage(async () => {
    await initializeAdmin({ client });
    const callsBeforeEvent = client.getUserCalls();

    client.emitAuthChange();
    assert.equal(client.getUserCalledDuringCallback(), false);
    assert.equal(client.getUserCalls(), callsBeforeEvent);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(client.getUserCalls() > callsBeforeEvent);
  });
});

test('keeps the dashboard visible and shows a safe message when logout fails', async () => {
  const { initializeAdmin } = await import('../admin.js?admin-auth-signout');
  const client = createClient({ signOutFails: true });

  await withAdminPage(async (root) => {
    await initializeAdmin({ client });
    await root.element('logoutButton').handlers.click();

    assert.equal(root.element('dashboardState').hidden, false);
    assert.equal(root.element('loginState').hidden, true);
    assert.equal(
      root.element('dashboardMessage').textContent,
      'Não foi possível encerrar a sessão com segurança.',
    );
  });
});
