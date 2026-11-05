-- Chạy toàn bộ file này trong Supabase: SQL Editor -> New query -> Run
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  plate text not null unique,
  vin text,
  vehicle_type text not null default 'Xe máy điện',
  model text,
  created_at timestamptz not null default now()
);

create table if not exists repair_orders (
  id uuid primary key default gen_random_uuid(),
  code bigint generated always as identity,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  received_at timestamptz not null default now(),
  odometer integer,
  issue text not null,
  status text not null default 'Chờ xử lý',
  note text,
  created_at timestamptz not null default now()
);

alter table customers enable row level security;
alter table vehicles enable row level security;
alter table repair_orders enable row level security;

-- Chỉ người đã đăng nhập mới xem/sửa được dữ liệu
create policy "nv_customers" on customers for all to authenticated using (true) with check (true);
create policy "nv_vehicles" on vehicles for all to authenticated using (true) with check (true);
create policy "nv_orders" on repair_orders for all to authenticated using (true) with check (true);
