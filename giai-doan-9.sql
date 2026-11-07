-- GIAI ĐOẠN 9: Mở chỉnh sửa phiếu đã hoàn thành (có nhật ký) + địa chỉ khách hàng
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không trừ/cộng kho thêm).
-- Cần đã chạy giai-doan-4.sql (có hàm vai_tro, la_chu, bảng part_costs, repair_item_costs).
--
--  * Địa chỉ khách: thêm cột address (không bắt buộc) nếu chưa có.
--  * Phiếu ĐÃ hoàn thành / đã giao xe: chỉ Chủ xưởng sửa, và CHỈ qua 3 hàm bên dưới
--    (thêm phụ tùng -> tự trừ kho; thêm tiền công; xóa dòng -> tự cộng lại kho nếu là phụ tùng).
--  * Mỗi lần sửa ghi 1 dòng nhật ký (ai, lúc nào, thêm/xóa món gì, tổng trước và sau).
--  * Nhật ký không ai sửa/xóa được từ ứng dụng; chỉ Chủ xem được.
--  * Một chốt chặn ở bảng repair_items: sửa trực tiếp dòng của phiếu đã thu tiền
--    (kể cả Chủ) bị từ chối -> không thể sửa "im lặng" ngoài nhật ký.

-- 1. Địa chỉ khách hàng -----------------------------------------------------
alter table public.customers add column if not exists address text;

-- 2. Bảng nhật ký --------------------------------------------------------------
create table if not exists public.repair_edit_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  action text not null check (action in ('them','xoa')),
  kind text not null check (kind in ('part','labor')),
  item_name text not null,
  qty numeric(12,2) not null,
  unit_price numeric(14,0) not null,
  total_before numeric(16,0) not null,
  total_after numeric(16,0) not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists repair_edit_logs_order_idx on public.repair_edit_logs(order_id, created_at desc);

alter table public.repair_edit_logs enable row level security;
revoke all on public.repair_edit_logs from anon;
revoke all on public.repair_edit_logs from authenticated;
grant select on public.repair_edit_logs to authenticated;   -- chỉ xem; ghi đi qua hàm
drop policy if exists nk_chi_chu_xem on public.repair_edit_logs;
create policy nk_chi_chu_xem on public.repair_edit_logs for select to authenticated using (public.la_chu());

-- 3. Chốt chặn: dòng báo giá của phiếu đã thu tiền chỉ sửa được qua 3 hàm dưới --
create or replace function public.chan_sua_dong_phieu_da_thu() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_order uuid; v_done boolean;
begin
  v_order := case when tg_op = 'INSERT' then new.order_id else old.order_id end;
  select stock_deducted into v_done from public.repair_orders where id = v_order;
  -- phiếu không còn (đang xóa phiếu/khách theo dây chuyền) hoặc chưa thu tiền -> cho qua
  if v_done is not true then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- xóa phụ tùng khỏi danh mục chỉ làm part_id = null: cho qua
  if tg_op = 'UPDATE' and new.order_id = old.order_id and new.kind = old.kind and new.name = old.name
     and new.qty = old.qty and new.unit_price = old.unit_price then
    return new;
  end if;
  if coalesce(current_setting('app.sua_phieu', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Phiếu đã hoàn thành: hãy bấm "Mở chỉnh sửa" trong phiếu để sửa (có ghi nhật ký)';
end $$;
drop trigger if exists chan_sua_dong_phieu_da_thu on public.repair_items;
create trigger chan_sua_dong_phieu_da_thu before insert or update or delete on public.repair_items
  for each row execute function public.chan_sua_dong_phieu_da_thu();

-- 4. Ba hàm sửa phiếu đã hoàn thành (chỉ Chủ) -----------------------------------
-- Trả về jsonb {"truoc": tổng trước, "sau": tổng sau}

create or replace function public.sua_phieu_them_phu_tung(p_order uuid, p_part uuid, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; p record; v_before numeric; v_after numeric; v_item uuid;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được sửa phiếu đã hoàn thành'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Số lượng phải lớn hơn 0'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if not o.stock_deducted then raise exception 'Phiếu chưa hoàn thành: sửa trực tiếp, không cần mở chỉnh sửa'; end if;
  select * into p from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  if p.stock < p_qty then raise exception 'Không đủ tồn kho cho phụ tùng: % (còn %)', p.name, p.stock; end if;

  select coalesce(sum(qty * unit_price), 0) into v_before from public.repair_items where order_id = p_order;
  perform set_config('app.sua_phieu', '1', true);
  update public.parts set stock = stock - p_qty where id = p.id;
  insert into public.repair_items (order_id, part_id, kind, name, qty, unit_price)
    values (p_order, p.id, 'part', p.name, p_qty, p.sale_price) returning id into v_item;
  insert into public.repair_item_costs (item_id, cost_price)
    values (v_item, coalesce((select cost_price from public.part_costs where part_id = p.id), 0));
  perform set_config('app.sua_phieu', '', true);
  select coalesce(sum(qty * unit_price), 0) into v_after from public.repair_items where order_id = p_order;

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (p_order, 'them', 'part', p.name, p_qty, p.sale_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;

create or replace function public.sua_phieu_them_cong(p_order uuid, p_name text, p_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; v_before numeric; v_after numeric; v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được sửa phiếu đã hoàn thành'; end if;
  if v_name = '' then raise exception 'Hãy nhập tên tiền công'; end if;
  if p_price is null or p_price < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if not o.stock_deducted then raise exception 'Phiếu chưa hoàn thành: sửa trực tiếp, không cần mở chỉnh sửa'; end if;

  select coalesce(sum(qty * unit_price), 0) into v_before from public.repair_items where order_id = p_order;
  perform set_config('app.sua_phieu', '1', true);
  insert into public.repair_items (order_id, kind, name, qty, unit_price)
    values (p_order, 'labor', v_name, 1, round(p_price));
  perform set_config('app.sua_phieu', '', true);
  select coalesce(sum(qty * unit_price), 0) into v_after from public.repair_items where order_id = p_order;

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (p_order, 'them', 'labor', v_name, 1, round(p_price), v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;

create or replace function public.sua_phieu_xoa_dong(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; o record; v_before numeric; v_after numeric;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được sửa phiếu đã hoàn thành'; end if;
  select * into it from public.repair_items where id = p_item;
  if not found then raise exception 'Không tìm thấy dòng cần xóa (có thể đã bị xóa)'; end if;
  select * into o from public.repair_orders where id = it.order_id for update;
  if not o.stock_deducted then raise exception 'Phiếu chưa hoàn thành: sửa trực tiếp, không cần mở chỉnh sửa'; end if;
  select * into it from public.repair_items where id = p_item for update;   -- đọc lại sau khi khóa phiếu
  if not found then raise exception 'Dòng này vừa bị xóa rồi'; end if;

  select coalesce(sum(qty * unit_price), 0) into v_before from public.repair_items where order_id = o.id;
  perform set_config('app.sua_phieu', '1', true);
  if it.kind = 'part' and it.part_id is not null then
    update public.parts set stock = stock + it.qty where id = it.part_id;   -- cộng lại tồn kho
  end if;
  delete from public.repair_items where id = p_item;
  perform set_config('app.sua_phieu', '', true);
  select coalesce(sum(qty * unit_price), 0) into v_after from public.repair_items where order_id = o.id;

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (o.id, 'xoa', it.kind, it.name, it.qty, it.unit_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;

revoke execute on function public.chan_sua_dong_phieu_da_thu() from public, anon, authenticated;
revoke execute on function public.sua_phieu_them_phu_tung(uuid, uuid, numeric) from public, anon;
revoke execute on function public.sua_phieu_them_cong(uuid, text, numeric) from public, anon;
revoke execute on function public.sua_phieu_xoa_dong(uuid) from public, anon;
grant execute on function public.sua_phieu_them_phu_tung(uuid, uuid, numeric) to authenticated;
grant execute on function public.sua_phieu_them_cong(uuid, text, numeric) to authenticated;
grant execute on function public.sua_phieu_xoa_dong(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra: phải hiện da_bat_bao_mat = true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables where schemaname = 'public' and tablename = 'repair_edit_logs';
