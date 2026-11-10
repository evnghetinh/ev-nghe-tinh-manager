-- GIAI ĐOẠN 26: Nối "Chi phí của phiếu" với Sổ quỹ
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không ghi trùng). Cần đã chạy giai-doan-10, 20 và 21.
--
-- ===== NỘI DUNG =====
--  * KHÔNG đổi cách tính lợi nhuận phiếu (vẫn = doanh thu - giá vốn phụ tùng - chi phí chưa hủy).
--  * Mỗi chi phí phiếu có "hình thức chi": Tiền mặt / Chuyển khoản / Chưa chi.
--      Tiền mặt -> dòng chi vào quỹ "Tiền mặt"; Chuyển khoản -> quỹ "Tài khoản ngân hàng".
--      Dòng quỹ liên kết với khoản chi phí (chi_phi_id) và phiếu (order_id), có cờ da_tinh_qua_chi_phi = true
--      để báo cáo lãi lỗ sau này KHÔNG tính trùng (khoản này đã nằm trong lợi nhuận phiếu qua chi phí phiếu).
--  * Chi vượt số dư quỹ: phải xác nhận + lý do (máy chủ kiểm tra, không chỉ giao diện).
--  * Sửa số tiền / quỹ / loại / ngày của chi phí đã ghi quỹ: thêm dòng ĐẢO cho dòng cũ rồi dòng mới (lý do bắt buộc). Không sửa dòng cũ.
--  * Hủy chi phí: đảo dòng quỹ liên kết (dùng lý do hủy).
--  * Chi phí cũ: KHÔNG tự đổi quỹ. Trạng thái "Chưa ghi vào sổ quỹ"; Chủ chọn quỹ + ngày rồi bấm "Ghi vào sổ quỹ".
--  * Đối chiếu: chi_phi_quy_doi_chieu() liệt kê khoản lệch giữa chi phí đã ghi quỹ và các dòng quỹ liên kết.
--  * Chỉ Chủ xưởng dùng. Mọi thao tác ghi nhật ký hoạt động (người thực hiện + giờ máy chủ).

-- 1. Cột mới -----------------------------------------------------------------------------------------------
-- Trạng thái ghi quỹ của chi phí: chua_ghi = chi phí cũ chưa ghi quỹ; chua_chi = chưa chi tiền; da_ghi = đã có dòng chi trong sổ quỹ
alter table public.repair_costs add column if not exists trang_thai_quy text not null default 'chua_ghi';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'repair_costs_trang_thai_quy_hop_le') then
    alter table public.repair_costs add constraint repair_costs_trang_thai_quy_hop_le
      check (trang_thai_quy in ('chua_ghi', 'chua_chi', 'da_ghi'));
  end if;
end $$;

alter table public.so_quy add column if not exists chi_phi_id uuid references public.repair_costs(id);
alter table public.so_quy add column if not exists da_tinh_qua_chi_phi boolean not null default false;
create index if not exists so_quy_chi_phi_idx on public.so_quy (chi_phi_id) where chi_phi_id is not null;

-- Hai loại chi mới (các loại chi cũ giữ nguyên)
insert into public.loai_phieu_chi (ten, tinh_vao_lai_lo, thu_tu, ghi_chu) values
  ('Vật tư tiêu hao', true, 7, 'Vật tư dùng hết khi sửa xe: tính vào lãi lỗ'),
  ('Thuê ngoài',      true, 8, 'Thuê ngoài làm một phần việc: tính vào lãi lỗ')
on conflict (ten) do nothing;

-- View sổ quỹ: thêm 2 cột ở cuối (các cột cũ giữ nguyên thứ tự)
create or replace view public.so_quy_xem with (security_invoker = true) as
select s.id, s.seq, s.created_at, s.ngay, s.loai, s.quy, s.so_tien, s.so_phieu, s.nhom_id, s.doi_tuong, s.doi_tuong_ten,
       s.order_id, s.payment_id, s.import_id, s.danh_muc, s.tinh_vao_lai_lo, s.ghi_chu, s.dao_cua, s.ly_do,
       s.created_by, s.created_by_name,
       (select 'PT' || lpad(o.code::text, 4, '0') from public.repair_orders o where o.id = s.order_id) as ma_phieu_sua,
       exists (select 1 from public.so_quy r where r.dao_cua = s.id) as da_dao,
       c.so_du_dau + sum(case when s.ngay >= c.ngay_bat_dau then s.so_tien else 0 end) over (partition by s.quy order by s.seq) as so_du_sau,
       s.chi_phi_id, s.da_tinh_qua_chi_phi
from public.so_quy s
left join public.quy_cai_dat c on c.quy = s.quy;
revoke all on public.so_quy_xem from anon, authenticated;
grant select on public.so_quy_xem to authenticated;

-- 2. Hàm phụ (nội bộ) ------------------------------------------------------------------------------------------
create or replace function public.cp_ten_loai(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'vat_tu' then 'Vật tư tiêu hao' when 'thue_ngoai' then 'Thuê ngoài' else 'Chi khác' end
$$;

create or replace function public.cp_ten_quy(p_hinh_thuc text) returns text
language sql immutable as $$
  select case p_hinh_thuc when 'tien_mat' then 'Tiền mặt' when 'chuyen_khoan' then 'Tài khoản ngân hàng' else null end
$$;

-- Dòng chi đang hiệu lực (chưa bị đảo) của 1 khoản chi phí
create or replace function public.cp_dong_hien_tai(p_cost uuid) returns setof public.so_quy
language sql stable security definer set search_path = public as $$
  select s.* from public.so_quy s
  where s.chi_phi_id = p_cost and s.loai = 'chi' and not exists (select 1 from public.so_quy d where d.dao_cua = s.id)
$$;
revoke execute on function public.cp_dong_hien_tai(uuid) from public, anon, authenticated;

-- Đảo mọi dòng chi đang hiệu lực của 1 khoản chi phí (dòng cũ giữ nguyên). Trả về số dòng đảo.
create or replace function public.cp_dao(p_cost uuid, p_ly_do text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_ngay date; v_ly text := btrim(coalesce(p_ly_do, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được thao tác sổ quỹ'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do'; end if;
  perform pg_advisory_xact_lock(7210021);
  for r in select * from public.cp_dong_hien_tai(p_cost) loop
    v_ngay := case when exists (select 1 from public.quy_cai_dat c where c.quy = r.quy and r.ngay < c.ngay_bat_dau) then r.ngay else public.ngay_hom_nay() end;
    insert into public.so_quy (loai, quy, so_tien, ngay, doi_tuong, doi_tuong_ten, order_id, import_id, danh_muc, tinh_vao_lai_lo, ghi_chu,
                               dao_cua, ly_do, chi_phi_id, da_tinh_qua_chi_phi)
    values ('dao', r.quy, -r.so_tien, v_ngay, r.doi_tuong, r.doi_tuong_ten, r.order_id, null, coalesce(r.danh_muc, 'Chi phí phiếu'), false,
            'Đảo ' || coalesce(r.so_phieu, 'chi') || coalesce(' - ' || r.ghi_chu, ''), r.id, v_ly, p_cost, true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.cp_dao(uuid, text) from public, anon, authenticated;

-- Ghi 1 dòng chi vào sổ quỹ cho khoản chi phí (đọc số tiền / loại / nội dung hiện tại của khoản chi phí).
-- Báo lỗi bắt đầu bằng "VUOT_SO_DU|" nếu chi lớn hơn số dư mà chưa xác nhận.
create or replace function public.cp_ghi_quy(p_cost uuid, p_hinh_thuc text, p_ngay date, p_vuot boolean, p_vuot_ly_do text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_quy text := public.cp_ten_quy(p_hinh_thuc); v_ngay date; v_bd date; v_du numeric; v_so bigint; v_ma text;
        v_code bigint; v_dm text; v_vl text := btrim(coalesce(p_vuot_ly_do, '')); v_ly text; v_id uuid;
begin
  if v_quy is null then raise exception 'Hình thức chi không hợp lệ (chọn Tiền mặt hoặc Chuyển khoản)'; end if;
  perform public.so_quy_kiem_tra_chung(v_quy);
  select * into c from public.repair_costs where id = p_cost;
  if not found then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if c.amount <= 0 then raise exception 'Số tiền phải lớn hơn 0 mới ghi vào sổ quỹ được'; end if;
  select code into v_code from public.repair_orders where id = c.order_id;
  v_ngay := coalesce(p_ngay, public.ngay_hom_nay());
  select ngay_bat_dau into v_bd from public.quy_cai_dat where quy = v_quy;
  if v_ngay > public.ngay_hom_nay() then raise exception 'Ngày chi không được ở tương lai'; end if;
  if v_ngay < v_bd then raise exception 'Ngày chi không được trước ngày bắt đầu của quỹ "%" (%)', v_quy, to_char(v_bd, 'DD/MM/YYYY'); end if;

  v_du := public.quy_so_du_noi_bo(v_quy);
  if c.amount > v_du then
    if not coalesce(p_vuot, false) or v_vl = '' then
      raise exception 'VUOT_SO_DU|Quỹ "%" chỉ còn % đ, nhỏ hơn số chi % đ. Cần xác nhận "chi vượt số dư" kèm lý do', v_quy, round(v_du), round(c.amount);
    end if;
    if char_length(v_vl) > 400 then raise exception 'Lý do chi vượt số dư quá dài (tối đa 400 ký tự)'; end if;
    v_ly := 'Chi vượt số dư (quỹ còn ' || round(v_du) || ' đ): ' || v_vl;
  end if;

  v_dm := public.cp_ten_loai(c.kind);
  update public.so_quy_dem set so = so + 1 where loai = 'CHI' returning so into v_so;
  v_ma := 'CHI' || lpad(v_so::text, 4, '0');
  insert into public.so_quy (loai, quy, so_tien, ngay, so_phieu, doi_tuong, order_id, danh_muc, tinh_vao_lai_lo, ghi_chu, ly_do, chi_phi_id, da_tinh_qua_chi_phi)
  values ('chi', v_quy, -c.amount, v_ngay, v_ma, 'khac', c.order_id, v_dm, false,
          'PT' || lpad(coalesce(v_code, 0)::text, 4, '0') || ' - ' || c.content, v_ly, c.id, true)
  returning id into v_id;
  perform public.ghi_nhat_ky('chi_phi_ghi_quy', 'Sổ quỹ', v_ma, c.content, v_code, 'so_quy', v_id, null,
    jsonb_build_object('quy', v_quy, 'so_tien', c.amount, 'loai_chi', v_dm, 'ngay', v_ngay, 'chi_phi_id', c.id, 'da_tinh_qua_chi_phi', true,
                       'chi_vuot_so_du', v_ly is not null), v_ly);
  return v_id;
end $$;
revoke execute on function public.cp_ghi_quy(uuid, text, date, boolean, text) from public, anon, authenticated;

-- 3. Hàm cho giao diện (chỉ Chủ) ---------------------------------------------------------------------------------
-- p_hinh_thuc: 'tien_mat' | 'chuyen_khoan' | 'chua_chi'
create or replace function public.chi_phi_phieu_them(p_order uuid, p_kind text, p_content text, p_amount numeric, p_note text,
  p_hinh_thuc text, p_ngay date, p_vuot boolean, p_vuot_ly_do text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_content text := btrim(coalesce(p_content, '')); v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_ten text; v_ghi boolean;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được nhập chi phí'; end if;
  if p_kind not in ('vat_tu', 'thue_ngoai', 'khac') then raise exception 'Loại chi phí không hợp lệ'; end if;
  if v_content = '' then raise exception 'Hãy nhập nội dung chi phí'; end if;
  if char_length(v_content) > 300 or char_length(coalesce(v_note, '')) > 500 then raise exception 'Nội dung quá dài'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  if p_hinh_thuc not in ('tien_mat', 'chuyen_khoan', 'chua_chi') then raise exception 'Hình thức chi không hợp lệ'; end if;
  v_ghi := p_hinh_thuc <> 'chua_chi';
  if v_ghi and round(p_amount) <= 0 then raise exception 'Số tiền phải lớn hơn 0 mới ghi vào sổ quỹ được'; end if;
  perform 1 from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());

  insert into public.repair_costs (order_id, kind, content, amount, note, trang_thai_quy)
    values (p_order, p_kind, v_content, round(p_amount), v_note, case when v_ghi then 'da_ghi' else 'chua_chi' end)
    returning id into v_id;
  if v_ghi then perform public.cp_ghi_quy(v_id, p_hinh_thuc, p_ngay, p_vuot, p_vuot_ly_do); end if;
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
    values (p_order, 'them', p_kind, v_content, null, round(p_amount), v_note,
            case p_hinh_thuc when 'tien_mat' then 'Đã chi: Tiền mặt' when 'chuyen_khoan' then 'Đã chi: Chuyển khoản' else 'Chưa chi' end, v_ten);
  return v_id;
end $$;
revoke execute on function public.chi_phi_phieu_them(uuid, text, text, numeric, text, text, date, boolean, text) from public, anon;
grant execute on function public.chi_phi_phieu_them(uuid, text, text, numeric, text, text, date, boolean, text) to authenticated;

-- p_hinh_thuc: 'tien_mat' | 'chuyen_khoan' | 'chua_chi' | 'giu_nguyen'
-- Khoản đã ghi quỹ mà đổi số tiền / quỹ / loại / ngày chi: phải có lý do (p_ly_do); dòng cũ được đảo, thêm dòng mới.
create or replace function public.chi_phi_phieu_sua(p_id uuid, p_kind text, p_content text, p_amount numeric, p_note text,
  p_hinh_thuc text, p_ngay date, p_vuot boolean, p_vuot_ly_do text, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; cur record; v_content text := btrim(coalesce(p_content, '')); v_note text := nullif(btrim(coalesce(p_note, '')), '');
        v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text; v_detail text := ''; v_hinh text := p_hinh_thuc; v_ngay date;
        v_quy_moi text; v_trang_thai text; v_dao boolean := false; v_ghi boolean := false;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được sửa chi phí'; end if;
  if p_kind not in ('vat_tu', 'thue_ngoai', 'khac') then raise exception 'Loại chi phí không hợp lệ'; end if;
  if v_content = '' then raise exception 'Hãy nhập nội dung chi phí'; end if;
  if char_length(v_content) > 300 or char_length(coalesce(v_note, '')) > 500 or char_length(v_ly) > 500 then raise exception 'Nội dung quá dài'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  if p_hinh_thuc not in ('tien_mat', 'chuyen_khoan', 'chua_chi', 'giu_nguyen') then raise exception 'Hình thức chi không hợp lệ'; end if;
  perform pg_advisory_xact_lock(7210021);
  select * into c from public.repair_costs where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if c.da_huy then raise exception 'Khoản chi phí đã hủy, không sửa được'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());
  select * into cur from public.cp_dong_hien_tai(p_id);

  if c.trang_thai_quy = 'da_ghi' and cur.id is not null then
    if v_hinh = 'giu_nguyen' then v_hinh := case cur.quy when 'Tiền mặt' then 'tien_mat' else 'chuyen_khoan' end; end if;
    if v_hinh = 'chua_chi' then
      v_dao := true; v_trang_thai := 'chua_chi';
    else
      v_quy_moi := public.cp_ten_quy(v_hinh);
      v_ngay := coalesce(p_ngay, cur.ngay);
      v_ghi := true; v_trang_thai := 'da_ghi';
      v_dao := round(p_amount) <> c.amount or v_quy_moi <> cur.quy or p_kind <> c.kind or v_ngay <> cur.ngay;
      if v_ghi and round(p_amount) <= 0 then raise exception 'Số tiền phải lớn hơn 0 mới ghi vào sổ quỹ được'; end if;
    end if;
    if v_dao and v_ly = '' then raise exception 'Khoản này đã ghi sổ quỹ: bắt buộc nhập lý do sửa (dòng cũ sẽ được đảo, không sửa)'; end if;
  else
    -- chưa ghi quỹ (chi phí cũ hoặc "Chưa chi")
    if v_hinh = 'giu_nguyen' then
      v_trang_thai := c.trang_thai_quy;
    elsif v_hinh = 'chua_chi' then
      v_trang_thai := 'chua_chi';
    else
      if round(p_amount) <= 0 then raise exception 'Số tiền phải lớn hơn 0 mới ghi vào sổ quỹ được'; end if;
      v_ghi := true; v_trang_thai := 'da_ghi'; v_ngay := p_ngay;
    end if;
  end if;

  if c.kind <> p_kind then v_detail := v_detail || 'Loại: ' || public.cp_ten_loai(c.kind) || ' → ' || public.cp_ten_loai(p_kind) || '. '; end if;
  if c.content <> v_content then v_detail := v_detail || 'Nội dung: "' || c.content || '" → "' || v_content || '". '; end if;
  if c.note is distinct from v_note then v_detail := v_detail || 'Ghi chú: "' || coalesce(c.note, '') || '" → "' || coalesce(v_note, '') || '". '; end if;
  if v_trang_thai is distinct from c.trang_thai_quy or v_dao then
    v_detail := v_detail || 'Sổ quỹ: ' || case v_trang_thai when 'da_ghi' then 'đã chi ' || coalesce(public.cp_ten_quy(v_hinh), '') else 'chưa chi' end
                || case when v_dao then ' (đảo dòng cũ, lý do: ' || coalesce(nullif(v_ly, ''), 'không') || ')' else '' end || '. ';
  end if;

  update public.repair_costs set kind = p_kind, content = v_content, amount = round(p_amount), note = v_note, trang_thai_quy = v_trang_thai where id = p_id;
  if v_dao then
    perform public.cp_dao(p_id, 'Sửa chi phí phiếu: ' || v_ly);
  end if;
  if v_ghi and (v_dao or c.trang_thai_quy <> 'da_ghi') then
    perform public.cp_ghi_quy(p_id, v_hinh, v_ngay, p_vuot, p_vuot_ly_do);
  end if;
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
    values (c.order_id, 'sua', p_kind, v_content, c.amount, round(p_amount), v_note, nullif(btrim(v_detail), ''), v_ten);
end $$;
revoke execute on function public.chi_phi_phieu_sua(uuid, text, text, numeric, text, text, date, boolean, text, text) from public, anon;
grant execute on function public.chi_phi_phieu_sua(uuid, text, text, numeric, text, text, date, boolean, text, text) to authenticated;

-- "Ghi đã chi" (khoản Chưa chi) và "Ghi vào sổ quỹ" (chi phí cũ): chọn hình thức + ngày chi rồi tạo dòng quỹ
create or replace function public.chi_phi_phieu_ghi_quy(p_id uuid, p_hinh_thuc text, p_ngay date, p_vuot boolean, p_vuot_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_ten text; v_quy text := public.cp_ten_quy(p_hinh_thuc);
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được ghi sổ quỹ'; end if;
  if v_quy is null then raise exception 'Hãy chọn Tiền mặt hoặc Chuyển khoản'; end if;
  perform pg_advisory_xact_lock(7210021);
  select * into c from public.repair_costs where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if c.da_huy then raise exception 'Khoản chi phí đã hủy'; end if;
  if c.trang_thai_quy = 'da_ghi' then raise exception 'Khoản này đã ghi vào sổ quỹ rồi'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());
  perform public.cp_ghi_quy(p_id, p_hinh_thuc, p_ngay, p_vuot, p_vuot_ly_do);
  update public.repair_costs set trang_thai_quy = 'da_ghi' where id = p_id;
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
    values (c.order_id, 'sua', c.kind, c.content, c.amount, c.amount, c.note,
            'Ghi vào sổ quỹ: ' || v_quy || ', ngày ' || to_char(coalesce(p_ngay, public.ngay_hom_nay()), 'DD/MM/YYYY'), v_ten);
end $$;
revoke execute on function public.chi_phi_phieu_ghi_quy(uuid, text, date, boolean, text) from public, anon;
grant execute on function public.chi_phi_phieu_ghi_quy(uuid, text, date, boolean, text) to authenticated;

-- Hủy chi phí (thay bản của giai đoạn 20): thêm đảo dòng quỹ liên kết
create or replace function public.chi_phi_huy(p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text; v_dao int := 0;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy chi phí'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy chi phí'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  perform pg_advisory_xact_lock(7210021);
  select * into c from public.repair_costs where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if c.da_huy then raise exception 'Khoản chi phí này đã hủy rồi'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());
  v_dao := public.cp_dao(p_id, 'Hủy chi phí phiếu: ' || v_ly);
  perform set_config('app.huy_cp', '1', true);
  perform set_config('app.hanh_dong', 'huy_chi_phi', true);
  perform set_config('app.ly_do', v_ly, true);
  update public.repair_costs set da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(), huy_boi_ten = v_ten, huy_luc = now() where id = p_id;
  perform set_config('app.huy_cp', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
    values (c.order_id, 'huy', c.kind, c.content, c.amount, null, c.note,
            'Hủy chi phí. Lý do: ' || v_ly || case when v_dao > 0 then ' (đã đảo ' || v_dao || ' dòng sổ quỹ)' else '' end, v_ten);
end $$;
revoke execute on function public.chi_phi_huy(uuid, text) from public, anon;
grant execute on function public.chi_phi_huy(uuid, text) to authenticated;

-- Hai hàm cũ (không biết sổ quỹ) bị khóa để không ai sửa số tiền làm lệch sổ quỹ
create or replace function public.chi_phi_them(p_order uuid, p_kind text, p_content text, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Bản cũ của chức năng này đã ngừng dùng. Hãy tải lại trang (Ctrl+F5) rồi thử lại';
end $$;
create or replace function public.chi_phi_sua(p_id uuid, p_kind text, p_content text, p_amount numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Bản cũ của chức năng này đã ngừng dùng. Hãy tải lại trang (Ctrl+F5) rồi thử lại';
end $$;

-- Sổ quỹ: dòng sinh từ chi phí phiếu phải hủy ở phiếu (để trạng thái chi phí luôn khớp)
create or replace function public.huy_giao_dich_quy(p_id uuid, p_ly_do text)
returns integer language plpgsql security definer set search_path = public as $$
declare s record; r record; v_ly text := btrim(coalesce(p_ly_do, '')); n int := 0; v_ngay date;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy giao dịch sổ quỹ'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  perform pg_advisory_xact_lock(7210021);
  select * into s from public.so_quy where id = p_id;
  if not found then raise exception 'Không tìm thấy giao dịch'; end if;
  if s.loai = 'dao' then raise exception 'Đây là dòng đảo, không hủy tiếp. Muốn ghi lại, hãy tạo giao dịch mới'; end if;
  if s.payment_id is not null then raise exception 'Giao dịch này là khoản thu của phiếu sửa chữa: hủy ở phiếu (Hủy khoản thu / Hủy phiếu), sổ quỹ sẽ tự đảo'; end if;
  if s.chi_phi_id is not null then raise exception 'Giao dịch này là chi phí của phiếu sửa chữa: sửa hoặc hủy chi phí ở trang phiếu, sổ quỹ sẽ tự đảo'; end if;
  for r in select * from public.so_quy x where (x.id = s.id or (s.nhom_id is not null and x.nhom_id = s.nhom_id)) order by x.seq loop
    if exists (select 1 from public.so_quy d where d.dao_cua = r.id) then raise exception 'Giao dịch này đã hủy rồi'; end if;
    v_ngay := case when exists (select 1 from public.quy_cai_dat c where c.quy = r.quy and r.ngay < c.ngay_bat_dau) then r.ngay else public.ngay_hom_nay() end;
    perform public.so_quy_ghi('dao', r.quy, -r.so_tien, v_ngay, null, r.nhom_id, r.doi_tuong, r.doi_tuong_ten, r.order_id, null, r.import_id,
      coalesce(r.danh_muc, 'Hủy giao dịch'), r.tinh_vao_lai_lo, 'Đảo ' || coalesce(r.so_phieu, lower(r.loai)) || coalesce(' - ' || r.ghi_chu, ''), r.id, v_ly);
    n := n + 1;
  end loop;
  perform public.ghi_nhat_ky('huy_giao_dich_quy', 'Sổ quỹ', s.so_phieu, s.quy, null, 'so_quy', s.id,
    jsonb_build_object('loai', s.loai, 'so_tien', s.so_tien, 'quy', s.quy), jsonb_build_object('da_huy', true, 'so_dong_dao', n), v_ly);
  return n;
end $$;
revoke execute on function public.huy_giao_dich_quy(uuid, text) from public, anon;
grant execute on function public.huy_giao_dich_quy(uuid, text) to authenticated;

-- 4. Danh sách, tổng hợp, đối chiếu (chỉ Chủ) ---------------------------------------------------------------------
-- Chi phí phiếu CŨ chưa ghi vào sổ quỹ
create or replace function public.chi_phi_chua_ghi_quy()
returns table (o_cost uuid, o_order uuid, o_ma_phieu text, o_khach text, o_kind text, o_noi_dung text, o_so_tien numeric, o_ngay_tao timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem'; end if;
  return query
    select rc.id, rc.order_id, 'PT' || lpad(coalesce(o.code, 0)::text, 4, '0'), cu.name, rc.kind, rc.content, rc.amount, rc.created_at
    from public.repair_costs rc
    join public.repair_orders o on o.id = rc.order_id
    left join public.customers cu on cu.id = o.customer_id
    where rc.trang_thai_quy = 'chua_ghi' and not rc.da_huy
    order by rc.created_at;
end $$;
revoke execute on function public.chi_phi_chua_ghi_quy() from public, anon;
grant execute on function public.chi_phi_chua_ghi_quy() to authenticated;

-- Tổng hợp: số khoản + số tiền chưa ghi quỹ; tổng chi phí đã ghi quỹ so với tổng dòng quỹ liên kết
create or replace function public.chi_phi_quy_tong()
returns table (so_chua_ghi bigint, tien_chua_ghi numeric, so_chua_chi bigint, tien_chua_chi numeric, tong_chi_phi_da_ghi numeric, tong_so_quy numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem'; end if;
  return query
    select (select count(*) from public.repair_costs rc where rc.trang_thai_quy = 'chua_ghi' and not rc.da_huy),
           (select coalesce(sum(rc.amount), 0) from public.repair_costs rc where rc.trang_thai_quy = 'chua_ghi' and not rc.da_huy),
           (select count(*) from public.repair_costs rc where rc.trang_thai_quy = 'chua_chi' and not rc.da_huy),
           (select coalesce(sum(rc.amount), 0) from public.repair_costs rc where rc.trang_thai_quy = 'chua_chi' and not rc.da_huy),
           (select coalesce(sum(rc.amount), 0) from public.repair_costs rc where rc.trang_thai_quy = 'da_ghi' and not rc.da_huy),
           (select coalesce(-sum(s.so_tien), 0) from public.so_quy s where s.chi_phi_id is not null);
end $$;
revoke execute on function public.chi_phi_quy_tong() from public, anon;
grant execute on function public.chi_phi_quy_tong() to authenticated;

-- Đối chiếu từng khoản: số tiền chi phí (đã ghi quỹ, chưa hủy) phải bằng tổng ròng các dòng quỹ liên kết
create or replace function public.chi_phi_quy_doi_chieu()
returns table (o_cost uuid, o_order uuid, o_ma_phieu text, o_noi_dung text, o_chi_phi numeric, o_so_quy numeric, o_lech numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đối chiếu'; end if;
  return query
    with q as (select s.chi_phi_id as cid, -sum(s.so_tien) as t from public.so_quy s where s.chi_phi_id is not null group by s.chi_phi_id),
         c as (select rc.id as cid, rc.order_id as oid, rc.content as nd,
                      case when rc.da_huy or rc.trang_thai_quy <> 'da_ghi' then 0 else rc.amount end as t from public.repair_costs rc)
    select c.cid, c.oid, 'PT' || lpad(coalesce(o.code, 0)::text, 4, '0'), c.nd, c.t, coalesce(q.t, 0), c.t - coalesce(q.t, 0)
    from c left join q on q.cid = c.cid left join public.repair_orders o on o.id = c.oid
    where c.t <> coalesce(q.t, 0)
    order by o.code;
end $$;
revoke execute on function public.chi_phi_quy_doi_chieu() from public, anon;
grant execute on function public.chi_phi_quy_doi_chieu() to authenticated;

notify pgrst, 'reload schema';

-- 5. Kiểm tra nhanh sau khi chạy (xem ở tab Results) -------------------------------------------------------------------
select
  (select count(*) from public.repair_costs where trang_thai_quy = 'chua_ghi' and not da_huy) as chi_phi_cu_chua_ghi_quy,
  (select count(*) from public.so_quy where chi_phi_id is not null) as dong_quy_lien_ket_phai_la_0_luc_dau,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'so_quy') as so_quy_bat_bao_mat_phai_la_true;
