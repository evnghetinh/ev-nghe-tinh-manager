-- GIAI ĐOẠN 2: Phụ tùng + báo giá cho phiếu tiếp nhận
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không báo lỗi).

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  cost_price numeric(14,0) not null default 0 check (cost_price >= 0),
  sale_price numeric(14,0) not null default 0 check (sale_price >= 0),
  stock numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists parts_code_unique on public.parts (lower(code)) where code is not null and code <> '';

-- Dòng báo giá của phiếu: phụ tùng hoặc tiền công (lưu giá tại thời điểm báo)
create table if not exists public.repair_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  kind text not null default 'part' check (kind in ('part','labor')),
  name text not null,
  qty numeric(12,2) not null default 1 check (qty > 0),
  unit_price numeric(14,0) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index if not exists repair_items_order_idx on public.repair_items (order_id);

-- BẬT BẢO MẬT (RLS): chỉ người đã đăng nhập được đọc và ghi
do $$
declare t text;
begin
  foreach t in array array['parts','repair_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'chi_nguoi_dang_nhap', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', 'chi_nguoi_dang_nhap', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Kiểm tra: cả hai bảng phải hiện true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables where schemaname = 'public' and tablename in ('parts','repair_items');
