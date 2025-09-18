create extension if not exists pgcrypto;

create table brands(id uuid primary key default gen_random_uuid(), name text unique not null);
create table categories(id uuid primary key default gen_random_uuid(), name text not null, parent_id uuid references categories(id));
create table suppliers(id uuid primary key default gen_random_uuid(), name text not null, external_ref text);

create table products(
  id uuid primary key default gen_random_uuid(),
  style_id text unique not null,
  name text not null,
  brand_id uuid references brands(id),
  category_id uuid references categories(id),
  supplier_id uuid references suppliers(id),
  description text,
  spec_sheet_url text,
  px_per_in_default numeric(10,4),
  calibrated boolean default false,
  default_image_id uuid,
  external_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table product_views(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null check (name in ('front','back','left','right','product','color')),
  px_per_in numeric(10,4),
  unique(product_id,name)
);

create table colors(id uuid primary key default gen_random_uuid(), name text not null, code text);
create table sizes (id uuid primary key default gen_random_uuid(), name text not null, sort_order int default 0);

create table product_images(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  view_id uuid references product_views(id),
  color_id uuid references colors(id),
  s3_key text not null,
  url text,
  width_px int,
  height_px int,
  is_flat boolean default false,
  is_model boolean default false,
  is_primary boolean default false,
  checksum text,
  created_at timestamptz default now()
);
create index on product_images(product_id, view_id, color_id);
create index on product_images(product_id, is_flat desc, is_primary desc);

create table variants(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  color_id uuid references colors(id),
  size_id uuid references sizes(id),
  supplier_sku text,
  upc text,
  gtin text,
  weight_lb numeric(8,3),
  active boolean default true,
  unique(product_id,color_id,size_id)
);

create table pricing_tiers(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  min_qty int not null,
  max_qty int,
  price numeric(10,2) not null
);
create index on pricing_tiers(product_id,min_qty);

create table warehouses(
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  city text, state text, country text
);

create table inventory(
  variant_id uuid not null references variants(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  as_of timestamptz not null,
  qty int not null,
  primary key(variant_id,warehouse_id,as_of)
);
create index on inventory(variant_id,as_of desc);

create table scales(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  view_id uuid references product_views(id),
  size_id uuid references sizes(id),
  px_per_in numeric(10,4) not null,
  unique(product_id, view_id, size_id)
);

create table customers(
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  name text,
  company text
);

create table logos(
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  s3_key text not null,
  url text,
  width_px int,
  height_px int,
  checksum text,
  created_at timestamptz default now()
);

create table quotes(
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  status text default 'draft',
  created_at timestamptz default now()
);

create table quote_versions(
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  name text,
  created_at timestamptz default now()
);

create table designs(
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references quote_versions(id) on delete cascade,
  product_id uuid not null references products(id),
  variant_id uuid references variants(id),
  view_id uuid references product_views(id),
  logo_id uuid not null references logos(id),
  px_box_x1 numeric(12,4), px_box_y1 numeric(12,4), px_box_x2 numeric(12,4), px_box_y2 numeric(12,4),
  rotation_deg int default 0,
  px_per_in numeric(10,4),
  printer_spec jsonb,
  created_at timestamptz default now()
);
create index on designs(version_id);
create index on designs(product_id,view_id);
