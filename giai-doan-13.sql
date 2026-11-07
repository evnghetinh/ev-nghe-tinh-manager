-- GIAI ĐOẠN 13: Sổ kho nhập xuất cho phụ tùng
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không tạo trùng dòng "tồn đầu kỳ").
-- Cần đã chạy giai-doan-4, 8, 9, 12 (có la_chu, vai_tro, nhap_hang, sửa phiếu, ten_nguoi_dung).
--
--  * Bảng stock_ledger: mỗi lần đổi tồn = 1 dòng (không ai sửa/xóa được, kể cả Chủ).
--  * MỌI thay đổi tồn đi qua 1 hàm duy nhất doi_ton() - đổi tồn và ghi sổ trong cùng giao dịch.
--    Sửa thẳng cột parts.stock bị chặn (mọi tài khoản, kể cả Chủ).
--  * Nhân viên xem được sổ kho (không có giá nhập). Chỉ Chủ: kiểm kê, đối chiếu, khách trả hàng.
--
--  Muốn sửa tồn: dùng ứng dụng (Phụ tùng -> chi tiết -> Kiểm kê điều chỉnh).

-- 1. Sổ kho -----------------------------------------------------------------------
create table if not exists public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  part_id uuid references public.parts(id) on delete set null,
  part_name text not null,
  part_code text,
  loai text not null check (loai in ('ton_dau','nhap_hang','xuat_phieu','them_khi_sua','xoa_khi_sua','khach_tra','kiem_ke')),
  so_luong numeric(12,2) not null check (so_luong <> 0),   -- + là nhập thêm, - là xuất
  ton_sau numeric(12,2) not null,
  order_id uuid references public.repair_orders(id) on delete set null,
  order_code int,
  import_id uuid references public.stock_imports(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  ghi_chu text check (ghi_chu is null or char_length(ghi_chu) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists stock_ledger_part_idx on public.stock_ledger(part_id, seq desc);
create index if not exists stock_ledger_order_idx on public.stock_ledger(order_id);

-- Chỉ thêm dòng: chặn sửa/xóa/truncate. Ngoại lệ duy nhất: khi xóa phụ tùng/phiếu/lần nhập,
-- cột liên kết tự về null (tên + mã + số phiếu đã lưu sẵn trên dòng sổ).
create or replace function public.stock_ledger_chi_them() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'part_id' - 'order_id' - 'import_id') = (to_jsonb(old) - 'part_id' - 'order_id' - 'import_id')
       and (new.part_id is null or new.part_id is not distinct from old.part_id)
       and (new.order_id is null or new.order_id is not distinct from old.order_id)
       and (new.import_id is null or new.import_id is not distinct from old.import_id) then
      return new;
    end if;
  end if;
  raise exception 'Sổ kho chỉ được thêm dòng, không sửa hoặc xóa';
end $$;
revoke execute on function public.stock_ledger_chi_them() from public, anon, authenticated;
drop trigger if exists stock_ledger_chi_them on public.stock_ledger;
create trigger stock_ledger_chi_them before update or delete on public.stock_ledger
  for each row execute function public.stock_ledger_chi_them();
drop trigger if exists stock_ledger_chan_truncate on public.stock_ledger;
create trigger stock_ledger_chan_truncate before truncate on public.stock_ledger
  for each statement execute function public.stock_ledger_chi_them();

alter table public.stock_ledger enable row level security;
revoke all on public.stock_ledger from anon;
revoke all on public.stock_ledger from authenticated;
grant select on public.stock_ledger to authenticated;          -- chỉ xem; ghi đi qua hàm
drop policy if exists sk_xem on public.stock_ledger;
create policy sk_xem on public.stock_ledger for select to authenticated using (public.vai_tro() is not null);

-- 2. Tồn đầu kỳ cho dữ liệu đang có (chỉ phụ tùng chưa có dòng nào trong sổ) ------------
insert into public.stock_ledger (part_id, part_name, part_code, loai, so_luong, ton_sau, created_by_name, ghi_chu)
select p.id, p.name, p.code, 'ton_dau', p.stock, p.stock, 'Hệ thống', 'Tồn đầu kỳ (lúc bắt đầu dùng sổ kho)'
from public.parts p
where p.stock <> 0 and not exists (select 1 from public.stock_ledger l where l.part_id = p.id);

-- 3. Hàm DUY NHẤT đổi tồn ----------------------------------------------------------
-- Chỉ các hàm nghiệp vụ bên dưới gọi được; giao diện không gọi trực tiếp.
create or replace function public.doi_ton(p_part uuid, p_delta numeric, p_loai text,
                                          p_order uuid default null, p_import uuid default null, p_ghi_chu text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare p record; v_code int; v_new numeric;
begin
  if p_delta is null or p_delta = 0 then raise exception 'Số lượng thay đổi phải khác 0'; end if;
  select * into p from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  v_new := p.stock + p_delta;
  if v_new < 0 then raise exception 'Không đủ tồn kho cho phụ tùng: % (còn %)', p.name, p.stock; end if;
  if p_order is not null then select code into v_code from public.repair_orders where id = p_order; end if;

  perform set_config('app.doi_ton', '1', true);
  update public.parts set stock = v_new where id = p.id;
  perform set_config('app.doi_ton', '', true);

  insert into public.stock_ledger (part_id, part_name, part_code, loai, so_luong, ton_sau, order_id, order_code, import_id,
                                   created_by, created_by_name, ghi_chu)
  values (p.id, p.name, p.code, p_loai, p_delta, v_new, p_order, v_code, p_import, auth.uid(),
          coalesce(public.ten_nguoi_dung(auth.uid()), (select email from auth.users where id = auth.uid()), 'Không rõ'),
          nullif(btrim(p_ghi_chu), ''));
  return v_new;
end $$;
revoke execute on function public.doi_ton(uuid, numeric, text, uuid, uuid, text) from public, anon, authenticated;

-- Chốt chặn: cột tồn chỉ đổi được khi đi qua doi_ton()
create or replace function public.parts_chan_sua_ton() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.doi_ton', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if new.stock is distinct from 0 then
      raise exception 'Không nhập tồn trực tiếp: hãy tạo phụ tùng rồi đặt tồn đầu (sổ kho sẽ ghi lại)';
    end if;
  elsif new.stock is distinct from old.stock then
    raise exception 'Không sửa tồn trực tiếp: dùng Nhập hàng, Kiểm kê điều chỉnh hoặc Khách trả hàng (có ghi sổ kho)';
  end if;
  return new;
end $$;
revoke execute on function public.parts_chan_sua_ton() from public, anon, authenticated;
drop trigger if exists parts_chan_sua_ton on public.parts;
create trigger parts_chan_sua_ton before insert or update on public.parts
  for each row execute function public.parts_chan_sua_ton();

-- 4. Các hàm nghiệp vụ dùng doi_ton -----------------------------------------------

-- 4a. Đặt tồn đầu cho phụ tùng mới tạo (chỉ khi chưa có dòng nào trong sổ)
create or replace function public.dat_ton_dau(p_part uuid, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Số lượng phải lớn hơn 0'; end if;
  perform 1 from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  if exists (select 1 from public.stock_ledger where part_id = p_part) then
    raise exception 'Phụ tùng này đã có lịch sử kho: dùng Nhập hàng hoặc Kiểm kê điều chỉnh';
  end if;
  perform public.doi_ton(p_part, p_qty, 'ton_dau', null, null, 'Tồn đầu khi tạo phụ tùng');
end $$;

-- 4b. Hoàn thành phiếu (trừ kho)
create or replace function public.hoan_thanh_phieu(p_order uuid, p_method text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare o record; r record;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_method not in ('Tiền mặt','Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.stock_deducted then raise exception 'Phiếu này đã hoàn thành và thu tiền rồi'; end if;

  for r in select part_id, sum(qty) as qty from public.repair_items
           where order_id = p_order and kind = 'part' and part_id is not null group by part_id order by part_id loop
    perform public.doi_ton(r.part_id, -r.qty, 'xuat_phieu', p_order, null, null);
  end loop;

  insert into public.repair_item_costs (item_id, cost_price)
    select i.id, coalesce(c.cost_price, 0)
    from public.repair_items i left join public.part_costs c on c.part_id = i.part_id
    where i.order_id = p_order and i.kind = 'part'
  on conflict (item_id) do update set cost_price = excluded.cost_price;

  update public.repair_orders set status = 'Hoàn thành', payment_method = p_method,
    paid_at = coalesce(p_date, current_date), stock_deducted = true where id = p_order;
end $$;
revoke execute on function public.hoan_thanh_phieu(uuid, text, date) from public, anon;
grant execute on function public.hoan_thanh_phieu(uuid, text, date) to authenticated;

-- 4c. Nhập hàng từ file
create or replace function public.nhap_hang(p_supplier text, p_date date, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; it jsonb; v_part uuid; v_new boolean;
  v_name text; v_code text; v_qty numeric; v_cost numeric; v_sale numeric;
  v_total numeric := 0; v_n int := 0; v_ncc text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được nhập hàng'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Danh sách hàng nhập trống';
  end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'Tối đa 1000 dòng mỗi lần nhập'; end if;
  v_ncc := nullif(btrim(p_supplier), '');

  insert into public.stock_imports (imported_on, supplier, note, created_by, created_by_name)
  values (coalesce(p_date, current_date), v_ncc, nullif(btrim(p_note), ''), auth.uid(),
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
      update public.parts set
        sale_price = case when v_sale is not null and v_sale > 0 then v_sale else sale_price end
      where id = v_part;
    else
      v_new := true;
      insert into public.parts (name, code, sale_price, stock)
      values (v_name, v_code, coalesce(v_sale, 0), 0) returning id into v_part;
    end if;
    perform public.doi_ton(v_part, v_qty, 'nhap_hang', null, v_id, case when v_ncc is null then null else 'NCC: ' || v_ncc end);
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

-- 4d. Sửa phiếu đã hoàn thành: thêm phụ tùng (trừ kho) / xóa dòng (cộng lại kho)
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
  perform public.doi_ton(p.id, -p_qty, 'them_khi_sua', p_order, null, 'Thêm phụ tùng khi sửa phiếu đã hoàn thành');
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
    perform public.doi_ton(it.part_id, it.qty, 'xoa_khi_sua', o.id, null, 'Xóa phụ tùng khi sửa phiếu đã hoàn thành');
  end if;
  delete from public.repair_items where id = p_item;
  perform set_config('app.sua_phieu', '', true);
  select coalesce(sum(qty * unit_price), 0) into v_after from public.repair_items where order_id = o.id;

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (o.id, 'xoa', it.kind, it.name, it.qty, it.unit_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;

revoke execute on function public.sua_phieu_them_phu_tung(uuid, uuid, numeric) from public, anon;
revoke execute on function public.sua_phieu_xoa_dong(uuid) from public, anon;
grant execute on function public.sua_phieu_them_phu_tung(uuid, uuid, numeric) to authenticated;
grant execute on function public.sua_phieu_xoa_dong(uuid) to authenticated;

-- 5. Kiểm kê điều chỉnh (chỉ Chủ) ---------------------------------------------------
-- p_ton_thay: số tồn người dùng thấy trên màn hình; nếu đã đổi trong lúc đó thì từ chối.
create or replace function public.kiem_ke(p_part uuid, p_dem numeric, p_ton_thay numeric, p_ly_do text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_lech numeric; v_ly_do text := btrim(coalesce(p_ly_do, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được kiểm kê điều chỉnh'; end if;
  if p_dem is null or p_dem < 0 then raise exception 'Số đếm thực tế không hợp lệ'; end if;
  if v_ly_do = '' then raise exception 'Bắt buộc nhập lý do điều chỉnh'; end if;
  select * into p from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  if p_ton_thay is distinct from p.stock then
    raise exception 'Tồn kho vừa thay đổi (nay là %). Hãy tải lại trang rồi kiểm kê lại', p.stock;
  end if;
  v_lech := p_dem - p.stock;
  if v_lech = 0 then raise exception 'Số đếm bằng tồn hiện tại, không có chênh lệch để điều chỉnh'; end if;
  perform public.doi_ton(p.id, v_lech, 'kiem_ke', null, null, v_ly_do);
  return jsonb_build_object('truoc', p.stock, 'sau', p_dem, 'lech', v_lech);
end $$;
revoke execute on function public.kiem_ke(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.kiem_ke(uuid, numeric, numeric, text) to authenticated;

-- 6. Đối chiếu tồn kho (chỉ Chủ): liệt kê phụ tùng có tồn khác tổng các dòng sổ -----------
create or replace function public.doi_chieu_ton()
returns table (part_id uuid, ten text, ma text, ton_hien_tai numeric, tong_so numeric, lech numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đối chiếu tồn kho'; end if;
  return query
    select p.id, p.name, p.code, p.stock, coalesce(s.t, 0), p.stock - coalesce(s.t, 0)
    from public.parts p
    left join (select l.part_id as pid, sum(l.so_luong) as t from public.stock_ledger l group by l.part_id) s on s.pid = p.id
    where p.stock <> coalesce(s.t, 0)
    order by p.name;
end $$;
revoke execute on function public.doi_chieu_ton() from public, anon;
grant execute on function public.doi_chieu_ton() to authenticated;

-- 7. Khách trả hàng (chỉ Chủ) ---------------------------------------------------------
-- Cộng lại tồn + ghi sổ kho + giảm số lượng dòng trong phiếu (doanh thu giảm theo) + nhật ký phiếu.
-- Trả hết số lượng của dòng thì dòng bị bỏ khỏi phiếu.
alter table public.repair_edit_logs add column if not exists ghi_chu text;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.repair_edit_logs'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%action%' and conname <> 'repair_edit_logs_action_ok' loop
    execute format('alter table public.repair_edit_logs drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.repair_edit_logs'::regclass and conname = 'repair_edit_logs_action_ok') then
    alter table public.repair_edit_logs add constraint repair_edit_logs_action_ok check (action in ('them','xoa','tra'));
  end if;
end $$;

create or replace function public.khach_tra_hang(p_item uuid, p_qty numeric, p_ly_do text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; o record; v_before numeric; v_after numeric; v_ly_do text := btrim(coalesce(p_ly_do, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được nhận khách trả hàng'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Số lượng trả phải lớn hơn 0'; end if;
  if v_ly_do = '' then raise exception 'Hãy nhập lý do trả hàng'; end if;
  select * into it from public.repair_items where id = p_item;
  if not found then raise exception 'Không tìm thấy dòng trong phiếu'; end if;
  select * into o from public.repair_orders where id = it.order_id for update;
  if not o.stock_deducted then raise exception 'Phiếu chưa hoàn thành: chỉ cần xóa dòng, không cần trả hàng'; end if;
  select * into it from public.repair_items where id = p_item for update;
  if not found then raise exception 'Dòng này vừa bị xóa rồi'; end if;
  if it.kind <> 'part' or it.part_id is null then raise exception 'Chỉ trả được dòng phụ tùng còn trong danh mục'; end if;
  if p_qty > it.qty then raise exception 'Số lượng trả (%) lớn hơn số lượng trong phiếu (%)', p_qty, it.qty; end if;

  select coalesce(sum(qty * unit_price), 0) into v_before from public.repair_items where order_id = o.id;
  perform set_config('app.sua_phieu', '1', true);
  perform public.doi_ton(it.part_id, p_qty, 'khach_tra', o.id, null, v_ly_do);
  if p_qty = it.qty then
    delete from public.repair_items where id = it.id;
  else
    update public.repair_items set qty = qty - p_qty where id = it.id;
  end if;
  perform set_config('app.sua_phieu', '', true);
  select coalesce(sum(qty * unit_price), 0) into v_after from public.repair_items where order_id = o.id;

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name, ghi_chu)
    values (o.id, 'tra', 'part', it.name, p_qty, it.unit_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'), v_ly_do);
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;
revoke execute on function public.khach_tra_hang(uuid, numeric, text) from public, anon;
grant execute on function public.khach_tra_hang(uuid, numeric, text) to authenticated;

revoke execute on function public.dat_ton_dau(uuid, numeric) from public, anon;
grant execute on function public.dat_ton_dau(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra: da_bat_bao_mat = true; so_dong_so_kho >= số phụ tùng đang có tồn; so_mon_lech phải = 0
select
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'stock_ledger') as da_bat_bao_mat,
  (select count(*) from public.stock_ledger) as so_dong_so_kho,
  (select count(*) from public.parts p
    where p.stock <> coalesce((select sum(so_luong) from public.stock_ledger l where l.part_id = p.id), 0)) as so_mon_lech;
