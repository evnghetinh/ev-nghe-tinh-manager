-- GIAI ĐOẠN 11: Vốn và thu hồi vốn (chỉ Chủ xưởng thấy và dùng được)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu). Cần đã chạy giai-doan-4.sql (có hàm la_chu).
--
--  * von_chi_phi_mo_xuong : khoản đầu tư ban đầu
--  * von_gop              : người góp vốn
--  * von_chi_phi_van_hanh : chi phí vận hành theo tháng
--  * von_loi_nhuan_cu     : lợi nhuận nhập tay của các tháng trước khi dùng app
--  * von_cai_dat          : ngày bắt đầu tính thu hồi vốn (1 dòng)
--  Tất cả bật RLS: chỉ Chủ đọc/ghi được. Nhân viên đọc ra rỗng, ghi bị từ chối.

create table if not exists public.von_chi_phi_mo_xuong (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  category text not null check (btrim(category) <> ''),
  amount numeric(14,0) not null check (amount >= 0),
  paid_by text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.von_gop (
  id uuid primary key default gen_random_uuid(),
  contributor text not null check (btrim(contributor) <> ''),
  amount numeric(14,0) not null check (amount > 0),
  contributed_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.von_chi_phi_van_hanh (
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),   -- ngày 1 của tháng
  kind text not null check (kind in ('thue_mat_bang','dien_nuoc','luong','internet','khac')),
  amount numeric(14,0) not null check (amount >= 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists von_van_hanh_month_idx on public.von_chi_phi_van_hanh(month);

create table if not exists public.von_loi_nhuan_cu (
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),
  amount numeric(14,0) not null,                 -- có thể âm (lỗ)
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.von_cai_dat (
  id boolean primary key default true check (id),   -- chỉ 1 dòng
  start_date date not null default current_date
);

-- Bật RLS + chỉ Chủ ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu','von_cai_dat'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists chi_chu_dung on public.%I', t);
    execute format('create policy chi_chu_dung on public.%I for all to authenticated using (public.la_chu()) with check (public.la_chu())', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Kiểm tra: cả 5 dòng phải hiện da_bat_bao_mat = true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables where schemaname = 'public'
  and tablename in ('von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu','von_cai_dat');
