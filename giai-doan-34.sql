-- GIAI ĐOẠN 34: Chia tiền theo KHOẢNG NGÀY tùy chọn (ví dụ 15/10/2026 đến 10/11/2026)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn. Cần đã chạy giai-doan-33.sql.
--
-- ===== CAM KẾT KHÔNG LÀM SAI DỮ LIỆU HIỆN TẠI =====
--  * KHÔNG sửa / xóa dòng phiếu, kho, khoản thu, chi phí, sổ quỹ, kỳ chia tiền, dự phòng nào.
--  * Chỉ thêm hàm mới, viết lại hàm chốt theo tháng để dùng chung luật mới, bỏ chỉ mục "mỗi tháng 1 kỳ".
--  * Cuối file tự kiểm tra: số liệu cũ (quỹ, sổ quỹ, phiếu, kho, kỳ chia tiền, dự phòng) y hệt trước khi chạy. Lệch -> hủy cả file.
--
-- ===== NỘI DUNG =====
--  * Kỳ chia = từ ngày .. đến ngày (tối đa 366 ngày). Phiếu tính theo ngày hoàn thành; thu/chi Sổ quỹ theo ngày ghi sổ.
--  * Hai kỳ đã chốt (chưa hủy) KHÔNG được trùng ngày nhau (chống chia trùng). Muốn chia lại: hủy kỳ cũ (lý do bắt buộc).
--  * Gợi ý "từ ngày" = ngày sau ngày cuối của kỳ đã chốt gần nhất.
--  * Hàm theo tháng (chia_tien_xem_truoc, chia_tien_chot) vẫn dùng được, chạy qua hàm theo khoảng ngày.

-- 0. Chốt chặn + chụp số liệu TRƯỚC khi chạy -----------------------------------------------------------------
do $$
begin
  if to_regclass('public.chia_tien_ky') is null or to_regprocedure('public.chia_tien_tinh_noi_bo(integer, integer)') is null then
    raise exception 'Chưa chạy giai-doan-33.sql. Hãy chạy file đó trước.';
  end if;
end $$;

drop table if exists pg_temp.gd34_truoc;
create temp table gd34_truoc as
select 'quy:' || c.quy as k, public.quy_so_du_noi_bo(c.quy) as v from public.quy_cai_dat c
union all select 'dong_so_quy', count(*)::numeric from public.so_quy
union all select 'tong_so_quy', coalesce(sum(so_tien), 0) from public.so_quy
union all select 'dong_phieu', count(*)::numeric from public.repair_orders
union all select 'tong_bao_gia', coalesce(sum(qty * unit_price), 0) from public.repair_items
union all select 'dong_khoan_thu', count(*)::numeric from public.order_payments
union all select 'tong_chi_phi', coalesce(sum(amount), 0) from public.repair_costs
union all select 'dong_so_kho', count(*)::numeric from public.stock_ledger
union all select 'tong_ton_kho', coalesce(sum(stock), 0) from public.parts
union all select 'dong_ky_chia', count(*)::numeric from public.chia_tien_ky
union all select 'tong_chia', coalesce(sum(phan_chia), 0) from public.chia_tien_ky
union all select 'dong_du_phong', count(*)::numeric from public.du_phong_so
union all select 'tong_du_phong', coalesce(sum(so_tien), 0) from public.du_phong_so;

-- 1. Bỏ luật cũ "mỗi tháng chỉ 1 kỳ" (luật mới: không trùng ngày, kiểm tra trong hàm chốt) ---------------------
drop index if exists public.chia_tien_ky_thang_uq;
create index if not exists chia_tien_ky_khoang_idx on public.chia_tien_ky (tu, den) where not da_huy;

-- 2. Tính số liệu theo khoảng ngày (nội bộ) --------------------------------------------------------------------
create or replace function public.chia_tien_tinh_khoang_noi_bo(p_tu date, p_den date)
returns jsonb language plpgsql stable as $$
declare b record; v_ct jsonb; v_thieu jsonb;
  v_chi_xuong numeric; v_thu_cong numeric; v_chi_pt numeric; v_thu_pt numeric;
begin
  if p_tu is null or p_den is null then raise exception 'Hãy chọn từ ngày và đến ngày'; end if;
  if p_tu > p_den then raise exception 'Từ ngày phải trước hoặc bằng đến ngày'; end if;
  if p_den - p_tu > 365 then raise exception 'Một kỳ tối đa 366 ngày'; end if;

  select coalesce(sum(x.so_phieu), 0) as so_phieu, coalesce(sum(x.doanh_thu), 0) as doanh_thu, coalesce(sum(x.dt_cong), 0) as dt_cong,
         coalesce(sum(x.dt_pt), 0) as dt_pt, coalesce(sum(x.gia_von_pt), 0) as gia_von_pt, coalesce(sum(x.chi_phi_phieu), 0) as chi_phi_phieu
    into b from public.bao_cao_tach_noi_bo(p_tu, p_den, 'thang') x;

  select coalesce(jsonb_agg(jsonb_build_object('loai', c.loai, 'danh_muc', c.danh_muc, 'nhom_chia', c.nhom_chia, 'so_tien', c.so_tien)
                            order by c.loai, c.nhom_chia, c.danh_muc), '[]'::jsonb),
         coalesce(sum(c.so_tien) filter (where c.loai = 'chi' and c.nhom_chia = 'cong'), 0),
         coalesce(sum(c.so_tien) filter (where c.loai = 'thu' and c.nhom_chia = 'cong'), 0),
         coalesce(sum(c.so_tien) filter (where c.loai = 'chi' and c.nhom_chia = 'phu_tung'), 0),
         coalesce(sum(c.so_tien) filter (where c.loai = 'thu' and c.nhom_chia = 'phu_tung'), 0)
    into v_ct, v_chi_xuong, v_thu_cong, v_chi_pt, v_thu_pt
    from public.chia_thu_chi_noi_bo(p_tu, p_den) c;

  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'ma_phieu', o.code, 'so_dong', x.pt_thieu_gia) order by o.code), '[]'::jsonb)
    into v_thieu
    from public.repair_orders o cross join lateral public.tach_phieu_noi_bo(o.id) x
    where o.stock_deducted and not o.da_huy and o.paid_at >= p_tu and o.paid_at <= p_den and x.pt_thieu_gia > 0;

  return jsonb_build_object(
    'tu', p_tu, 'den', p_den,
    'so_phieu', b.so_phieu, 'doanh_thu', b.doanh_thu, 'dt_cong', b.dt_cong, 'chi_phi_phieu', b.chi_phi_phieu,
    'chi_xuong', v_chi_xuong, 'thu_cong', v_thu_cong,
    'dt_pt', b.dt_pt, 'gia_von_pt', b.gia_von_pt, 'chi_pt', v_chi_pt, 'thu_pt', v_thu_pt,
    'chi_tiet', v_ct, 'pt_thieu_gia', v_thieu);
end $$;
revoke execute on function public.chia_tien_tinh_khoang_noi_bo(date, date) from public, anon, authenticated;

-- Hàm theo tháng của giai đoạn 33: nay gọi hàm theo khoảng (kết quả y hệt, thêm nam/thang)
create or replace function public.chia_tien_tinh_noi_bo(p_nam int, p_thang int)
returns jsonb language plpgsql stable as $$
declare v_tu date;
begin
  if p_nam is null or p_thang is null or p_nam < 2000 or p_nam > 2100 or p_thang < 1 or p_thang > 12 then
    raise exception 'Tháng hoặc năm không hợp lệ';
  end if;
  v_tu := make_date(p_nam, p_thang, 1);
  return public.chia_tien_tinh_khoang_noi_bo(v_tu, (v_tu + interval '1 month' - interval '1 day')::date)
         || jsonb_build_object('nam', p_nam, 'thang', p_thang);
end $$;
revoke execute on function public.chia_tien_tinh_noi_bo(int, int) from public, anon, authenticated;

-- 3. Xem trước theo khoảng ngày (chỉ Chủ) ----------------------------------------------------------------------
-- ky_da_chot: kỳ đã chốt có ĐÚNG khoảng ngày này. ky_trung: các kỳ đã chốt khác có ngày trùng (không chốt được).
create or replace function public.chia_tien_xem_truoc_khoang(p_tu date, p_den date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; k record;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem chia tiền'; end if;
  v := public.chia_tien_tinh_khoang_noi_bo(p_tu, p_den);
  select * into k from public.chia_tien_ky where tu = p_tu and den = p_den and not da_huy order by created_at desc limit 1;
  return v || jsonb_build_object(
    'ky_da_chot', case when k.id is null then null else to_jsonb(k) end,
    'nguoi_da_chot', (select coalesce(jsonb_agg(to_jsonb(n) order by n.thu_tu), '[]'::jsonb) from public.chia_tien_nguoi n where n.ky_id = k.id),
    'ky_trung', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tu', c.tu, 'den', c.den) order by c.tu), '[]'::jsonb)
                 from public.chia_tien_ky c
                 where not c.da_huy and c.tu <= p_den and c.den >= p_tu and c.id is distinct from k.id),
    'goi_y_tu', (select max(c.den) + 1 from public.chia_tien_ky c where not c.da_huy),
    'du_phong_so_du', public.du_phong_so_du_noi_bo(),
    'hom_nay', public.ngay_hom_nay());
end $$;
revoke execute on function public.chia_tien_xem_truoc_khoang(date, date) from public, anon;
grant execute on function public.chia_tien_xem_truoc_khoang(date, date) to authenticated;

-- 4. Chốt theo khoảng ngày: máy chủ TỰ TÍNH LẠI mọi con số; chặn trùng ngày với kỳ đã chốt ----------------------
create or replace function public.chia_tien_chot_khoang(p_tu date, p_den date, p_du_phong_pt numeric, p_khoan_khac numeric,
                                                        p_khoan_khac_ghi_chu text, p_nguoi jsonb, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v jsonb; v_id uuid; v_phan_cong numeric; v_du numeric; v_chia numeric; v_ln_pt numeric;
  v_kk numeric := coalesce(p_khoan_khac, 0); v_kk_gc text := nullif(btrim(coalesce(p_khoan_khac_ghi_chu, '')), '');
  v_tong_pt numeric; v_n int; v_da numeric := 0; r record; v_tien numeric; v_i int := 0; t record;
  v_ten_ky text := to_char(p_tu, 'DD/MM/YYYY') || ' - ' || to_char(p_den, 'DD/MM/YYYY');
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được chốt chia tiền'; end if;
  if p_tu is null or p_den is null then raise exception 'Hãy chọn từ ngày và đến ngày'; end if;
  if p_tu > p_den then raise exception 'Từ ngày phải trước hoặc bằng đến ngày'; end if;
  if p_tu > public.ngay_hom_nay() then raise exception 'Không chốt được kỳ chưa tới'; end if;
  if p_du_phong_pt is null or p_du_phong_pt < 0 or p_du_phong_pt > 100 then raise exception 'Phần trăm dự phòng phải từ 0 đến 100'; end if;
  if v_kk <> round(v_kk) then raise exception 'Khoản cộng/trừ khác phải là số nguyên'; end if;
  if v_kk <> 0 and v_kk_gc is null then raise exception 'Có khoản cộng/trừ khác thì phải ghi chú lý do'; end if;
  if char_length(coalesce(v_kk_gc, '')) > 500 or char_length(coalesce(p_ghi_chu, '')) > 500 then raise exception 'Ghi chú quá dài'; end if;
  if jsonb_typeof(p_nguoi) is distinct from 'array' or jsonb_array_length(p_nguoi) = 0 then raise exception 'Hãy nhập ít nhất một người nhận'; end if;
  if jsonb_array_length(p_nguoi) > 30 then raise exception 'Tối đa 30 người'; end if;
  if exists (select 1 from jsonb_array_elements(p_nguoi) e
             where btrim(coalesce(e->>'ten', '')) = '' or (e->>'phan_tram') is null
                or (e->>'phan_tram')::numeric < 0 or (e->>'phan_tram')::numeric > 100) then
    raise exception 'Mỗi người phải có tên và phần trăm từ 0 đến 100';
  end if;
  select count(*), coalesce(sum((e->>'phan_tram')::numeric), 0) into v_n, v_tong_pt from jsonb_array_elements(p_nguoi) e;
  if abs(v_tong_pt - 100) > 0.001 then raise exception 'Tổng phần trăm chia phải đúng 100 (đang là %)', v_tong_pt; end if;

  -- Khóa chung cho mọi lần chốt: hai người bấm cùng lúc cũng không tạo kỳ trùng ngày
  perform pg_advisory_xact_lock(hashtext('chia_tien_chot'));
  select * into t from public.chia_tien_ky c where not c.da_huy and c.tu <= p_den and c.den >= p_tu order by c.tu limit 1;
  if found then
    raise exception 'Trùng ngày với kỳ đã chốt % - %. Chọn ngày khác hoặc hủy kỳ đó trước (lý do bắt buộc)',
      to_char(t.tu, 'DD/MM/YYYY'), to_char(t.den, 'DD/MM/YYYY');
  end if;

  v := public.chia_tien_tinh_khoang_noi_bo(p_tu, p_den);
  v_phan_cong := (v->>'dt_cong')::numeric - (v->>'chi_phi_phieu')::numeric - (v->>'chi_xuong')::numeric + (v->>'thu_cong')::numeric + v_kk;
  if v_phan_cong > 0 then
    v_du := round(v_phan_cong * p_du_phong_pt / 100);
    v_chia := v_phan_cong - v_du;
  else
    v_du := 0; v_chia := 0;
  end if;
  v_ln_pt := (v->>'dt_pt')::numeric - (v->>'gia_von_pt')::numeric - (v->>'chi_pt')::numeric + (v->>'thu_pt')::numeric;

  insert into public.chia_tien_ky (nam, thang, tu, den, so_phieu, doanh_thu, dt_cong, chi_phi_phieu, chi_xuong, thu_cong, khoan_khac,
      khoan_khac_ghi_chu, phan_cong, du_phong_pt, du_phong, phan_chia, dt_pt, gia_von_pt, chi_pt, thu_pt, ln_pt_chu, chi_tiet, ghi_chu)
  values (extract(year from p_den)::int, extract(month from p_den)::int, p_tu, p_den, (v->>'so_phieu')::int, (v->>'doanh_thu')::numeric,
      (v->>'dt_cong')::numeric, (v->>'chi_phi_phieu')::numeric, (v->>'chi_xuong')::numeric, (v->>'thu_cong')::numeric, v_kk, v_kk_gc,
      v_phan_cong, p_du_phong_pt, v_du, v_chia, (v->>'dt_pt')::numeric, (v->>'gia_von_pt')::numeric, (v->>'chi_pt')::numeric,
      (v->>'thu_pt')::numeric, v_ln_pt, v->'chi_tiet', nullif(btrim(coalesce(p_ghi_chu, '')), ''))
  returning id into v_id;

  for r in select btrim(e->>'ten') as ten, (e->>'phan_tram')::numeric as pt, ord from jsonb_array_elements(p_nguoi) with ordinality as x(e, ord) order by ord loop
    v_i := v_i + 1;
    v_tien := case when v_i = v_n then v_chia - v_da else round(v_chia * r.pt / 100) end;
    v_da := v_da + v_tien;
    insert into public.chia_tien_nguoi (ky_id, thu_tu, ten, phan_tram, so_tien) values (v_id, v_i, r.ten, r.pt, v_tien);
  end loop;

  if v_du > 0 then
    insert into public.du_phong_so (ngay, loai, so_tien, ky_id, ly_do)
      values (least(p_den, public.ngay_hom_nay()), 'trich', v_du, v_id, 'Trích dự phòng kỳ ' || v_ten_ky);
  end if;

  perform public.ghi_nhat_ky('chot_chia_tien', 'Chia tiền', v_ten_ky, null, null, 'chia_tien_ky', v_id, null,
    jsonb_build_object('phan_cong', v_phan_cong, 'du_phong_pt', p_du_phong_pt, 'du_phong', v_du, 'phan_chia', v_chia,
                       'ln_phu_tung_chu', v_ln_pt, 'khoan_khac', v_kk, 'nguoi', p_nguoi), v_kk_gc);
  return v_id;
end $$;
revoke execute on function public.chia_tien_chot_khoang(date, date, numeric, numeric, text, jsonb, text) from public, anon;
grant execute on function public.chia_tien_chot_khoang(date, date, numeric, numeric, text, jsonb, text) to authenticated;

-- Hàm chốt theo tháng (giai đoạn 33): nay đi qua hàm theo khoảng ngày (cùng luật không trùng ngày)
create or replace function public.chia_tien_chot(p_nam int, p_thang int, p_du_phong_pt numeric, p_khoan_khac numeric,
                                                 p_khoan_khac_ghi_chu text, p_nguoi jsonb, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tu date;
begin
  if p_nam is null or p_thang is null or p_nam < 2000 or p_nam > 2100 or p_thang < 1 or p_thang > 12 then
    raise exception 'Tháng hoặc năm không hợp lệ';
  end if;
  v_tu := make_date(p_nam, p_thang, 1);
  return public.chia_tien_chot_khoang(v_tu, (v_tu + interval '1 month' - interval '1 day')::date,
                                      p_du_phong_pt, p_khoan_khac, p_khoan_khac_ghi_chu, p_nguoi, p_ghi_chu);
end $$;
revoke execute on function public.chia_tien_chot(int, int, numeric, numeric, text, jsonb, text) from public, anon;
grant execute on function public.chia_tien_chot(int, int, numeric, numeric, text, jsonb, text) to authenticated;

-- Hủy kỳ: ghi tên kỳ theo khoảng ngày trong nhật ký và lý do đảo dự phòng
create or replace function public.chia_tien_huy(p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare k record; d record; v_ly text := nullif(btrim(coalesce(p_ly_do, '')), ''); v_ten_ky text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy kỳ chia tiền'; end if;
  if v_ly is null then raise exception 'Hãy nhập lý do hủy'; end if;
  select * into k from public.chia_tien_ky where id = p_id for update;
  if not found then raise exception 'Không tìm thấy kỳ chia tiền'; end if;
  if k.da_huy then raise exception 'Kỳ này đã hủy rồi'; end if;
  v_ten_ky := to_char(k.tu, 'DD/MM/YYYY') || ' - ' || to_char(k.den, 'DD/MM/YYYY');
  perform set_config('app.chia_tien', '1', true);
  update public.chia_tien_ky set da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(),
    huy_boi_ten = public.ten_nguoi_dung(auth.uid()), huy_luc = now() where id = p_id;
  perform set_config('app.chia_tien', '', true);
  for d in select * from public.du_phong_so s where s.ky_id = p_id and s.loai = 'trich'
             and not exists (select 1 from public.du_phong_so r where r.dao_cua = s.id) loop
    insert into public.du_phong_so (loai, so_tien, ky_id, ly_do, dao_cua)
      values ('dao', -d.so_tien, p_id, 'Hủy kỳ ' || v_ten_ky || ': ' || v_ly, d.id);
  end loop;
  perform public.ghi_nhat_ky('huy_chia_tien', 'Chia tiền', v_ten_ky, null, null, 'chia_tien_ky', p_id,
    jsonb_build_object('phan_chia', k.phan_chia, 'du_phong', k.du_phong), null, v_ly);
end $$;
revoke execute on function public.chia_tien_huy(uuid, text) from public, anon;
grant execute on function public.chia_tien_huy(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- 5. KIỂM TRA TỰ ĐỘNG (lệch -> báo lỗi, Supabase hủy toàn bộ file) ---------------------------------------------------
do $$
declare v_lech text; v_a jsonb; v_b jsonb;
begin
  select string_agg(t.k || ' (trước ' || t.v || ', sau ' || coalesce(s.v::text, 'không có') || ')', '; ') into v_lech
  from pg_temp.gd34_truoc t
  left join (
    select 'quy:' || c.quy as k, public.quy_so_du_noi_bo(c.quy) as v from public.quy_cai_dat c
    union all select 'dong_so_quy', count(*)::numeric from public.so_quy
    union all select 'tong_so_quy', coalesce(sum(so_tien), 0) from public.so_quy
    union all select 'dong_phieu', count(*)::numeric from public.repair_orders
    union all select 'tong_bao_gia', coalesce(sum(qty * unit_price), 0) from public.repair_items
    union all select 'dong_khoan_thu', count(*)::numeric from public.order_payments
    union all select 'tong_chi_phi', coalesce(sum(amount), 0) from public.repair_costs
    union all select 'dong_so_kho', count(*)::numeric from public.stock_ledger
    union all select 'tong_ton_kho', coalesce(sum(stock), 0) from public.parts
    union all select 'dong_ky_chia', count(*)::numeric from public.chia_tien_ky
    union all select 'tong_chia', coalesce(sum(phan_chia), 0) from public.chia_tien_ky
    union all select 'dong_du_phong', count(*)::numeric from public.du_phong_so
    union all select 'tong_du_phong', coalesce(sum(so_tien), 0) from public.du_phong_so
  ) s on s.k = t.k
  where s.v is distinct from t.v;
  if v_lech is not null then raise exception 'DỪNG: số liệu cũ bị thay đổi: %', v_lech; end if;

  -- Tháng hiện tại: tính theo tháng và theo khoảng ngày phải ra cùng số
  v_a := public.chia_tien_tinh_noi_bo(extract(year from public.ngay_hom_nay())::int, extract(month from public.ngay_hom_nay())::int) - 'nam' - 'thang';
  v_b := public.chia_tien_tinh_khoang_noi_bo(date_trunc('month', public.ngay_hom_nay())::date,
           (date_trunc('month', public.ngay_hom_nay()) + interval '1 month' - interval '1 day')::date);
  if v_a is distinct from v_b then raise exception 'DỪNG: tính theo tháng khác tính theo khoảng ngày'; end if;
end $$;

-- Kết quả xem sau khi Run: các kỳ đã chốt (không được có 2 kỳ chưa hủy trùng ngày; cột trung phải = 0)
select to_char(k.tu, 'DD/MM/YYYY') as tu_ngay, to_char(k.den, 'DD/MM/YYYY') as den_ngay, k.phan_chia, k.du_phong, k.ln_pt_chu, k.da_huy,
       (select count(*) from public.chia_tien_ky c where not c.da_huy and not k.da_huy and c.id <> k.id and c.tu <= k.den and c.den >= k.tu) as trung
from public.chia_tien_ky k
order by k.tu desc, k.created_at desc;
