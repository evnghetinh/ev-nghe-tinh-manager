-- GIAI ĐOẠN 8: Nhập hàng (tải Excel/CSV, xem trước, xác nhận mới lưu) + lịch sử nhập
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu).
--
--  * CHỈ Chủ xưởng đọc/ghi được lịch sử nhập và dùng hàm nhap_hang (có giá nhập).
--  * Nhập hàng chạy trong 1 giao dịch: lỗi ở bất kỳ dòng nào thì KHÔNG lưu gì cả.
--  * Món đã có (trùng mã, hoặc không có mã nhưng trùng tên) -> cộng tồn kho + cập nhật giá nhập
--    (giá bán chỉ đổi khi file có giá bán > 0). Món mới -> tạo mới trong Phụ tùng.
--  * Cần đã chạy giai-doan-4.sql (có hàm vai_tro, la_chu, bảng part_costs).

-- 1. Bảng lịch sử ------------------------------------------------------------
create table if not exists public.stock_imports (
  id uuid primary key default gen_random_uuid(),
  imported_on date not null default current_date,
  supplier text check (supplier is null or char_length(supplier) <= 200),
  note text check (note is null or char_length(note) <= 500),
  item_count int not null default 0,
  total numeric(16,0) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists stock_imports_date_idx on public.stock_imports(imported_on desc, created_at desc);

create table if not exists public.stock_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.stock_imports(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  name text not null,
  code text,
  qty numeric(12,2) not null check (qty > 0),
  cost_price numeric(14,0) not null default 0 check (cost_price >= 0),
  sale_price numeric(14,0) check (sale_price is null or sale_price >= 0),
  is_new boolean not null default false
);
create index if not exists stock_import_items_import_idx on public.stock_import_items(import_id);

-- 2. RLS: chỉ Chủ -------------------------------------------------------------
alter table public.stock_imports enable row level security;
alter table public.stock_import_items enable row level security;
revoke all on public.stock_imports from anon;
revoke all on public.stock_import_items from anon;
revoke all on public.stock_imports from authenticated;
revoke all on public.stock_import_items from authenticated;
-- Chỉ được xem; việc ghi đi qua hàm nhap_hang (không ai sửa/xóa lịch sử từ ứng dụng)
grant select on public.stock_imports to authenticated;
grant select on public.stock_import_items to authenticated;

drop policy if exists nh_chi_chu_xem on public.stock_imports;
create policy nh_chi_chu_xem on public.stock_imports for select to authenticated using (public.la_chu());
drop policy if exists nh_chi_chu_xem on public.stock_import_items;
create policy nh_chi_chu_xem on public.stock_import_items for select to authenticated using (public.la_chu());

-- 3. Hàm nhập hàng (một giao dịch, chỉ Chủ) -----------------------------------
-- p_items: [{"name":"...","code":"...","qty":5,"cost_price":120000,"sale_price":180000}, ...]
create or replace function public.nhap_hang(p_supplier text, p_date date, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; it jsonb; v_part uuid; v_new boolean;
  v_name text; v_code text; v_qty numeric; v_cost numeric; v_sale numeric;
  v_total numeric := 0; v_n int := 0;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được nhập hàng'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Danh sách hàng nhập trống';
  end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'Tối đa 1000 dòng mỗi lần nhập'; end if;

  insert into public.stock_imports (imported_on, supplier, note, created_by, created_by_name)
  values (coalesce(p_date, current_date), nullif(btrim(p_supplier), ''), nullif(btrim(p_note), ''), auth.uid(),
          coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(it->>'name', ''));
    v_code := nullif(btrim(coalesce(it->>'code', '')), '');
    v_qty  := (it->>'qty')::numeric;
    v_cost := coalesce((it->>'cost_price')::numeric, 0);
    v_sale := nullif(it->>'sale_price', '')::numeric;
    if v_name = '' then raise exception 'Có dòng thiếu tên hàng'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Số lượng không hợp lệ ở món: %', v_name; end if;
    if v_cost < 0 or (v_sale is not null and v_sale < 0) then raise exception 'Giá không hợp lệ ở món: %', v_name; end if;
    v_cost := round(v_cost); v_sale := round(v_sale);

    v_part := null;
    if v_code is not null then
      select id into v_part from public.parts where lower(code) = lower(v_code) for update;
    else
      select id into v_part from public.parts
      where lower(btrim(name)) = lower(v_name) and (code is null or code = '')
      order by created_at limit 1 for update;
    end if;

    if v_part is not null then
      v_new := false;
      update public.parts set stock = stock + v_qty,
        sale_price = case when v_sale is not null and v_sale > 0 then v_sale else sale_price end
      where id = v_part;
    else
      v_new := true;
      insert into public.parts (name, code, sale_price, stock)
      values (v_name, v_code, coalesce(v_sale, 0), v_qty) returning id into v_part;
    end if;
    insert into public.part_costs (part_id, cost_price) values (v_part, v_cost)
    on conflict (part_id) do update set cost_price = excluded.cost_price;

    insert into public.stock_import_items (import_id, part_id, name, code, qty, cost_price, sale_price, is_new)
    values (v_id, v_part, v_name, v_code, v_qty, v_cost, v_sale, v_new);
    v_total := v_total + v_qty * v_cost; v_n := v_n + 1;
  end loop;

  update public.stock_imports set item_count = v_n, total = round(v_total) where id = v_id;
  return v_id;
end $$;
revoke execute on function public.nhap_hang(text, date, text, jsonb) from public, anon;
grant execute on function public.nhap_hang(text, date, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra: cả hai bảng phải hiện da_bat_bao_mat = true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables
where schemaname = 'public' and tablename in ('stock_imports','stock_import_items')
order by tablename;
