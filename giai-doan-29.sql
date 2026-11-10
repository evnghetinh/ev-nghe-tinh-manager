-- GIAI ĐOẠN 29: Danh sách phiếu tiếp nhận dạng bảng (lọc - sắp xếp - nhóm - phân trang làm ở máy chủ)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không đổi dữ liệu nào). Cần đã chạy giai-doan-4, 10, 23 và 27.
--
-- ===== NỘI DUNG =====
--  * Chỉ ĐỌC dữ liệu, không ghi gì. KHÔNG đổi cách tính doanh thu, lợi nhuận, tồn kho, sổ quỹ, công nợ.
--  * Tổng tiền = tổng dòng phiếu; Đã thu = tổng khoản thu chưa hủy; Còn nợ = Tổng - Đã thu (chỉ phiếu đã hoàn thành, chưa hủy) - giống trang Công nợ.
--  * Lợi nhuận (= doanh thu - giá vốn phụ tùng - chi phí chưa hủy, giống trang Tổng quan) CHỈ trả cho Chủ, làm ngay trong hàm:
--    nhân viên luôn nhận ô trống, kể cả khi gọi thẳng API. Chỉ phiếu đã hoàn thành và chưa hủy mới có lợi nhuận.
--  * Nhóm theo trạng thái / ngày / khách / kỹ thuật viên: số lượng cho mọi người, tổng tiền chỉ cho Chủ.

create index if not exists repair_orders_status_idx on public.repair_orders (status);
create index if not exists repair_orders_received_idx on public.repair_orders (received_at desc);
create index if not exists repair_items_order_idx on public.repair_items (order_id);
create index if not exists order_payments_order_idx on public.order_payments (order_id);

-- 1. Hàm nền: mỗi phiếu một dòng + đã lọc theo từ khóa / trạng thái / ngày / kỹ thuật viên / còn nợ / lọc theo cột -------------
create or replace function public.ds_phieu_co_so(
  p_tu_khoa text, p_trang_thai text[], p_tu date, p_den date, p_ktv uuid, p_chi_no boolean, p_loc jsonb
) returns table (
  id uuid, code bigint, received_at timestamptz, status text, da_huy boolean, stock_deducted boolean,
  khach text, sdt text, bien_so text, xe text, vin text, odometer integer, ktv text, issue text,
  tong numeric, da_thu numeric, con_no numeric, loi_nhuan numeric, ngay date
)
language sql stable security definer set search_path = public as $$
  with chu as (select public.la_chu() as la),
  x as (
    select o.id, o.code, o.received_at, o.status, o.da_huy, o.stock_deducted,
           c.name as khach, c.phone as sdt, v.plate as bien_so,
           btrim(coalesce(v.hang_xe, '') || ' ' || coalesce(v.dong_xe, '')) as xe,
           v.vin, o.odometer,
           (select string_agg(k.ten, ', ' order by k.ten) from public.ev_phieu_ky_thuat_vien pk join public.ev_ky_thuat_vien k on k.id = pk.ktv_id where pk.order_id = o.id) as ktv,
           o.issue,
           t.tong, coalesce(p.da_thu, 0) as da_thu,
           case when o.stock_deducted and not o.da_huy then t.tong - coalesce(p.da_thu, 0) else 0 end as con_no,
           case when (select la from chu) and o.stock_deducted and not o.da_huy
                then t.tong - t.von - coalesce(cp.chi_phi, 0) else null end as loi_nhuan,
           (o.received_at at time zone 'Asia/Ho_Chi_Minh')::date as ngay
    from public.repair_orders o
    join public.vehicles v on v.id = o.vehicle_id
    join public.customers c on c.id = o.customer_id
    cross join lateral (
      select coalesce(sum(ri.qty * ri.unit_price), 0) as tong,
             case when (select la from chu) then coalesce(sum(case when ri.kind = 'part' then ri.qty * coalesce(rc.cost_price, 0) else 0 end), 0) else 0 end as von
      from public.repair_items ri
      left join public.repair_item_costs rc on rc.item_id = ri.id and (select la from chu)
      where ri.order_id = o.id) t
    left join lateral (select sum(op.so_tien) as da_thu from public.order_payments op where op.order_id = o.id and not op.da_huy) p on true
    left join lateral (select sum(r.amount) as chi_phi from public.repair_costs r where r.order_id = o.id and not r.da_huy and r.kind in ('vat_tu', 'thue_ngoai', 'khac') and (select la from chu)) cp on true
    where public.vai_tro() is not null
  )
  select x.id, x.code, x.received_at, x.status, x.da_huy, x.stock_deducted, x.khach, x.sdt, x.bien_so, x.xe, x.vin, x.odometer,
         x.ktv, x.issue, x.tong, x.da_thu, x.con_no, x.loi_nhuan, x.ngay
  from x
  where (p_trang_thai is null or x.status = any (p_trang_thai))
    and (p_tu is null or x.ngay >= p_tu)
    and (p_den is null or x.ngay <= p_den)
    and (p_ktv is null or exists (select 1 from public.ev_phieu_ky_thuat_vien pk where pk.order_id = x.id and pk.ktv_id = p_ktv))
    and (not coalesce(p_chi_no, false) or x.con_no > 0.5)
    and public.tim_chuan('PT' || lpad(x.code::text, 4, '0') || ' ' || x.bien_so || ' ' || x.khach || ' ' || coalesce(x.sdt, '') || ' ' || coalesce(x.vin, '') || ' ' || x.xe)
        like all (public.tim_tu_khoa(p_tu_khoa))
    and (p_loc is null or p_loc = '{}'::jsonb or not exists (
      select 1 from jsonb_each_text(p_loc) f
      where btrim(f.value) <> '' and public.tim_chuan(
        case f.key
          when 'code' then 'PT' || lpad(x.code::text, 4, '0')
          when 'status' then x.status
          when 'khach' then x.khach
          when 'sdt' then coalesce(x.sdt, '')
          when 'bien_so' then x.bien_so
          when 'xe' then x.xe
          when 'vin' then coalesce(x.vin, '')
          when 'ktv' then coalesce(x.ktv, '')
          when 'issue' then x.issue
          when 'received_at' then to_char(x.ngay, 'DD/MM/YYYY')
          else '' end) not like '%' || public.tim_chuan(f.value) || '%'))
$$;
revoke execute on function public.ds_phieu_co_so(text, text[], date, date, uuid, boolean, jsonb) from public, anon, authenticated;

-- 2. Lấy danh sách có sắp xếp + phân trang (+ lọc theo 1 nhóm khi xem nhóm đang mở) -------------------------------------
create or replace function public.ds_phieu_tiep_nhan(
  p_tu_khoa text, p_trang_thai text[], p_tu date, p_den date, p_ktv uuid, p_chi_no boolean, p_loc jsonb,
  p_sap_xep text, p_huong text, p_gioi_han int, p_bat_dau int, p_nhom_cot text, p_nhom_gia_tri text
) returns table (
  id uuid, code bigint, received_at timestamptz, status text, da_huy boolean, stock_deducted boolean,
  khach text, sdt text, bien_so text, xe text, vin text, odometer integer, ktv text, issue text,
  tong numeric, da_thu numeric, con_no numeric, loi_nhuan numeric, tong_hang bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cot text; v_huong text; v_nhom text; v_gh int := least(greatest(coalesce(p_gioi_han, 50), 1), 20000);
begin
  if public.vai_tro() is null then return; end if;
  v_cot := case p_sap_xep
    when 'code' then 'code' when 'received_at' then 'received_at' when 'status' then 'status'
    when 'khach' then 'lower(khach)' when 'sdt' then 'sdt' when 'bien_so' then 'bien_so' when 'xe' then 'lower(xe)'
    when 'vin' then 'vin' when 'odometer' then 'odometer' when 'ktv' then 'lower(ktv)' when 'issue' then 'lower(issue)'
    when 'tong' then 'tong' when 'da_thu' then 'da_thu' when 'con_no' then 'con_no'
    when 'loi_nhuan' then (case when public.la_chu() then 'loi_nhuan' else 'code' end)
    else 'received_at' end;
  v_huong := case when lower(coalesce(p_huong, '')) = 'asc' then 'asc' else 'desc' end;
  v_nhom := case p_nhom_cot
    when 'status' then 'status' when 'ngay' then 'to_char(ngay, ''DD/MM/YYYY'')'
    when 'khach' then 'khach' when 'ktv' then 'coalesce(ktv, ''(Chưa giao)'')' else null end;
  return query execute
    'select id, code, received_at, status, da_huy, stock_deducted, khach, sdt, bien_so, xe, vin, odometer, ktv, issue, tong, da_thu, con_no, loi_nhuan, count(*) over() as tong_hang '
    || 'from public.ds_phieu_co_so($1, $2, $3, $4, $5, $6, $7) '
    || case when v_nhom is not null and p_nhom_gia_tri is not null then 'where ' || v_nhom || ' = $8 ' else '' end
    || format('order by %s %s nulls last, code desc limit %s offset %s', v_cot, v_huong, v_gh, greatest(coalesce(p_bat_dau, 0), 0))
    using p_tu_khoa, p_trang_thai, p_tu, p_den, p_ktv, p_chi_no, p_loc, p_nhom_gia_tri;
end $$;
revoke execute on function public.ds_phieu_tiep_nhan(text, text[], date, date, uuid, boolean, jsonb, text, text, int, int, text, text) from public, anon;
grant execute on function public.ds_phieu_tiep_nhan(text, text[], date, date, uuid, boolean, jsonb, text, text, int, int, text, text) to authenticated;

-- 3. Các nhóm: số lượng (mọi người) + tổng tiền (chỉ Chủ) --------------------------------------------------------------
create or replace function public.ds_phieu_nhom(
  p_tu_khoa text, p_trang_thai text[], p_tu date, p_den date, p_ktv uuid, p_chi_no boolean, p_loc jsonb, p_nhom_cot text
) returns table (nhom text, so_luong bigint, tong numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_nhom text;
begin
  if public.vai_tro() is null then return; end if;
  v_nhom := case p_nhom_cot
    when 'status' then 'status' when 'ngay' then 'to_char(ngay, ''DD/MM/YYYY'')'
    when 'khach' then 'khach' when 'ktv' then 'coalesce(ktv, ''(Chưa giao)'')' else null end;
  if v_nhom is null then return; end if;
  return query execute
    'select ' || v_nhom || ' as nhom, count(*)::bigint, case when public.la_chu() then sum(tong) else null end '
    || 'from public.ds_phieu_co_so($1, $2, $3, $4, $5, $6, $7) group by 1 '
    || case when p_nhom_cot = 'ngay' then 'order by max(received_at) desc' else 'order by 1' end
    using p_tu_khoa, p_trang_thai, p_tu, p_den, p_ktv, p_chi_no, p_loc;
end $$;
revoke execute on function public.ds_phieu_nhom(text, text[], date, date, uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.ds_phieu_nhom(text, text[], date, date, uuid, boolean, jsonb, text) to authenticated;
