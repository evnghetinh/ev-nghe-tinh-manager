-- Chạy toàn bộ file này trong Supabase: SQL Editor -> New query -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không báo lỗi).
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  plate text not null unique,
  vin text,
  vehicle_type text not null default 'Xe máy điện',
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.repair_orders (
  id uuid primary key default gen_random_uuid(),
  code bigint generated always as identity,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  received_at timestamptz not null default now(),
  odometer integer,
  issue text not null,
  status text not null default 'Chờ xử lý',
  note text,
  created_at timestamptz not null default now()
);

-- BẬT BẢO MẬT (RLS) CHO MỌI BẢNG: chỉ người đã đăng nhập được đọc và ghi
do $$
declare t text;
begin
  foreach t in array array['customers','vehicles','repair_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'chi_nguoi_dang_nhap', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', 'chi_nguoi_dang_nhap', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Làm mới bộ nhớ đệm API của Supabase để thấy bảng mới ngay
notify pgrst, 'reload schema';
