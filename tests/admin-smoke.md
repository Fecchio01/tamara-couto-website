# Admin shell smoke test

These checks cover the Task 4 authentication boundary. Run them with the local
static server from the repository root, using a blank `supabase-config.js` for
the first check and a Supabase project with the public URL/publishable key for
the remaining checks.

## Automated prerequisites

- [ ] `npm test` passes.
- [ ] `node --check admin.js` passes.
- [ ] `node --check supabase-client.js` passes.
- [ ] `node --check property-repository.js` passes.
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

### Property CRUD and filters

- [ ] After an authorized admin login, the list loads with status, category,
      and title-search filters; loading, empty, and error messages stay inside
      the dashboard.
- [ ] Create a draft with a title/category and no price; confirm the draft is
      listed and the form can reopen it for editing.
- [ ] Edit the location, description, features, optional `legacy_id`, map URL,
      purpose, source URL, and nearby places; save and confirm the values are
      preserved after reload.
- [ ] Publish the draft; confirm the published status appears in the list.
- [ ] Archive it; confirm the archived status appears and it is excluded when
      the published filter is selected.
- [ ] Delete the property; confirm it disappears from the list after the
      confirmation prompt.

### Property photos

- [ ] Open a saved property and select two valid image files; non-image files
      and files larger than 10 MB are rejected before any upload request.
- [ ] Confirm both previews appear, move the second photo before the first,
      reload the property, and verify the order is preserved.
- [ ] Delete one photo and confirm its preview disappears and the repository
      removes both its metadata and storage object.
- [ ] Confirm browser requests use the `property-images/properties/<id>/...`
      path and no service-role credential appears in source, storage, logs, or
      URLs.

## Limitations

The browser checks require a Supabase project and admin/non-admin test users.
If Docker or a browser is unavailable, record the unavailable checks in the
handoff instead of treating Node syntax/tests as a substitute for them.
