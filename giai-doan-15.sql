-- GIAI ĐOẠN 15: Quản lý lần nhập hàng (xem chi tiết, sửa thông tin, hủy phiếu nhập, ẩn phụ tùng)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu).
-- Cần đã chạy giai-doan-4, 8, 12, 13.
--
--  * Chỉ Chủ xưởng thao tác. Không xóa cứng, không sửa dòng sổ kho cũ.
--  * Hủy phiếu nhập: ghi dòng đảo 'huy_nhap_hang' vào sổ kho, đánh dấu "Đã hủy" + lý do,
--    khôi phục giá nhập trước đó nếu giá hiện tại do chính lần nhập này đặt và chưa có lần nhập nào sau.
--  * Không đủ tồn để trừ lại -> chặn, báo món nào thiếu bao nhiêu.

-- 1. Cột mới -----------------------------------------------------------------------
alter table public.stock_imports add column if not exists da_huy boolean not null default false;
alter table public.stock_imports add column if not exists huy_ly_do text;
alter table public.stock_imports add column if not exists huy_boi text;
alter table public.stock_imports add column if not exists huy_luc timestamptz;

alter table public.stock_import_items add column if not exists seq bigint generated always as identity;
alter table public.stock_import_items add column if not exists co_gia_truoc boolean;     -- null = lần nhập cũ, không biết
alter table public.stock_import_items add column if not exists gia_nhap_truoc numeric(14,0);

alter table public.parts add column if not exists is_hidden boolean not null default false;

-- 2. Nhật ký lần nhập (chỉ Chủ xem) ------------------------------------------------
create table if not exists public.stock_import_logs (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.stock_imports(id) on delete cascade,
  action text not null check (action in ('sua','huy')),
  noi_dung text,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists stock_import_logs_idx on public.stock_import_logs(import_id, created_at desc);
alter table public.stock_import_logs enable row level security;
revoke all on public.stock_import_logs from anon;
revoke all on public.stock_import_logs from authenticated;
grant select on public.stock_import_logs to authenticated;
drop policy if exists nhl_chi_chu_xem on public.stock_import_logs;
create policy nhl_chi_chu_xem on public.stock_import_logs for select to authenticated using (public.la_chu());

-- 3. Cho phép loại sổ kho mới 'huy_nhap_hang' ---------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.stock_ledger'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%loai%' and conname <> 'stock_ledger_loai_ok' loop
    execute format('alter table public.stock_ledger drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.stock_ledger'::regclass and conname = 'stock_ledger_loai_ok') then
    alter table public.stock_ledger add constraint stock_ledger_loai_ok
      check (loai in ('ton_dau','nhap_hang','xuat_phieu','them_khi_sua','xoa_khi_sua','khach_tra','kiem_ke','huy_nhap_hang'));
  end if;
end $$;

-- 4. Chặn sửa trực tiếp cột is_hidden (chỉ qua hàm an_phu_tung / bo_an_phu_tung) -----
create or replace function public.parts_chan_sua_an() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.an_pt', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if new.is_hidden then raise exception 'Không tạo phụ tùng ở trạng thái ẩn'; end if;
  elsif new.is_hidden is distinct from old.is_hidden then
    raise exception 'Chỉ ẩn/bỏ ẩn phụ tùng qua chức năng của Chủ xưởng';
  end if;
  return new;
end $$;
revoke execute on function public.parts_chan_sua_an() from public, anon, authenticated;
drop trigger if exists parts_chan_sua_an on public.parts;
create trigger parts_chan_sua_an before insert or update on public.parts
  for each row execute function public.parts_chan_sua_an();

-- 5. nhap_hang: ghi nhớ giá nhập trước đó; nhập lại món đã ẩn thì tự hiện lại ----------
create or replace function public.nhap_hang(p_supplier text, p_date date, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; it jsonb; v_part uuid; v_new boolean;
  v_name text; v_code text; v_qty numeric; v_cost numeric; v_sale numeric;
  v_total numeric := 0; v_n int := 0; v_ncc text; v_old numeric; v_has boolean;
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
      perform set_config('app.an_pt', '1', true);
      update public.parts set
        sale_price = case when v_sale is not null and v_sale > 0 then v_sale else sale_price end,
        is_hidden = false
      where id = v_part;
      perform set_config('app.an_pt', '', true);
    else
      v_new := true;
      insert into public.parts (name, code, sale_price, stock)
      values (v_name, v_code, coalesce(v_sale, 0), 0) returning id into v_part;
    end if;
    perform public.doi_ton(v_part, v_qty, 'nhap_hang', null, v_id, case when v_ncc is null then null else 'NCC: ' || v_ncc end);

    select cost_price into v_old from public.part_costs where part_id = v_part;
    v_has := found;
    insert into public.part_costs (part_id, cost_price) values (v_part, v_cost)
    on conflict (part_id) do update set cost_price = excluded.cost_price;

    insert into public.stock_import_items (import_id, part_id, name, code, qty, cost_price, sale_price, is_new, co_gia_truoc, gia_nhap_truoc)
    values (v_id, v_part, v_name, v_code, v_qty, v_cost, v_sale, v_new, v_has, v_old);
    v_total := v_total + v_qty * v_cost; v_n := v_n + 1;
  end loop;

  update public.stock_imports set item_count = v_n, total = round(v_total) where id = v_id;
  return v_id;
end $$;
revoke execute on function public.nhap_hang(text, date, text, jsonb) from public, anon;
grant execute on function public.nhap_hang(text, date, text, jsonb) to authenticated;

-- 6. Sửa thông tin lần nhập (không đụng kho) ---------------------------------------
create or replace function public.sua_lan_nhap(p_id uuid, p_supplier text, p_date date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_ncc text := nullif(btrim(p_supplier), ''); v_note text := nullif(btrim(p_note), '');
        v_date date := coalesce(p_date, current_date); v_nd text := ''; v_ten text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được sửa lần nhập'; end if;
  select * into s from public.stock_imports where id = p_id for update;
  if not found then raise exception 'Không tìm thấy lần nhập'; end if;
  if s.da_huy then raise exception 'Lần nhập đã hủy, không sửa được'; end if;
  if v_ncc is not null and char_length(v_ncc) > 200 then raise exception 'Tên nhà cung cấp quá dài (tối đa 200 ký tự)'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Ghi chú quá dài (tối đa 500 ký tự)'; end if;
  if s.supplier is distinct from v_ncc then v_nd := v_nd || format('Nhà cung cấp: "%s" → "%s". ', coalesce(s.supplier, ''), coalesce(v_ncc, '')); end if;
  if s.imported_on is distinct from v_date then v_nd := v_nd || format('Ngày nhập: %s → %s. ', s.imported_on, v_date); end if;
  if s.note is distinct from v_note then v_nd := v_nd || format('Ghi chú: "%s" → "%s". ', coalesce(s.note, ''), coalesce(v_note, '')); end if;
  if v_nd = '' then raise exception 'Chưa có gì thay đổi'; end if;
  update public.stock_imports set supplier = v_ncc, imported_on = v_date, note = v_note where id = p_id;
  v_ten := coalesce(public.ten_nguoi_dung(auth.uid()), (select email from auth.users where id = auth.uid()), 'Không rõ');
  insert into public.stock_import_logs (import_id, action, noi_dung, created_by_name) values (p_id, 'sua', btrim(v_nd), v_ten);
end $$;
revoke execute on function public.sua_lan_nhap(uuid, text, date, text) from public, anon;
grant execute on function public.sua_lan_nhap(uuid, text, date, text) to authenticated;

-- 7. Hủy lần nhập -------------------------------------------------------------------
create or replace function public.huy_lan_nhap(p_id uuid, p_ly_do text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record; r record; it record; v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text;
  v_thieu text := ''; v_khoiphuc int := 0; v_giu text := ''; v_cur numeric; v_prev numeric; v_known boolean;
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

-- 8. Ẩn phụ tùng do lần nhập đã hủy tạo mới -----------------------------------------
-- Điều kiện: tồn = 0, từng được lần nhập đã hủy tạo mới, không còn lần nhập nào chưa hủy, chưa dùng trong phiếu nào.
create or replace function public.phu_tung_an_duoc(p_import uuid default null)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng thao tác'; end if;
  return query
    select p.id from public.parts p
    where not p.is_hidden and p.stock = 0
      and exists (select 1 from public.stock_import_items i join public.stock_imports s on s.id = i.import_id
                  where i.part_id = p.id and i.is_new and s.da_huy and (p_import is null or s.id = p_import))
      and not exists (select 1 from public.stock_import_items i join public.stock_imports s on s.id = i.import_id
                      where i.part_id = p.id and not s.da_huy)
      and not exists (select 1 from public.repair_items r where r.part_id = p.id);
end $$;
revoke execute on function public.phu_tung_an_duoc(uuid) from public, anon;
grant execute on function public.phu_tung_an_duoc(uuid) to authenticated;

create or replace function public.an_phu_tung(p_part uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được ẩn phụ tùng'; end if;
  perform 1 from public.parts where id = p_part for update;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  if not exists (select 1 from public.phu_tung_an_duoc(null) x where x = p_part) then
    raise exception 'Không ẩn được: chỉ ẩn phụ tùng do lần nhập đã hủy tạo mới, tồn bằng 0 và chưa dùng trong phiếu nào';
  end if;
  perform set_config('app.an_pt', '1', true);
  update public.parts set is_hidden = true where id = p_part;
  perform set_config('app.an_pt', '', true);
end $$;
revoke execute on function public.an_phu_tung(uuid) from public, anon;
grant execute on function public.an_phu_tung(uuid) to authenticated;

create or replace function public.bo_an_phu_tung(p_part uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được bỏ ẩn phụ tùng'; end if;
  perform set_config('app.an_pt', '1', true);
  update public.parts set is_hidden = false where id = p_part;
  perform set_config('app.an_pt', '', true);
end $$;
revoke execute on function public.bo_an_phu_tung(uuid) from public, anon;
grant execute on function public.bo_an_phu_tung(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra: so_mon_lech phải = 0; các cột/hàm mới phải = true
select
  (select count(*) from public.parts p
    where p.stock <> coalesce((select sum(so_luong) from public.stock_ledger l where l.part_id = p.id), 0)) as so_mon_lech,
  exists (select 1 from information_schema.columns where table_name = 'stock_imports' and column_name = 'da_huy') as co_cot_da_huy,
  exists (select 1 from pg_proc where proname = 'huy_lan_nhap') as co_ham_huy,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'stock_import_logs') as nhat_ky_bat_bao_mat;
