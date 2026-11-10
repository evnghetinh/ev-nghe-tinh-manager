-- GIAI ĐOẠN 27: Tìm kiếm nhanh (ô tìm trên cùng), hồ sơ khách, danh sách khách/xe có tìm - sắp xếp - tải thêm
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không đổi dữ liệu nào). Cần đã chạy giai-doan-4, 20, 23 và 25.
--
-- ===== NỘI DUNG =====
--  * Tìm không phân biệt hoa thường và dấu; biển số / số điện thoại bỏ qua dấu cách, chấm, gạch; số điện thoại tìm theo bất kỳ phần nào.
--  * Thêm chỉ mục (index) cho các cột tìm kiếm để tìm nhanh.
--  * Các hàm tìm chỉ trả số liệu bán hàng (KHÔNG có giá nhập, chi phí, lợi nhuận, số dư quỹ). Nhân viên dùng được.
--  * Hồ sơ khách: với Nhân viên, ẩn "tổng đã chi" và số tiền các phiếu đã thanh toán xong (giống quy tắc từ giai đoạn 4).
--  * Chỉ ĐỌC dữ liệu, không ghi gì, không đổi cách tính công nợ (dùng lại hàm cong_no_phieu() của giai đoạn 23).

-- 1. Chuẩn hóa chữ để so khớp ------------------------------------------------------------------------------
create or replace function public.tim_chuan(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
    translate(normalize(lower(coalesce(t, '')), NFC),
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
    '[^a-z0-9]', '', 'g')
$$;

-- Tách câu tìm thành các mẫu '%từ%' (mỗi từ đã chuẩn hóa)
create or replace function public.tim_tu_khoa(p text) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg('%' || s.x || '%'), array[]::text[])
  from (select public.tim_chuan(w) as x from unnest(regexp_split_to_array(btrim(coalesce(p, '')), '\s+')) as w) s
  where s.x <> ''
$$;

create or replace function public.tim_khach(p_ten text, p_sdt text) returns text
language sql immutable parallel safe as $$ select public.tim_chuan(coalesce(p_ten, '') || ' ' || coalesce(p_sdt, '')) $$;

create or replace function public.tim_xe(p_bien text, p_hang text, p_dong text, p_model text, p_khung text) returns text
language sql immutable parallel safe as $$
  select public.tim_chuan(coalesce(p_bien, '') || ' ' || coalesce(p_hang, '') || ' ' || coalesce(p_dong, '') || ' ' || coalesce(p_model, '') || ' ' || coalesce(p_khung, ''))
$$;

create or replace function public.tim_phu_tung(p_ten text, p_ma text) returns text
language sql immutable parallel safe as $$ select public.tim_chuan(coalesce(p_ten, '') || ' ' || coalesce(p_ma, '')) $$;

-- 2. Chỉ mục ----------------------------------------------------------------------------------------------
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is null then
    begin
      create extension if not exists pg_trgm with schema extensions;
    exception when others then
      create extension if not exists pg_trgm;
    end;
    select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  end if;
  execute format('create index if not exists khach_tim_idx on public.customers using gin (public.tim_khach(name, phone) %I.gin_trgm_ops)', s);
  execute format('create index if not exists xe_tim_idx on public.vehicles using gin (public.tim_xe(plate, hang_xe, dong_xe, model, vin) %I.gin_trgm_ops)', s);
  execute format('create index if not exists phu_tung_tim_idx on public.parts using gin (public.tim_phu_tung(name, code) %I.gin_trgm_ops)', s);
end $$;

create index if not exists customers_created_idx on public.customers (created_at desc);
create index if not exists vehicles_created_idx on public.vehicles (created_at desc);
create index if not exists vehicles_customer_idx on public.vehicles (customer_id);
create index if not exists repair_orders_created_idx on public.repair_orders (created_at desc);
create index if not exists repair_orders_customer_idx on public.repair_orders (customer_id);
create index if not exists repair_orders_vehicle_idx on public.repair_orders (vehicle_id);

-- 3. Công nợ gộp theo khách (dùng lại cong_no_phieu của giai đoạn 23) --------------------------------------
create or replace function public.cong_no_theo_khach()
returns table (customer_id uuid, no numeric)
language sql stable security definer set search_path = public as $$
  select p.customer_id, sum(p.con_no) from public.cong_no_phieu() p group by p.customer_id
$$;
revoke execute on function public.cong_no_theo_khach() from public, anon;
grant execute on function public.cong_no_theo_khach() to authenticated;

-- 4. Tìm kiếm tổng (ô tìm trên cùng): 4 nhóm, tối đa 6 mỗi nhóm -------------------------------------------
create or replace function public.tim_kiem_tong(p_q text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pats text[];
  dau text;
  k_ids uuid[];
  kh jsonb; xe jsonb; ph jsonb; pt jsonb;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  pats := public.tim_tu_khoa(p_q);
  if length(btrim(coalesce(p_q, ''))) < 2 or cardinality(pats) = 0 then
    return jsonb_build_object('khach', '[]'::jsonb, 'xe', '[]'::jsonb, 'phieu', '[]'::jsonb, 'phu_tung', '[]'::jsonb);
  end if;
  dau := substr(pats[1], 2, length(pats[1]) - 2) || '%';   -- từ đầu tiên: kết quả bắt đầu bằng từ này được xếp lên trước

  -- Khách
  select coalesce(array_agg(s.id order by s.rn), '{}') into k_ids from (
    select c.id, row_number() over (order by (public.tim_chuan(c.name) like dau or public.tim_chuan(c.phone) like dau) desc, c.name) as rn
    from public.customers c
    where public.tim_khach(c.name, c.phone) like all (pats)
    order by rn
    limit 6) s;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone,
      'xe', (select coalesce(string_agg(x.plate, ', '), '') from (select v.plate from public.vehicles v where v.customer_id = c.id order by v.plate limit 3) x),
      'no', coalesce(n.no, 0)) order by array_position(k_ids, c.id)), '[]'::jsonb)
  into kh
  from public.customers c
  left join public.cong_no_theo_khach() n on n.customer_id = c.id
  where c.id = any (k_ids);

  -- Xe (khớp theo xe, hoặc theo tên/SĐT chủ xe)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'customer_id', s.customer_id, 'plate', s.plate, 'hang_xe', s.hang_xe, 'dong_xe', s.dong_xe, 'chu', s.name) order by s.rn), '[]'::jsonb)
  into xe
  from (
    select v.id, v.customer_id, v.plate, v.hang_xe, v.dong_xe, c.name,
           row_number() over (order by (public.tim_chuan(v.plate) like dau) desc, v.created_at desc) as rn
    from public.vehicles v join public.customers c on c.id = v.customer_id
    where public.tim_xe(v.plate, v.hang_xe, v.dong_xe, v.model, v.vin) like all (pats)
       or public.tim_khach(c.name, c.phone) like all (pats)
    order by rn
    limit 6) s;

  -- Phiếu (mã phiếu, biển số, khách, số điện thoại)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'plate', s.plate, 'khach', s.name,
      'status', case when s.da_huy then 'Đã hủy' else s.status end, 'ngay', s.received_at) order by s.created_at desc), '[]'::jsonb)
  into ph
  from (
    select o.id, o.code, o.status, o.da_huy, o.received_at, o.created_at, v.plate, c.name
    from public.repair_orders o
    join public.vehicles v on v.id = o.vehicle_id
    join public.customers c on c.id = o.customer_id
    where public.tim_chuan('PT' || lpad(o.code::text, 4, '0') || ' ' || v.plate || ' ' || c.name || ' ' || coalesce(c.phone, '')) like all (pats)
    order by o.created_at desc
    limit 6) s;

  -- Phụ tùng (không có giá nhập)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'code', s.code, 'stock', s.stock, 'don_vi_ban', s.don_vi_ban, 'don_vi_nhap', s.don_vi_nhap, 'he_so', s.he_so) order by s.rn), '[]'::jsonb)
  into pt
  from (
    select p.id, p.name, p.code, p.stock, p.don_vi_ban, p.don_vi_nhap, p.he_so,
           row_number() over (order by (public.tim_chuan(p.name) like dau or public.tim_chuan(p.code) like dau) desc, p.name) as rn
    from public.parts p
    where public.tim_phu_tung(p.name, p.code) like all (pats)
    order by rn
    limit 6) s;

  return jsonb_build_object('khach', kh, 'xe', xe, 'phieu', ph, 'phu_tung', pt);
end $$;
revoke execute on function public.tim_kiem_tong(text) from public, anon;
grant execute on function public.tim_kiem_tong(text) to authenticated;

-- 5. Danh sách khách (tìm + sắp xếp + phân trang) -----------------------------------------------------------
-- p_sap_xep: 'moi' (mới nhất), 'ten' (tên A-Z), 'no' (nợ nhiều nhất)
create or replace function public.khach_danh_sach(p_q text, p_sap_xep text, p_so int, p_bat_dau int)
returns table (id uuid, name text, phone text, address text, note text, created_at timestamptz, so_xe bigint, no numeric)
language plpgsql stable security definer set search_path = public as $$
declare pats text[];
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  pats := public.tim_tu_khoa(p_q);
  return query
  select c.id, c.name, c.phone, c.address, c.note, c.created_at,
         (select count(*) from public.vehicles v where v.customer_id = c.id),
         coalesce(n.no, 0)
  from public.customers c
  left join public.cong_no_theo_khach() n on n.customer_id = c.id
  where cardinality(pats) = 0 or public.tim_khach(c.name, c.phone) like all (pats)
  order by case when p_sap_xep = 'no' then coalesce(n.no, 0) end desc nulls last,
           case when p_sap_xep = 'ten' then lower(c.name) end asc nulls last,
           c.created_at desc, c.id
  limit greatest(least(coalesce(p_so, 20), 100), 1) offset greatest(coalesce(p_bat_dau, 0), 0);
end $$;
revoke execute on function public.khach_danh_sach(text, text, int, int) from public, anon;
grant execute on function public.khach_danh_sach(text, text, int, int) to authenticated;

-- 6. Danh sách xe (tìm + sắp xếp + phân trang): 'ten' = tên chủ xe A-Z, 'no' = chủ xe nợ nhiều nhất ------------------
create or replace function public.xe_danh_sach(p_q text, p_sap_xep text, p_so int, p_bat_dau int)
returns table (id uuid, customer_id uuid, plate text, vin text, vehicle_type text, model text, hang_xe text, dong_xe text,
               nam_san_xuat int, mau_xe text, created_at timestamptz, ten_khach text, sdt_khach text, no_khach numeric)
language plpgsql stable security definer set search_path = public as $$
declare pats text[];
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  pats := public.tim_tu_khoa(p_q);
  return query
  select v.id, v.customer_id, v.plate, v.vin, v.vehicle_type, v.model, v.hang_xe, v.dong_xe, v.nam_san_xuat::int, v.mau_xe, v.created_at,
         c.name, c.phone, coalesce(n.no, 0)
  from public.vehicles v
  join public.customers c on c.id = v.customer_id
  left join public.cong_no_theo_khach() n on n.customer_id = v.customer_id
  where cardinality(pats) = 0
     or public.tim_xe(v.plate, v.hang_xe, v.dong_xe, v.model, v.vin) like all (pats)
     or public.tim_khach(c.name, c.phone) like all (pats)
  order by case when p_sap_xep = 'no' then coalesce(n.no, 0) end desc nulls last,
           case when p_sap_xep = 'ten' then lower(c.name) end asc nulls last,
           v.created_at desc, v.id
  limit greatest(least(coalesce(p_so, 20), 100), 1) offset greatest(coalesce(p_bat_dau, 0), 0);
end $$;
revoke execute on function public.xe_danh_sach(text, text, int, int) from public, anon;
grant execute on function public.xe_danh_sach(text, text, int, int) to authenticated;

-- 7. Hồ sơ khách ---------------------------------------------------------------------------------------------
create or replace function public.khach_ho_so(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  chu boolean;
  kh jsonb; xe jsonb; ph jsonb;
  da_chi numeric; con_no_ numeric;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  chu := public.la_chu();
  select to_jsonb(c) - 'created_at' into kh from public.customers c where c.id = p_id;
  if kh is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'plate', v.plate, 'hang_xe', v.hang_xe, 'dong_xe', v.dong_xe, 'vehicle_type', v.vehicle_type,
           'nam_san_xuat', v.nam_san_xuat, 'mau_xe', v.mau_xe, 'model', v.model, 'vin', v.vin) order by v.created_at desc), '[]'::jsonb)
  into xe from public.vehicles v where v.customer_id = p_id;

  with o as (
    select r.id, r.code, r.status, r.da_huy, r.received_at, r.created_at, r.stock_deducted, v.plate,
           (select coalesce(sum(ri.qty * ri.unit_price), 0) from public.repair_items ri where ri.order_id = r.id) as tong,
           (select coalesce(sum(op.so_tien), 0) from public.order_payments op where op.order_id = r.id and not op.da_huy) as da_thu
    from public.repair_orders r join public.vehicles v on v.id = r.vehicle_id
    where r.customer_id = p_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'code', o.code, 'plate', o.plate, 'status', case when o.da_huy then 'Đã hủy' else o.status end, 'ngay', o.received_at,
           -- Nhân viên chỉ thấy số tiền của phiếu còn nợ
           'tong', case when chu or (o.stock_deducted and not o.da_huy and o.tong - o.da_thu > 0.5) then o.tong end,
           'da_thu', case when chu or (o.stock_deducted and not o.da_huy and o.tong - o.da_thu > 0.5) then o.da_thu end,
           'con_no', case when o.stock_deducted and not o.da_huy and o.tong - o.da_thu > 0.5 then o.tong - o.da_thu else 0 end
         ) order by o.created_at desc), '[]'::jsonb),
         coalesce(sum(case when not o.da_huy then o.da_thu end), 0),
         coalesce(sum(case when o.stock_deducted and not o.da_huy and o.tong - o.da_thu > 0.5 then o.tong - o.da_thu end), 0)
  into ph, da_chi, con_no_ from o;

  return jsonb_build_object('khach', kh, 'xe', xe, 'phieu', ph, 'tong_da_chi', case when chu then da_chi end, 'cong_no', con_no_);
end $$;
revoke execute on function public.khach_ho_so(uuid) from public, anon;
grant execute on function public.khach_ho_so(uuid) to authenticated;

notify pgrst, 'reload schema';
