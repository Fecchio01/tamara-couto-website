# Admin shell smoke test

These checks cover the Task 4 authentication boundary. Run them with the local
static server from the repository root, using a blank `supabase-config.js` for
the first check and a Supabase project with the public URL/publishable key for
the remaining checks.

## Automated prerequisites

- [ ] `npm test` passes.
- [ ] `node --check admin.js` passes.
- [ ] `node --check supabase-client.js` passes.
- [ ] `git diff --check` passes.

## Browser checks

### Blank or invalid configuration

- [ ] Open `/admin.html` with blank or invalid `TAMARA_SUPABASE_CONFIG`.
- [ ] The page shows setup guidance and does not show the login form.
- [ ] No authentication request is attempted.
- [ ] The page does not display a publishable key, service-role key, token,
      session payload, or raw provider error.

### Signed out

- [ ] With valid public configuration and no active session, only the
      email/password login form is visible.
- [ ] There is no signup link, signup form, password-reset flow, or dashboard
      control.

### Invalid login

- [ ] Submit an invalid email/password pair.
- [ ] A clear non-sensitive error is shown (for example, “Não foi possível
      entrar. Confira o e-mail e a senha.”).
- [ ] The raw Supabase error, token, key, and session object are not rendered
      or logged.

### Authenticated non-admin

- [ ] Sign in as an authenticated user with no `admin_users` row or a role
      other than `admin`.
- [ ] The page shows access denied and renders no dashboard controls.
- [ ] The user is signed out after the RLS membership check.

### Authenticated admin

- [ ] Sign in as a user with a matching `admin_users.user_id` row and
      `role = 'admin'`.
- [ ] The protected dashboard shell is shown with the current email, a logout
      action, and a Task 5 placeholder for the property list/form.
- [ ] No CRUD request is made by the Task 4 shell.

### Logout and listener safety

- [ ] Click logout; the dashboard disappears and only the login form remains.
- [ ] Repeated session changes do not duplicate status messages, requests, or
      auth listeners.
- [ ] Browser storage contains only the normal Supabase Auth session; no
      service-role key or other backend secret is present.

## Limitations

The browser checks require a Supabase project and admin/non-admin test users.
If Docker or a browser is unavailable, record the unavailable checks in the
handoff instead of treating Node syntax/tests as a substitute for them.
