begin;

select plan(26);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'property-admin@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'property-non-admin@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb);

insert into public.admin_users (user_id, role)
values ('00000000-0000-0000-0000-000000000001', 'admin');

insert into public.properties (id, legacy_id, title, type, location, status, features)
values
  ('00000000-0000-0000-0000-000000000003', 'published-fixture', 'Published fixture', 'Casa', 'Campo Grande', 'published', '["Quartos: 3"]'::jsonb),
  ('00000000-0000-0000-0000-000000000004', 'draft-fixture', 'Draft fixture', 'Casa', 'Campo Grande', 'draft', '[]'::jsonb);

insert into public.property_images (id, property_id, storage_path, sort_order)
values
  ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000003', 'properties/published-fixture/cover.jpg', 1),
  ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000004', 'properties/draft-fixture/secret.jpg', 1);

insert into storage.objects (id, bucket_id, name, metadata)
values
  ('00000000-0000-0000-0000-000000000007', 'property-images', 'properties/published-fixture/cover.jpg', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000008', 'property-images', 'properties/draft-fixture/secret.jpg', '{}'::jsonb);

select is(
  (select public from storage.buckets where id = 'property-images'),
  false,
  'property-images bucket is private'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select results_eq(
  $$select id::text from public.properties order by id$$,
  $$values ('00000000-0000-0000-0000-000000000003')$$,
  'anonymous select returns only published rows'
);

select set_config('storage.operation', 'object.get_authenticated', true);

select results_eq(
  $$select name from storage.objects where bucket_id = 'property-images' order by name$$,
  $$values ('properties/published-fixture/cover.jpg')$$,
  'anonymous can read a published image'
);

select is(
  (select count(*) from storage.objects where name = 'properties/draft-fixture/secret.jpg'),
  0::bigint,
  'anonymous cannot read a draft image'
);

select set_config('storage.operation', 'storage.object.sign', true);

select results_eq(
  $$select name from storage.objects where bucket_id = 'property-images' order by name$$,
  $$values ('properties/published-fixture/cover.jpg')$$,
  'anonymous can sign a published image'
);

select is(
  (select count(*) from storage.objects where name = 'properties/draft-fixture/secret.jpg'),
  0::bigint,
  'anonymous cannot sign a draft image'
);

select set_config('storage.operation', 'object.list', true);

select is(
  (select count(*) from storage.objects where bucket_id = 'property-images'),
  0::bigint,
  'anonymous listing does not expose storage objects'
);

select throws_ok(
  $$insert into public.properties (title, type, location, status) values ('Anonymous', 'Casa', 'Campo Grande', 'draft')$$,
  '42501',
  null,
  'anonymous insert is rejected'
);

select is(
  (with updated as (
    update public.properties set title = 'Anonymous update'
    where id = '00000000-0000-0000-0000-000000000003'
    returning id
  ) select count(*) from updated),
  0::bigint,
  'anonymous update affects no rows'
);

select is(
  (with deleted as (
    delete from public.properties
    where id = '00000000-0000-0000-0000-000000000003'
    returning id
  ) select count(*) from deleted),
  0::bigint,
  'anonymous delete affects no rows'
);

select set_config('storage.operation', 'storage.object.upload', true);

select throws_ok(
  $$insert into storage.objects (id, bucket_id, name, metadata)
    values ('00000000-0000-0000-0000-000000000009', 'property-images', 'properties/anonymous/file.jpg', '{}'::jsonb)$$,
  '42501',
  null,
  'anonymous storage upload is rejected'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002"}',
  true
);

select throws_ok(
  $$insert into public.properties (title, type, location, status) values ('Non-admin', 'Casa', 'Campo Grande', 'draft')$$,
  '42501',
  null,
  'authenticated non-admin insert is rejected'
);

select is(
  (with updated as (
    update public.properties set title = 'Non-admin update'
    where id = '00000000-0000-0000-0000-000000000004'
    returning id
  ) select count(*) from updated),
  0::bigint,
  'authenticated non-admin update affects no rows'
);

select is(
  (with deleted as (
    delete from public.properties
    where id = '00000000-0000-0000-0000-000000000004'
    returning id
  ) select count(*) from deleted),
  0::bigint,
  'authenticated non-admin delete affects no rows'
);

select is(
  (with updated as (
    update storage.objects set name = 'properties/non-admin/renamed.jpg'
    where id = '00000000-0000-0000-0000-000000000007'
    returning id
  ) select count(*) from updated),
  0::bigint,
  'authenticated non-admin storage update affects no rows'
);

select is(
  (with deleted as (
    delete from storage.objects
    where id = '00000000-0000-0000-0000-000000000007'
    returning id
  ) select count(*) from deleted),
  0::bigint,
  'authenticated non-admin storage delete affects no rows'
);

select throws_ok(
  $$insert into storage.objects (id, bucket_id, name, owner_id, metadata)
    values ('00000000-0000-0000-0000-000000000005', 'property-images', 'properties/non-admin/file.jpg', '00000000-0000-0000-0000-000000000002', '{}'::jsonb)$$,
  '42501',
  null,
  'storage upload is rejected for non-admins'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);

select lives_ok(
  $$insert into public.properties (legacy_id, title, type, location, status, features, created_at, updated_at)
    values ('admin-created', 'Admin created', 'Casa', 'Campo Grande', 'draft', '[]'::jsonb, '2000-01-01 00:00:00+00', '2000-01-01 00:00:00+00')$$,
  'admin can insert a property'
);

select is(
  (select count(*) from public.properties where legacy_id = 'admin-created'),
  1::bigint,
  'admin insert is visible to the admin'
);

select lives_ok(
  $$update public.properties set title = 'Admin updated'
    where legacy_id = 'admin-created'$$,
  'admin can update a property'
);

select is(
  (select title from public.properties where legacy_id = 'admin-created'),
  'Admin updated',
  'admin update changes the property'
);

select ok(
  (select updated_at > timestamptz '2000-01-01 00:00:00+00' from public.properties where legacy_id = 'admin-created'),
  'property updates refresh updated_at'
);

select throws_ok(
  $$insert into public.property_images (property_id, storage_path, sort_order)
    values ('00000000-0000-0000-0000-000000000003', 'outside/file.jpg', 2)$$,
  '23514',
  null,
  'property image paths stay under properties/'
);

select throws_ok(
  $$update public.admin_users
    set user_id = '00000000-0000-0000-0000-000000000002'
    where user_id = '00000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'admin cannot change the authorization identity'
);

select lives_ok(
  $$insert into storage.objects (id, bucket_id, name, owner_id, metadata)
    values ('00000000-0000-0000-0000-000000000006', 'property-images', 'properties/admin/file.jpg', '00000000-0000-0000-0000-000000000001', '{}'::jsonb)$$,
  'storage upload is allowed for admins'
);

select is(
  (select count(*) from storage.objects where id = '00000000-0000-0000-0000-000000000006'),
  1::bigint,
  'admin storage upload is persisted'
);

set local role postgres;
select * from finish();
rollback;
