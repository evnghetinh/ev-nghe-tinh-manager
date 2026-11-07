-- GIAI ĐOẠN 16: Đơn vị quy đổi cho phụ tùng (nhập theo can, bán lẻ theo lít...)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không tạo trùng).
-- Cần đã chạy giai-doan-4, 8, 9, 10b, 12, 13, 15.
--
--  * Mỗi phụ tùng có: đơn vị nhập (don_vi_nhap), đơn vị bán/trừ kho (don_vi_ban), hệ số (he_so):
--    1 đơn vị nhập = he_so đơn vị bán. Phụ tùng đang có giữ nguyên "cái", hệ số 1.
--  * Tồn, số lượng phiếu, sổ kho đều tính theo ĐƠN VỊ BÁN, cho phép tối đa 3 chữ số thập phân.
--    Chỉ nới rộng kiểu dữ liệu (numeric(12,2) -> numeric(14,3)), số cũ giữ nguyên.
--  * Giá bán theo đơn vị bán. Giá vốn mỗi đơn vị bán = giá nhập 1 đơn vị nhập / hệ số (giữ 4 số lẻ).
--  * Nhập hàng chọn đơn vị nhập hoặc đơn vị bán; nhập theo đơn vị nhập thì tự nhân hệ số vào tồn.
--  * Chủ có hàm doi_don_vi(): nhân tồn theo hệ số, ghi 1 dòng "Đổi đơn vị" vào sổ kho,
--    chia giá vốn, đổi giá bán. Phiếu cũ giữ nguyên số liệu (đã chụp sẵn đơn vị lúc lập phiếu).
--  * Nhân viên không thấy giá nhập / giá vốn (bảng part_costs, repair_item_costs, stock_import_items vẫn chỉ Chủ đọc).

-- 1. Nới rộng kiểu dữ liệu (chỉ chạy khi chưa đúng kiểu; không mất số liệu) -----------------
do $$
declare x record; cur record;
begin
  for x in select * from (values
      ('parts','stock',14,3), ('parts','min_stock',14,3),
      ('repair_items','qty',14,3), ('stock_import_items','qty',14,3), ('repair_edit_logs','qty',14,3),
      ('stock_ledger','so_luong',14,3), ('stock_ledger','ton_sau',14,3),
      ('part_costs','cost_price',16,4), ('repair_item_costs','cost_price',16,4),
      ('stock_import_items','cost_price',16,4), ('stock_import_items','gia_nhap_truoc',16,4)
    ) as v(t, c, p, s) loop
    select numeric_precision as p, numeric_scale as s into cur
      from information_schema.columns where table_schema = 'public' and table_name = x.t and column_name = x.c;
    if found and (cur.p is distinct from x.p or cur.s is distinct from x.s) then
      execute format('alter table public.%I alter column %I type numeric(%s,%s)', x.t, x.c, x.p, x.s);
    end if;
  end loop;
end $$;

-- 2. Cột đơn vị -----------------------------------------------------------------------------
alter table public.parts add column if not exists don_vi_nhap text not null default 'cái';
alter table public.parts add column if not exists don_vi_ban text not null default 'cái';
alter table public.parts add column if not exists he_so numeric(14,3) not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.parts'::regclass and conname = 'parts_don_vi_ok') then
    alter table public.parts add constraint parts_don_vi_ok check (
      he_so > 0 and char_length(btrim(don_vi_nhap)) between 1 and 30 and char_length(btrim(don_vi_ban)) between 1 and 30);
  end if;
end $$;

-- Dòng cũ nhận 'cái' (tất cả phụ tùng cũ đều là "cái"); dòng mới do hệ thống điền
alter table public.repair_items add column if not exists don_vi text;
alter table public.stock_ledger add column if not exists don_vi text not null default 'cái';
alter table public.stock_import_items add column if not exists don_vi text not null default 'cái';
alter table public.stock_import_items add column if not exists so_luong_goc numeric(14,3);   -- số lượng theo đơn vị người nhập chọn
alter table public.stock_import_items add column if not exists don_vi_goc text;
alter table public.stock_import_items add column if not exists gia_nhap_goc numeric(16,4);   -- giá theo đơn vị người nhập chọn
alter table public.stock_import_items add column if not exists he_so numeric(14,3);

-- Điền đơn vị cho dòng phiếu cũ một lần (chỉ dòng phụ tùng còn chưa có đơn vị). Không đụng số liệu khác.
do $$
begin
  perform set_config('app.sua_phieu', '1', true);          -- cho phép chạm vào dòng của phiếu đã thu tiền
  update public.repair_items set don_vi = 'cái' where kind = 'part' and don_vi is null;
  perform set_config('app.sua_phieu', '', true);
end $$;

-- 3. Chốt chặn: đổi đơn vị/hệ số của phụ tùng đang có chỉ qua doi_don_vi() --------------------
create or replace function public.parts_chan_sua_don_vi() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.don_vi_nhap is distinct from old.don_vi_nhap or new.don_vi_ban is distinct from old.don_vi_ban
          or new.he_so is distinct from old.he_so)
     and coalesce(current_setting('app.doi_dv', true), '') <> '1' then
    raise exception 'Không sửa đơn vị trực tiếp: dùng chức năng "Đổi đơn vị" của Chủ xưởng (trong chi tiết phụ tùng)';
  end if;
  return new;
end $$;
revoke execute on function public.parts_chan_sua_don_vi() from public, anon, authenticated;
drop trigger if exists parts_chan_sua_don_vi on public.parts;
create trigger parts_chan_sua_don_vi before update on public.parts
  for each row execute function public.parts_chan_sua_don_vi();

-- Dòng phiếu: tự chụp đơn vị bán của phụ tùng lúc thêm; sau đó không đổi theo phụ tùng
create or replace function public.repair_items_chup_don_vi() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.part_id is distinct from old.part_id then
    if new.kind = 'part' and new.part_id is not null then
      select don_vi_ban into new.don_vi from public.parts where id = new.part_id;
    elsif tg_op = 'INSERT' then
      new.don_vi := null;
    end if;
  else
    new.don_vi := old.don_vi;
  end if;
  if new.kind = 'part' and new.don_vi is null then new.don_vi := 'cái'; end if;
  return new;
end $$;
revoke execute on function public.repair_items_chup_don_vi() from public, anon, authenticated;
drop trigger if exists repair_items_chup_don_vi on public.repair_items;
create trigger repair_items_chup_don_vi before insert or update on public.repair_items
  for each row execute function public.repair_items_chup_don_vi();

-- 4. Sổ kho: loại 'doi_don_vi'; cho phép dòng 0 khi tồn bằng 0 (đổi đơn vị lúc hết hàng) -----
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.stock_ledger'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%loai%' and pg_get_constraintdef(oid) not like '%doi_don_vi%' loop
    execute format('alter table public.stock_ledger drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.stock_ledger'::regclass and conname = 'stock_ledger_loai_ok') then
    alter table public.stock_ledger add constraint stock_ledger_loai_ok
      check (loai in ('ton_dau','nhap_hang','xuat_phieu','them_khi_sua','xoa_khi_sua','khach_tra','kiem_ke','huy_nhap_hang','doi_don_vi'));
  end if;

  for c in select conname from pg_constraint
           where conrelid = 'public.stock_ledger'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%so_luong%' and pg_get_constraintdef(oid) not like '%ton_sau%'
             and conname <> 'stock_ledger_so_luong_ok' loop
    execute format('alter table public.stock_ledger drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.stock_ledger'::regclass and conname = 'stock_ledger_so_luong_ok') then
    alter table public.stock_ledger add constraint stock_ledger_so_luong_ok check (so_luong <> 0 or ton_sau = 0);
  end if;
end $$;

-- 5. doi_ton: ghi thêm đơn vị bán; số lượng tối đa 3 chữ số thập phân ------------------------
create or replace function public.doi_ton(p_part uuid, p_delta numeric, p_loai text,
                                          p_order uuid default null, p_import uuid default null, p_ghi_chu text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare p record; v_code int; v_new numeric;
begin
  if p_delta is null or p_delta = 0 then raise exception 'Số lượng thay đổi phải khác 0'; end if;
  if p_delta <> round(p_delta, 3) then raise exception 'Số lượng chỉ được có tối đa 3 chữ số thập phân'; end if;
  select * into p from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  v_new := p.stock + p_delta;
  if v_new < 0 then raise exception 'Không đủ tồn kho cho phụ tùng: % (còn % %)', p.name, p.stock, p.don_vi_ban; end if;
  if p_order is not null then select code into v_code from public.repair_orders where id = p_order; end if;

  perform set_config('app.doi_ton', '1', true);
  update public.parts set stock = v_new where id = p.id;
  perform set_config('app.doi_ton', '', true);

  insert into public.stock_ledger (part_id, part_name, part_code, loai, so_luong, ton_sau, order_id, order_code, import_id,
                                   created_by, created_by_name, ghi_chu, don_vi)
  values (p.id, p.name, p.code, p_loai, p_delta, v_new, p_order, v_code, p_import, auth.uid(),
          coalesce(public.ten_nguoi_dung(auth.uid()), (select email from auth.users where id = auth.uid()), 'Không rõ'),
          nullif(btrim(p_ghi_chu), ''), p.don_vi_ban);
  return v_new;
end $$;
revoke execute on function public.doi_ton(uuid, numeric, text, uuid, uuid, text) from public, anon, authenticated;

-- 6. Hàm kiểm tra: phụ tùng đã đổi đơn vị SAU lần xuất/nhập đó chưa -------------------------
create or replace function public.dv_da_doi_sau(p_part uuid, p_order uuid, p_import uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stock_ledger d
    where d.part_id = p_part and d.loai = 'doi_don_vi'
      and d.seq > coalesce((select min(l.seq) from public.stock_ledger l
                            where l.part_id = p_part
                              and ((p_order is not null and l.order_id = p_order) or (p_import is not null and l.import_id = p_import))),
                           9223372036854775807)
  )
$$;
revoke execute on function public.dv_da_doi_sau(uuid, uuid, uuid) from public, anon, authenticated;

-- 7. Nhập hàng (nhập tay hoặc file Excel): chọn đơn vị nhập / đơn vị bán ---------------------
-- Mỗi dòng p_items: {"name","code","qty","cost_price","sale_price",
--   "don_vi": "nhap" | "ban" (mặc định "ban"),            -- qty và cost_price tính theo đơn vị này
--   "don_vi_nhap","don_vi_ban","he_so"}                     -- chỉ dùng khi tạo phụ tùng MỚI
-- Món đã có: dùng đơn vị + hệ số đang lưu của phụ tùng. Tồn cộng theo đơn vị bán (qty x hệ số nếu nhập theo đơn vị nhập),
-- giá vốn mỗi đơn vị bán = giá nhập / hệ số (làm tròn 4 số lẻ). Sổ kho ghi số theo đơn vị bán.
create or replace function public.nhap_hang(p_supplier text, p_date date, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; it jsonb; v_part uuid; v_new boolean;
  v_name text; v_code text; v_qty numeric; v_cost numeric; v_sale numeric;
  v_total numeric := 0; v_n int := 0; v_ncc text; v_old numeric; v_has boolean;
  v_dv text; v_dvn text; v_dvb text; v_he numeric; v_qty_ban numeric; v_cost_ban numeric; v_goc_unit text;
  p record;
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
    v_cost := coalesce(nullif(it->>'cost_price', '')::numeric, 0);
    v_sale := nullif(it->>'sale_price', '')::numeric;
    v_dv   := case when lower(coalesce(it->>'don_vi', 'ban')) = 'nhap' then 'nhap' else 'ban' end;
    if v_name = '' then raise exception 'Có dòng thiếu tên hàng'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Số lượng không hợp lệ ở món: %', v_name; end if;
    if v_qty <> round(v_qty, 3) then raise exception 'Số lượng chỉ được tối đa 3 chữ số thập phân ở món: %', v_name; end if;
    if v_cost < 0 or (v_sale is not null and v_sale < 0) then raise exception 'Giá không hợp lệ ở món: %', v_name; end if;
    v_sale := round(v_sale);

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
      select * into p from public.parts where id = v_part;
      v_dvn := p.don_vi_nhap; v_dvb := p.don_vi_ban; v_he := p.he_so;
      perform set_config('app.an_pt', '1', true);
      update public.parts set
        sale_price = case when v_sale is not null and v_sale > 0 then v_sale else sale_price end,
        is_hidden = false
      where id = v_part;
      perform set_config('app.an_pt', '', true);
    else
      v_new := true;
      v_dvb := coalesce(nullif(btrim(it->>'don_vi_ban'), ''), 'cái');
      v_dvn := coalesce(nullif(btrim(it->>'don_vi_nhap'), ''), v_dvb);
      v_he  := coalesce(nullif(it->>'he_so', '')::numeric, 1);
      if v_he <= 0 or v_he <> round(v_he, 3) then raise exception 'Hệ số quy đổi không hợp lệ ở món: %', v_name; end if;
      if char_length(v_dvn) > 30 or char_length(v_dvb) > 30 then raise exception 'Tên đơn vị quá dài (tối đa 30 ký tự) ở món: %', v_name; end if;
      insert into public.parts (name, code, sale_price, stock, don_vi_nhap, don_vi_ban, he_so)
      values (v_name, v_code, coalesce(v_sale, 0), 0, v_dvn, v_dvb, v_he) returning id into v_part;
    end if;

    if v_dv = 'nhap' then
      v_qty_ban := round(v_qty * v_he, 3);
      v_cost_ban := round(v_cost / v_he, 4);
      v_goc_unit := v_dvn;
    else
      v_qty_ban := v_qty;
      v_cost_ban := round(v_cost, 4);
      v_goc_unit := v_dvb;
    end if;
    if v_qty_ban <= 0 then raise exception 'Số lượng quá nhỏ ở món: %', v_name; end if;

    perform public.doi_ton(v_part, v_qty_ban, 'nhap_hang', null, v_id, case when v_ncc is null then null else 'NCC: ' || v_ncc end);

    select cost_price into v_old from public.part_costs where part_id = v_part;
    v_has := found;
    insert into public.part_costs (part_id, cost_price) values (v_part, v_cost_ban)
    on conflict (part_id) do update set cost_price = excluded.cost_price;

    insert into public.stock_import_items (import_id, part_id, name, code, qty, cost_price, sale_price, is_new, co_gia_truoc, gia_nhap_truoc,
                                           don_vi, so_luong_goc, don_vi_goc, gia_nhap_goc, he_so)
    values (v_id, v_part, v_name, v_code, v_qty_ban, v_cost_ban, v_sale, v_new, v_has, v_old,
            v_dvb, v_qty, v_goc_unit, v_cost, v_he);
    v_total := v_total + v_qty * v_cost; v_n := v_n + 1;
  end loop;

  update public.stock_imports set item_count = v_n, total = round(v_total) where id = v_id;
  return v_id;
end $$;
revoke execute on function public.nhap_hang(text, date, text, jsonb) from public, anon;
grant execute on function public.nhap_hang(text, date, text, jsonb) to authenticated;

-- Định dạng số gọn (bỏ số 0 thừa) để ghi chú sổ kho
create or replace function public.so_gon(n numeric) returns text language sql immutable as $$
  select trim(trailing '.' from trim(trailing '0' from round(n, 4)::text))
$$;

-- 8. Đổi đơn vị của phụ tùng đang có (chỉ Chủ) -------------------------------------------------
-- 1 đơn vị bán HIỆN TẠI = p_he_so đơn vị bán MỚI. Ví dụ dầu đang tính "can": đổi sang lít, hệ số 5
--   -> tồn x5 (3 can = 15 lít), giá vốn / 5, đơn vị nhập mới = p_don_vi_nhap (can), hệ số lưu = 5.
-- Phiếu cũ không đổi: dòng phiếu giữ đơn vị cũ; không cho đổi khi phụ tùng đang nằm trong phiếu chưa hoàn thành.
create or replace function public.doi_don_vi(p_part uuid, p_don_vi_nhap text, p_don_vi_ban text, p_he_so numeric,
                                             p_gia_ban numeric, p_ton_thay numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; v_dvn text := btrim(coalesce(p_don_vi_nhap, '')); v_dvb text := btrim(coalesce(p_don_vi_ban, ''));
  v_new numeric; v_cost_old numeric; v_cost_new numeric; v_min numeric; v_phieu text; v_gia numeric := round(p_gia_ban);
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đổi đơn vị'; end if;
  if v_dvn = '' or v_dvb = '' then raise exception 'Hãy nhập tên đơn vị nhập và đơn vị bán'; end if;
  if char_length(v_dvn) > 30 or char_length(v_dvb) > 30 then raise exception 'Tên đơn vị quá dài (tối đa 30 ký tự)'; end if;
  if p_he_so is null or p_he_so <= 0 then raise exception 'Hệ số phải lớn hơn 0'; end if;
  if p_he_so <> round(p_he_so, 3) then raise exception 'Hệ số chỉ được tối đa 3 chữ số thập phân'; end if;
  if v_gia is null or v_gia < 0 then raise exception 'Giá bán mới không hợp lệ'; end if;
  select * into p from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  if p_ton_thay is distinct from p.stock then
    raise exception 'Tồn kho vừa thay đổi (nay là % %). Hãy tải lại trang rồi làm lại', p.stock, p.don_vi_ban;
  end if;
  if p_he_so = 1 and v_dvb = p.don_vi_ban and v_dvn = p.don_vi_nhap then
    raise exception 'Chưa có gì thay đổi';
  end if;

  select string_agg(distinct '#' || o.code, ', ') into v_phieu
  from public.repair_items i join public.repair_orders o on o.id = i.order_id
  where i.part_id = p.id and o.stock_deducted is not true;
  if v_phieu is not null then
    raise exception 'Phụ tùng đang nằm trong phiếu chưa hoàn thành (%). Hãy hoàn thành hoặc xóa dòng đó rồi đổi đơn vị', v_phieu;
  end if;

  v_new := round(p.stock * p_he_so, 3);
  v_min := round(p.min_stock * p_he_so, 3);
  select cost_price into v_cost_old from public.part_costs where part_id = p.id;
  v_cost_new := case when v_cost_old is null then null else round(v_cost_old / p_he_so, 4) end;

  perform set_config('app.doi_ton', '1', true);
  perform set_config('app.doi_dv', '1', true);
  update public.parts set stock = v_new, min_stock = v_min, don_vi_nhap = v_dvn, don_vi_ban = v_dvb,
                          he_so = p_he_so, sale_price = v_gia where id = p.id;
  perform set_config('app.doi_ton', '', true);
  perform set_config('app.doi_dv', '', true);
  if v_cost_new is not null then
    update public.part_costs set cost_price = v_cost_new where part_id = p.id;
  end if;

  insert into public.stock_ledger (part_id, part_name, part_code, loai, so_luong, ton_sau, created_by, created_by_name, ghi_chu, don_vi)
  values (p.id, p.name, p.code, 'doi_don_vi', v_new - p.stock, v_new, auth.uid(),
          coalesce(public.ten_nguoi_dung(auth.uid()), (select email from auth.users where id = auth.uid()), 'Không rõ'),
          format('Đổi đơn vị: 1 %s = %s %s. Tồn %s %s → %s %s. Đơn vị nhập: %s. Giá bán %s → %s đ/%s. Giá vốn %s → %s đ/%s',
                 p.don_vi_ban, public.so_gon(p_he_so), v_dvb,
                 public.so_gon(p.stock), p.don_vi_ban,
                 public.so_gon(v_new), v_dvb,
                 v_dvn, p.sale_price, v_gia, v_dvb,
                 coalesce(public.so_gon(v_cost_old), '—'), coalesce(public.so_gon(v_cost_new), '—'), v_dvb),
          v_dvb);
  return jsonb_build_object('ton_truoc', p.stock, 'ton_sau', v_new);
end $$;
revoke execute on function public.doi_don_vi(uuid, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.doi_don_vi(uuid, text, text, numeric, numeric, numeric) to authenticated;

-- 9. Báo giá in: trả thêm đơn vị (chỉ GIÁ BÁN, không có giá nhập) ----------------------------
drop function if exists public.dong_bao_gia(uuid);
create function public.dong_bao_gia(p_order uuid)
returns table (id uuid, kind text, name text, qty numeric, unit_price numeric, don_vi text)
language sql stable security definer set search_path = public as $$
  select i.id, i.kind, i.name, i.qty, i.unit_price, case when i.kind = 'part' then coalesce(i.don_vi, 'cái') else null end
  from public.repair_items i
  where public.vai_tro() is not null and i.order_id = p_order
  order by i.created_at
$$;
revoke execute on function public.dong_bao_gia(uuid) from public, anon;
grant execute on function public.dong_bao_gia(uuid) to authenticated;

-- 10. Hủy nhập / khách trả / xóa dòng: chặn khi đơn vị đã đổi sau đó (tránh cộng trừ sai đơn vị) ----
create or replace function public.huy_lan_nhap(p_id uuid, p_ly_do text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record; r record; it record; v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text;
  v_thieu text := ''; v_doi text := ''; v_khoiphuc int := 0; v_giu text := ''; v_cur numeric; v_prev numeric; v_known boolean;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy lần nhập'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  select * into s from public.stock_imports where id = p_id for update;
  if not found then raise exception 'Không tìm thấy lần nhập'; end if;
  if s.da_huy then raise exception 'Lần nhập này đã hủy rồi'; end if;

  -- Khóa các phụ tùng theo thứ tự cố định rồi kiểm tra đủ tồn để trừ lại
  for r in select i.part_id, sum(i.qty) as qty
           from public.stock_import_items i where i.import_id = p_id and i.part_id is not null
           group by i.part_id order by i.part_id loop
    perform 1 from public.parts where id = r.part_id for update;
  end loop;
  for r in select distinct p.name from public.stock_import_items i join public.parts p on p.id = i.part_id
           where i.import_id = p_id and public.dv_da_doi_sau(i.part_id, null, p_id) order by p.name loop
    v_doi := v_doi || E'
• ' || r.name;
  end loop;
  if v_doi <> '' then
    raise exception 'Không hủy được vì các phụ tùng sau đã đổi đơn vị sau lần nhập này (số lượng khác đơn vị):%
Hãy dùng "Kiểm kê điều chỉnh" để chỉnh tồn thay vì hủy phiếu.', v_doi;
  end if;
  for r in select p.name, p.code, p.stock, x.qty
           from (select i.part_id, sum(i.qty) as qty from public.stock_import_items i
                 where i.import_id = p_id and i.part_id is not null group by i.part_id) x
           join public.parts p on p.id = x.part_id
           where p.stock < x.qty order by p.name loop
    v_thieu := v_thieu || format(E'\n• %s%s: cần trừ lại %s, tồn hiện tại %s → thiếu %s',
      r.name, case when r.code is null then '' else ' (' || r.code || ')' end, r.qty, r.stock, r.qty - r.stock);
  end loop;
  if v_thieu <> '' then
    raise exception 'Không hủy được vì hàng đã được dùng (ví dụ cho phiếu sửa), tồn không đủ để trừ lại:%
Hãy vào Phụ tùng → chi tiết → "Kiểm kê điều chỉnh" để chỉnh tồn cho đúng, rồi hủy lại.', v_thieu;
  end if;

  -- Trừ lại tồn (sổ kho: dòng đảo)
  for r in select i.part_id, sum(i.qty) as qty
           from public.stock_import_items i where i.import_id = p_id and i.part_id is not null
           group by i.part_id order by i.part_id loop
    perform public.doi_ton(r.part_id, -r.qty, 'huy_nhap_hang', null, p_id, 'Hủy lần nhập ngày ' || to_char(s.imported_on, 'DD/MM/YYYY') || ': ' || v_ly);
  end loop;

  -- Khôi phục giá nhập
  for it in select * from public.stock_import_items i
            where i.import_id = p_id and i.part_id is not null order by i.seq desc loop
    select cost_price into v_cur from public.part_costs where part_id = it.part_id;
    if not found or v_cur is distinct from it.cost_price then continue; end if;        -- giá đã bị đổi bởi nơi khác
    if exists (select 1 from public.stock_import_items i2 join public.stock_imports s2 on s2.id = i2.import_id
               where i2.part_id = it.part_id and i2.import_id <> p_id and not s2.da_huy
                 and (s2.created_at, s2.id) > (s.created_at, s.id)) then
      continue;                                                                       -- đã có lần nhập sau
    end if;
    -- giá trước: ưu tiên giá đã ghi lúc nhập; lần nhập cũ thì lấy giá của lần nhập trước đó
    v_known := false; v_prev := null;
    if it.co_gia_truoc is not null then
      v_known := true; v_prev := case when it.co_gia_truoc then it.gia_nhap_truoc else 0 end;
    else
      select i3.cost_price into v_prev from public.stock_import_items i3 join public.stock_imports s3 on s3.id = i3.import_id
        where i3.part_id = it.part_id and i3.import_id <> p_id and not s3.da_huy
          and (s3.created_at, s3.id) < (s.created_at, s.id)
        order by s3.created_at desc, i3.seq desc limit 1;
      if found then v_known := true;
      elsif it.is_new then v_known := true; v_prev := 0; end if;
    end if;
    if v_known then
      update public.part_costs set cost_price = coalesce(v_prev, 0) where part_id = it.part_id;
      v_khoiphuc := v_khoiphuc + 1;
    else
      v_giu := v_giu || case when v_giu = '' then '' else ', ' end || it.name;
    end if;
  end loop;

  v_ten := coalesce(public.ten_nguoi_dung(auth.uid()), (select email from auth.users where id = auth.uid()), 'Không rõ');
  update public.stock_imports set da_huy = true, huy_ly_do = v_ly, huy_boi = v_ten, huy_luc = now() where id = p_id;
  insert into public.stock_import_logs (import_id, action, noi_dung, created_by_name)
    values (p_id, 'huy', 'Hủy lần nhập. Lý do: ' || v_ly, v_ten);
  return jsonb_build_object('khoi_phuc_gia', v_khoiphuc, 'giu_gia', v_giu);
end $$;
revoke execute on function public.huy_lan_nhap(uuid, text) from public, anon;
grant execute on function public.huy_lan_nhap(uuid, text) to authenticated;

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
  if public.dv_da_doi_sau(it.part_id, o.id, null) then
    raise exception 'Phụ tùng này đã đổi đơn vị sau khi bán nên không tự cộng lại kho được. Hãy dùng "Kiểm kê điều chỉnh" để chỉnh tồn';
  end if;

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
  if it.kind = 'part' and it.part_id is not null and public.dv_da_doi_sau(it.part_id, o.id, null) then
    raise exception 'Phụ tùng này đã đổi đơn vị sau khi bán nên không tự cộng lại kho được. Hãy dùng "Kiểm kê điều chỉnh" để chỉnh tồn';
  end if;

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
revoke execute on function public.sua_phieu_xoa_dong(uuid) from public, anon;
grant execute on function public.sua_phieu_xoa_dong(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra: so_mon_lech phải = 0 (đối chiếu tồn kho); các mục khác phải = true / đúng số
select
  (select count(*) from public.parts p
    where p.stock <> coalesce((select sum(so_luong) from public.stock_ledger l where l.part_id = p.id), 0)) as so_mon_lech,
  exists (select 1 from information_schema.columns where table_name = 'parts' and column_name = 'he_so') as co_cot_he_so,
  exists (select 1 from pg_proc where proname = 'doi_don_vi') as co_ham_doi_don_vi,
  (select numeric_scale from information_schema.columns where table_name = 'parts' and column_name = 'stock') as so_le_ton_kho_phai_la_3,
  (select count(*) from public.parts where he_so <> 1) as so_phu_tung_da_quy_doi;
