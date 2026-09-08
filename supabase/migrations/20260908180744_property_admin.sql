create table public.properties (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  title text not null,
  type text not null,
  location text,
  neighborhood text,
  price_cents bigint not null default 0 check (price_cents >= 0),
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  description text not null default '',
  latitude double precision,
  longitude double precision,
  map_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index properties_status_idx on public.properties (status);
create index properties_type_idx on public.properties (type);
create index properties_updated_at_idx on public.properties (updated_at desc);

create table public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  storage_path text not null unique,
  sort_order integer not null default 0 check (sort_order >= 0),
  alt_text text,
  created_at timestamptz not null default timezone('utc', now())
);

create index property_images_property_order_idx
  on public.property_images (property_id, sort_order, id);

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.properties enable row level security;
alter table public.property_images enable row level security;
alter table public.admin_users enable row level security;

grant select, insert, update, delete on table public.properties to anon, authenticated;
grant select, insert, update, delete on table public.property_images to anon, authenticated;
grant select on table public.admin_users to authenticated;

create policy "Published properties are readable by everyone"
  on public.properties
  for select
  to anon
  using (status = 'published');

create policy "Admins can read all properties"
  on public.properties
  for select
  to authenticated
  using (
    status = 'published'
    or exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can insert properties"
  on public.properties
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can update properties"
  on public.properties
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can delete properties"
  on public.properties
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Published property images are readable by everyone"
  on public.property_images
  for select
  to public
  using (
    exists (
      select 1
      from public.properties
      where properties.id = property_images.property_id
        and properties.status = 'published'
    )
  );

create policy "Admins can read all property images"
  on public.property_images
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can insert property images"
  on public.property_images
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can update property images"
  on public.property_images
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can delete property images"
  on public.property_images
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can read their admin membership"
  on public.admin_users
  for select
  to authenticated
  using (user_id = (select auth.uid()) and role = 'admin');

insert into storage.buckets (id, name, public)
values ('property-images', 'property-images', false)
on conflict (id) do nothing;

alter table storage.objects enable row level security;
grant select, insert, update, delete on table storage.objects to anon, authenticated;

create policy "Published property storage objects are readable by everyone"
  on storage.objects
  for select
  to public
  using (
    bucket_id = 'property-images'
    and exists (
      select 1
      from public.property_images
      join public.properties on properties.id = property_images.property_id
      where property_images.storage_path = objects.name
        and properties.status = 'published'
    )
  );

create policy "Admins can read property storage objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'property-images'
    and name like 'properties/%'
    and exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can insert property storage objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'property-images'
    and name like 'properties/%'
    and exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can update property storage objects"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'property-images'
    and name like 'properties/%'
    and exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  )
  with check (
    bucket_id = 'property-images'
    and name like 'properties/%'
    and exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );

create policy "Admins can delete property storage objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'property-images'
    and name like 'properties/%'
    and exists (
      select 1
      from public.admin_users
      where admin_users.user_id = (select auth.uid())
        and admin_users.role = 'admin'
    )
  );
