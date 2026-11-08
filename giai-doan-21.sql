-- GIAI ĐOẠN 21 (đợt F1): Sổ quỹ, phiếu thu, phiếu chi, chuyển quỹ, kiểm quỹ
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không ghi trùng). Cần đã chạy giai-doan-20.sql.
-- File này CHỈ ghi nhận dòng tiền. KHÔNG đổi cách tính doanh thu, lợi nhuận, báo cáo thu hồi vốn (không sửa dòng phiếu, giá, tồn kho nào).
--
-- ===== NỘI DUNG =====
--  * 2 quỹ: "Tiền mặt" và "Tài khoản ngân hàng". Chủ nhập số dư đầu kỳ + ngày bắt đầu cho từng quỹ MỘT lần (không sửa lại).
--  * so_quy: sổ quỹ CHỈ THÊM dòng (trigger chặn sửa/xóa/truncate, kể cả Chủ). Giờ do máy chủ. Hủy = thêm dòng đảo có lý do.
--  * Số dư sau mỗi dòng được tính từ view so_quy_xem (số dư đầu kỳ + cộng dồn các dòng từ ngày bắt đầu), không bao giờ lệch.
--  * Mỗi khoản thu của phiếu sửa chữa (order_payments) tự có 1 dòng thu trong sổ quỹ (Tiền mặt -> quỹ Tiền mặt, Chuyển khoản -> quỹ Tài khoản).
--    Hủy khoản thu / hủy phiếu -> tự thêm dòng đảo. Dữ liệu cũ được chuyển sang ở cuối file. Khách còn nợ KHÔNG vào quỹ.
--    (Dòng điều chỉnh/đảo của giai đoạn 20 được đối xử như đã thu/đã trả cùng hình thức, đúng như tổng khoản thu của phiếu.)
--  * Phiếu thu khác (THU0001...) và phiếu chi (CHI0001...) số phiếu tự sinh, không trùng mã phiếu sửa chữa (PT...).
--  * loai_phieu_chi: mỗi loại chi có cột "tinh_vao_lai_lo" để đợt báo cáo sau không tính trùng:
--      KHÔNG: Trả nhà cung cấp, Nhập hàng trả ngay (mua hàng tồn kho, giá vốn đã tính khi bán)
--      CÓ   : Lương và nhân công, Chi phí vận hành, Hoàn tiền khách, Chi khác
--  * Nhân viên: vẫn thu tiền trong phiếu sửa chữa (dòng sổ quỹ tự sinh), nhưng không xem sổ quỹ, không tạo phiếu chi, không chuyển quỹ, không kiểm quỹ, không hủy.
--  * Mọi thao tác ghi vào nhat_ky_hoat_dong. Đối chiếu: so_quy_doi_chieu() liệt kê phiếu có tổng khoản thu khác tổng dòng thu trong sổ quỹ.

-- 1. Cài đặt quỹ (số dư đầu kỳ) ---------------------------------------------------------------------
create table if not exists public.quy_cai_dat (
  quy text primary key check (quy in ('Tiền mặt', 'Tài khoản ngân hàng')),
  so_du_dau numeric(18,0) not null,
  ngay_bat_dau date not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- 2. Loại phiếu chi ------------------------------------------------------------------------------------
create table if not exists public.loai_phieu_chi (
  ten text primary key,
  tinh_vao_lai_lo boolean not null,
  thu_tu int not null,
  ghi_chu text
);
insert into public.loai_phieu_chi (ten, tinh_vao_lai_lo, thu_tu, ghi_chu) values
  ('Trả nhà cung cấp',   false, 1, 'Trả công nợ mua hàng: là mua hàng tồn kho, KHÔNG tính vào lãi lỗ (giá vốn đã tính khi bán)'),
  ('Nhập hàng trả ngay', false, 2, 'Mua hàng nhập kho trả tiền ngay: KHÔNG tính vào lãi lỗ (giá vốn đã tính khi bán)'),
  ('Lương và nhân công', true,  3, 'Chi phí: tính vào lãi lỗ'),
  ('Chi phí vận hành',   true,  4, 'Chi phí (điện, nước, thuê mặt bằng...): tính vào lãi lỗ'),
  ('Hoàn tiền khách',    true,  5, 'Trả lại tiền cho khách: tính vào lãi lỗ'),
  ('Chi khác',           true,  6, 'Chi phí khác: tính vào lãi lỗ')
on conflict (ten) do nothing;

-- 3. Sổ quỹ (chỉ thêm dòng) -------------------------------------------------------------------------------
-- so_tien có dấu: dương = tiền vào quỹ, âm = tiền ra khỏi quỹ.
create table if not exists public.so_quy (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),           -- giờ máy chủ
  ngay date not null default public.ngay_hom_nay(),        -- ngày ghi nhận (giờ Việt Nam)
  loai text not null check (loai in ('thu', 'chi', 'chuyen_quy', 'kiem_quy', 'dao')),
  quy text not null check (quy in ('Tiền mặt', 'Tài khoản ngân hàng')),
  so_tien numeric(18,0) not null check (so_tien <> 0),
  so_phieu text,                                           -- THU0001 / CHI0001 (phiếu thu khác, phiếu chi)
  nhom_id uuid,                                            -- 2 dòng của 1 lần chuyển quỹ chung nhom_id
  doi_tuong text check (doi_tuong is null or doi_tuong in ('khach', 'nha_cung_cap', 'tho', 'khac')),
  doi_tuong_ten text,
  order_id uuid,                                           -- liên kết phiếu sửa chữa
  payment_id uuid,                                         -- liên kết khoản thu (order_payments)
  import_id uuid,                                          -- liên kết lần nhập hàng
  danh_muc text,                                           -- với phiếu chi = loại chi
  tinh_vao_lai_lo boolean,                                 -- chỉ phiếu chi: chụp lại từ loai_phieu_chi lúc ghi
  ghi_chu text,
  dao_cua uuid,                                            -- dòng đảo trỏ về dòng bị hủy
  ly_do text,                                              -- lý do hủy (dòng đảo) / lý do kiểm quỹ
  created_by uuid,
  created_by_name text,
  check (loai <> 'chi' or so_tien < 0),
  check (loai <> 'dao' or (dao_cua is not null and btrim(coalesce(ly_do, '')) <> '')),
  check (loai <> 'kiem_quy' or btrim(coalesce(ly_do, '')) <> '')
);
create index if not exists so_quy_quy_seq_idx on public.so_quy (quy, seq);
create index if not exists so_quy_ngay_idx on public.so_quy (ngay desc, seq desc);
create index if not exists so_quy_order_idx on public.so_quy (order_id) where order_id is not null;
create unique index if not exists so_quy_thu_payment_uq on public.so_quy (payment_id) where payment_id is not null and loai = 'thu';
create unique index if not exists so_quy_dao_uq on public.so_quy (dao_cua) where dao_cua is not null;
create unique index if not exists so_quy_so_phieu_uq on public.so_quy (so_phieu, quy) where so_phieu is not null and loai in ('thu', 'chi');

-- Bộ đếm số phiếu (không đứt số: lùi giao dịch thì bộ đếm cũng lùi)
create table if not exists public.so_quy_dem (
  loai text primary key check (loai in ('THU', 'CHI')),
  so bigint not null default 0
);
insert into public.so_quy_dem (loai, so) values ('THU', 0), ('CHI', 0) on conflict do nothing;

-- 4. Chặn sửa / xóa / truncate (kể cả Chủ) --------------------------------------------------------------
create or replace function public.so_quy_chan_sua_xoa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'Không được xóa sạch bảng % (sổ quỹ)', tg_table_name; end if;
  raise exception 'Sổ quỹ chỉ được thêm dòng, không sửa hoặc xóa. Muốn hủy giao dịch: Chủ xưởng bấm "Hủy" (lý do bắt buộc) để thêm dòng đảo';
end $$;
revoke execute on function public.so_quy_chan_sua_xoa() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['so_quy', 'quy_cai_dat'] loop
    execute format('drop trigger if exists chan_sua_xoa on public.%I', t);
    execute format('drop trigger if exists chan_truncate on public.%I', t);
    execute format('create trigger chan_sua_xoa before update or delete on public.%I for each row execute function public.so_quy_chan_sua_xoa()', t);
    execute format('create trigger chan_truncate before truncate on public.%I for each statement execute function public.so_quy_chan_sua_xoa()', t);
  end loop;
  -- Người thực hiện + giờ do máy chủ đặt (hàm của giai đoạn 20)
  foreach t in array array['so_quy', 'quy_cai_dat'] loop
    execute format('drop trigger if exists ep_nguoi_thuc_hien on public.%I', t);
    execute format('create trigger ep_nguoi_thuc_hien before insert on public.%I for each row execute function public.ep_nguoi_thuc_hien()', t);
  end loop;
end $$;

-- 5. Hàm phụ -------------------------------------------------------------------------------------------------
create or replace function public.quy_theo_hinh_thuc(p_hinh_thuc text) returns text
language sql immutable as $$ select case when p_hinh_thuc = 'Chuyển khoản' then 'Tài khoản ngân hàng' else 'Tiền mặt' end $$;

-- Số dư hiện tại của 1 quỹ (null nếu chưa thiết lập). Chỉ tính các dòng từ ngày bắt đầu.
create or replace function public.quy_so_du_noi_bo(p_quy text) returns numeric
language sql stable security definer set search_path = public as $$
  select c.so_du_dau + coalesce((select sum(s.so_tien) from public.so_quy s where s.quy = c.quy and s.ngay >= c.ngay_bat_dau), 0)
  from public.quy_cai_dat c where c.quy = p_quy
$$;
revoke execute on function public.quy_so_du_noi_bo(text) from public, anon, authenticated;

create or replace function public.quy_so_du(p_quy text) returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem số dư quỹ'; end if;
  return public.quy_so_du_noi_bo(p_quy);
end $$;
revoke execute on function public.quy_so_du(text) from public, anon;
grant execute on function public.quy_so_du(text) to authenticated;

-- View: số dư quỹ sau từng dòng (theo thứ tự ghi). Phân quyền theo người gọi -> nhân viên không xem được.
create or replace view public.so_quy_xem with (security_invoker = true) as
select s.id, s.seq, s.created_at, s.ngay, s.loai, s.quy, s.so_tien, s.so_phieu, s.nhom_id, s.doi_tuong, s.doi_tuong_ten,
       s.order_id, s.payment_id, s.import_id, s.danh_muc, s.tinh_vao_lai_lo, s.ghi_chu, s.dao_cua, s.ly_do,
       s.created_by, s.created_by_name,
       (select 'PT' || lpad(o.code::text, 4, '0') from public.repair_orders o where o.id = s.order_id) as ma_phieu_sua,
       exists (select 1 from public.so_quy r where r.dao_cua = s.id) as da_dao,
       c.so_du_dau + sum(case when s.ngay >= c.ngay_bat_dau then s.so_tien else 0 end) over (partition by s.quy order by s.seq) as so_du_sau
from public.so_quy s
left join public.quy_cai_dat c on c.quy = s.quy;

-- Ghi 1 dòng sổ quỹ (nội bộ, gọi từ các hàm bên dưới)
create or replace function public.so_quy_ghi(
  p_loai text, p_quy text, p_so_tien numeric, p_ngay date, p_so_phieu text, p_nhom uuid, p_doi_tuong text, p_doi_tuong_ten text,
  p_order uuid, p_payment uuid, p_import uuid, p_danh_muc text, p_lai_lo boolean, p_ghi_chu text, p_dao_cua uuid, p_ly_do text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.so_quy (loai, quy, so_tien, ngay, so_phieu, nhom_id, doi_tuong, doi_tuong_ten, order_id, payment_id, import_id,
                             danh_muc, tinh_vao_lai_lo, ghi_chu, dao_cua, ly_do)
  values (p_loai, p_quy, p_so_tien, coalesce(p_ngay, public.ngay_hom_nay()), p_so_phieu, p_nhom, p_doi_tuong, nullif(btrim(coalesce(p_doi_tuong_ten, '')), ''),
          p_order, p_payment, p_import, nullif(btrim(coalesce(p_danh_muc, '')), ''), p_lai_lo, nullif(btrim(coalesce(p_ghi_chu, '')), ''),
          p_dao_cua, nullif(btrim(coalesce(p_ly_do, '')), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.so_quy_ghi(text, text, numeric, date, text, uuid, text, text, uuid, uuid, uuid, text, boolean, text, uuid, text) from public, anon, authenticated;

-- 6. Khoản thu của phiếu sửa chữa -> tự vào sổ quỹ ---------------------------------------------------------------
create or replace function public.so_quy_tu_khoan_thu() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code bigint; v_khach text; r record; v_ma text; v_quy text; v_ngay date;
begin
  if tg_op = 'INSERT' then
    if new.so_tien = 0 then return null; end if;
    select o.code, c.name into v_code, v_khach from public.repair_orders o left join public.customers c on c.id = o.customer_id where o.id = new.order_id;
    v_ma := 'PT' || lpad(coalesce(v_code, 0)::text, 4, '0');
    perform public.so_quy_ghi('thu', public.quy_theo_hinh_thuc(new.hinh_thuc), new.so_tien, new.ngay_thu, null, null, 'khach', v_khach,
      new.order_id, new.id, null, 'Thu phiếu sửa chữa', null,
      v_ma || case new.loai when 'dieu_chinh' then ' (điều chỉnh phiếu)' when 'dao' then ' (đảo khi hủy phiếu)' else '' end
          || coalesce(' - ' || nullif(btrim(coalesce(new.ghi_chu, '')), ''), ''), null, null);
  elsif tg_op = 'UPDATE' and new.da_huy and not old.da_huy then
    -- Hủy khoản thu -> đảo dòng sổ quỹ tương ứng (dòng cũ giữ nguyên)
    for r in select * from public.so_quy s where s.payment_id = new.id and s.loai = 'thu'
               and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) loop
      v_quy := r.quy;
      v_ngay := case when exists (select 1 from public.quy_cai_dat c where c.quy = r.quy and r.ngay < c.ngay_bat_dau) then r.ngay else public.ngay_hom_nay() end;
      perform public.so_quy_ghi('dao', r.quy, -r.so_tien, v_ngay, null, null, r.doi_tuong, r.doi_tuong_ten, r.order_id, r.payment_id, null,
        'Hủy khoản thu', null, 'Đảo ' || coalesce(r.ghi_chu, 'khoản thu'), r.id, new.huy_ly_do);
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.so_quy_tu_khoan_thu() from public, anon, authenticated;
drop trigger if exists so_quy_tu_khoan_thu on public.order_payments;
create trigger so_quy_tu_khoan_thu after insert or update on public.order_payments
  for each row execute function public.so_quy_tu_khoan_thu();

-- 7. Chuyển dữ liệu cũ: mỗi khoản thu đã có -> 1 dòng thu cùng ngày; khoản đã hủy -> thêm dòng đảo -------------------------
do $$
declare n int := 0; m int := 0; p record; v_id uuid; v_khach text; v_code bigint; v_ma text;
begin
  for p in select * from public.order_payments op where op.so_tien <> 0
             and not exists (select 1 from public.so_quy s where s.payment_id = op.id and s.loai = 'thu') order by op.seq loop
    select o.code, c.name into v_code, v_khach from public.repair_orders o left join public.customers c on c.id = o.customer_id where o.id = p.order_id;
    v_ma := 'PT' || lpad(coalesce(v_code, 0)::text, 4, '0');
    insert into public.so_quy (created_at, ngay, loai, quy, so_tien, doi_tuong, doi_tuong_ten, order_id, payment_id, danh_muc, ghi_chu, created_by, created_by_name)
    values (p.created_at, p.ngay_thu, 'thu', public.quy_theo_hinh_thuc(p.hinh_thuc), p.so_tien, 'khach', v_khach, p.order_id, p.id, 'Thu phiếu sửa chữa',
            v_ma || case p.loai when 'dieu_chinh' then ' (điều chỉnh phiếu)' when 'dao' then ' (đảo khi hủy phiếu)' else '' end
                 || coalesce(' - ' || nullif(btrim(coalesce(p.ghi_chu, '')), ''), '') || ' [chuyển từ dữ liệu cũ]',
            p.created_by, coalesce(p.created_by_name, 'Dữ liệu cũ'));
    n := n + 1;
  end loop;
  for p in select op.*, s.id as dong_id, s.quy as dong_quy, s.so_tien as dong_tien, s.doi_tuong_ten as dong_ten, s.ghi_chu as dong_ghi
           from public.order_payments op join public.so_quy s on s.payment_id = op.id and s.loai = 'thu'
           where op.da_huy and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) order by op.seq loop
    insert into public.so_quy (created_at, ngay, loai, quy, so_tien, doi_tuong, doi_tuong_ten, order_id, payment_id, danh_muc, ghi_chu, dao_cua, ly_do, created_by, created_by_name)
    values (coalesce(p.huy_luc, p.created_at), (coalesce(p.huy_luc, p.created_at) at time zone 'Asia/Ho_Chi_Minh')::date, 'dao', p.dong_quy, -p.dong_tien,
            'khach', p.dong_ten, p.order_id, p.id, 'Hủy khoản thu', 'Đảo ' || coalesce(p.dong_ghi, 'khoản thu'), p.dong_id,
            coalesce(nullif(btrim(p.huy_ly_do), ''), 'Dữ liệu cũ'), p.huy_boi, coalesce(p.huy_boi_ten, 'Dữ liệu cũ'));
    m := m + 1;
  end loop;
  if n + m > 0 then
    insert into public.nhat_ky_hoat_dong (ten_hien_thi, hanh_dong, loai_doi_tuong, bang, ly_do, sau)
    values ('Hệ thống / SQL Editor', 'khoi_tao', 'Sổ quỹ', 'so_quy',
            'Chuyển khoản thu cũ sang sổ quỹ (giai đoạn 21)', jsonb_build_object('so_khoan', n, 'so_dong_dao', m));
  end if;
end $$;

-- 8. Hàm nghiệp vụ (chỉ Chủ; khóa để 2 người ghi cùng lúc không làm âm quỹ) -----------------------------------------------
create or replace function public.so_quy_kiem_tra_chung(p_quy text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được thực hiện thao tác về sổ quỹ'; end if;
  if p_quy not in ('Tiền mặt', 'Tài khoản ngân hàng') then raise exception 'Quỹ không hợp lệ'; end if;
  perform pg_advisory_xact_lock(7210021);
  if not exists (select 1 from public.quy_cai_dat where quy = p_quy) then
    raise exception 'Quỹ "%" chưa nhập số dư đầu kỳ. Hãy thiết lập trước', p_quy;
  end if;
end $$;
revoke execute on function public.so_quy_kiem_tra_chung(text) from public, anon, authenticated;

create or replace function public.quy_thiet_lap(p_quy text, p_so_du numeric, p_ngay date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được thiết lập quỹ'; end if;
  if p_quy not in ('Tiền mặt', 'Tài khoản ngân hàng') then raise exception 'Quỹ không hợp lệ'; end if;
  if p_so_du is null or p_so_du < 0 or p_so_du <> round(p_so_du) then raise exception 'Số dư đầu kỳ phải là số tiền nguyên, không âm'; end if;
  if p_ngay is null then raise exception 'Hãy chọn ngày bắt đầu'; end if;
  if exists (select 1 from public.quy_cai_dat where quy = p_quy) then
    raise exception 'Quỹ "%" đã nhập số dư đầu kỳ rồi, không sửa lại. Nếu lệch, dùng "Kiểm quỹ" để điều chỉnh có lý do', p_quy;
  end if;
  insert into public.quy_cai_dat (quy, so_du_dau, ngay_bat_dau) values (p_quy, p_so_du, p_ngay);
  perform public.ghi_nhat_ky('thiet_lap_quy', 'Sổ quỹ', null, p_quy, null, 'quy_cai_dat', null, null,
    jsonb_build_object('quy', p_quy, 'so_du_dau', p_so_du, 'ngay_bat_dau', p_ngay), 'Nhập số dư đầu kỳ');
end $$;
revoke execute on function public.quy_thiet_lap(text, numeric, date) from public, anon;
grant execute on function public.quy_thiet_lap(text, numeric, date) to authenticated;

-- Tìm phiếu sửa chữa theo mã "PT0012" / "12"
create or replace function public.so_quy_tim_phieu(p_ma text) returns table (oid uuid, khach text)
language plpgsql security definer set search_path = public as $$
declare v_code bigint; v_s text := regexp_replace(coalesce(p_ma, ''), '\D', '', 'g');
begin
  if v_s = '' or char_length(v_s) > 12 then raise exception 'Mã phiếu sửa chữa không hợp lệ (ví dụ PT0012)'; end if;
  v_code := v_s::bigint;
  return query select o.id, c.name from public.repair_orders o left join public.customers c on c.id = o.customer_id where o.code = v_code;
  if not found then raise exception 'Không tìm thấy phiếu sửa chữa PT%', lpad(v_s, 4, '0'); end if;
end $$;
revoke execute on function public.so_quy_tim_phieu(text) from public, anon, authenticated;

-- Phiếu thu khác
create or replace function public.tao_phieu_thu(p_quy text, p_so_tien numeric, p_doi_tuong text, p_ten text, p_ma_phieu text, p_danh_muc text, p_ghi_chu text)
returns text language plpgsql security definer set search_path = public as $$
declare v_so bigint; v_ma text; v_oid uuid; v_ten text := nullif(btrim(coalesce(p_ten, '')), ''); f record; v_dm text := coalesce(nullif(btrim(coalesce(p_danh_muc, '')), ''), 'Thu khác');
begin
  perform public.so_quy_kiem_tra_chung(p_quy);
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if p_doi_tuong not in ('khach', 'nha_cung_cap', 'tho', 'khac') then raise exception 'Đối tượng không hợp lệ'; end if;
  if char_length(coalesce(p_ghi_chu, '')) > 500 or char_length(v_dm) > 100 or char_length(coalesce(v_ten, '')) > 200 then raise exception 'Nội dung quá dài'; end if;
  if nullif(btrim(coalesce(p_ma_phieu, '')), '') is not null then
    select * into f from public.so_quy_tim_phieu(p_ma_phieu); v_oid := f.oid;
    v_ten := coalesce(v_ten, f.khach);
  end if;
  update public.so_quy_dem set so = so + 1 where loai = 'THU' returning so into v_so;
  v_ma := 'THU' || lpad(v_so::text, 4, '0');
  perform public.so_quy_ghi('thu', p_quy, p_so_tien, null, v_ma, null, p_doi_tuong, v_ten, v_oid, null, null, v_dm, null, p_ghi_chu, null, null);
  perform public.ghi_nhat_ky('phieu_thu', 'Sổ quỹ', v_ma, v_ten, null, 'so_quy', null, null,
    jsonb_build_object('quy', p_quy, 'so_tien', p_so_tien, 'doi_tuong', p_doi_tuong, 'danh_muc', v_dm, 'ghi_chu', p_ghi_chu), null);
  return v_ma;
end $$;
revoke execute on function public.tao_phieu_thu(text, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.tao_phieu_thu(text, numeric, text, text, text, text, text) to authenticated;

-- Phiếu chi
create or replace function public.tao_phieu_chi(p_quy text, p_so_tien numeric, p_loai_chi text, p_doi_tuong text, p_ten text, p_ma_phieu text, p_import uuid, p_ghi_chu text)
returns text language plpgsql security definer set search_path = public as $$
declare v_so bigint; v_ma text; v_oid uuid; v_ten text := nullif(btrim(coalesce(p_ten, '')), ''); f record; l record; v_du numeric;
begin
  perform public.so_quy_kiem_tra_chung(p_quy);
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if p_doi_tuong not in ('khach', 'nha_cung_cap', 'tho', 'khac') then raise exception 'Đối tượng không hợp lệ'; end if;
  select * into l from public.loai_phieu_chi where ten = p_loai_chi;
  if not found then raise exception 'Loại phiếu chi không hợp lệ'; end if;
  if char_length(coalesce(p_ghi_chu, '')) > 500 or char_length(coalesce(v_ten, '')) > 200 then raise exception 'Nội dung quá dài'; end if;
  if nullif(btrim(coalesce(p_ma_phieu, '')), '') is not null then
    select * into f from public.so_quy_tim_phieu(p_ma_phieu); v_oid := f.oid;
    v_ten := coalesce(v_ten, f.khach);
  end if;
  if p_import is not null and not exists (select 1 from public.stock_imports where id = p_import) then raise exception 'Không tìm thấy lần nhập hàng'; end if;
  v_du := public.quy_so_du_noi_bo(p_quy);
  if p_so_tien > v_du then
    raise exception 'Quỹ "%" chỉ còn % đ, không đủ chi % đ. Kiểm tra lại số dư đầu kỳ / chuyển quỹ / kiểm quỹ', p_quy, round(v_du), round(p_so_tien);
  end if;
  update public.so_quy_dem set so = so + 1 where loai = 'CHI' returning so into v_so;
  v_ma := 'CHI' || lpad(v_so::text, 4, '0');
  perform public.so_quy_ghi('chi', p_quy, -p_so_tien, null, v_ma, null, p_doi_tuong, v_ten, v_oid, null, p_import, l.ten, l.tinh_vao_lai_lo, p_ghi_chu, null, null);
  perform public.ghi_nhat_ky('phieu_chi', 'Sổ quỹ', v_ma, v_ten, null, 'so_quy', null, null,
    jsonb_build_object('quy', p_quy, 'so_tien', p_so_tien, 'loai_chi', l.ten, 'tinh_vao_lai_lo', l.tinh_vao_lai_lo, 'doi_tuong', p_doi_tuong, 'ghi_chu', p_ghi_chu), null);
  return v_ma;
end $$;
revoke execute on function public.tao_phieu_chi(text, numeric, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.tao_phieu_chi(text, numeric, text, text, text, text, uuid, text) to authenticated;

-- Chuyển quỹ (nộp tiền vào ngân hàng / rút tiền)
create or replace function public.chuyen_quy(p_tu text, p_den text, p_so_tien numeric, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_nhom uuid := gen_random_uuid(); v_du numeric; v_gc text;
begin
  perform public.so_quy_kiem_tra_chung(p_tu);
  perform public.so_quy_kiem_tra_chung(p_den);
  if p_tu = p_den then raise exception 'Quỹ nguồn và quỹ đích phải khác nhau'; end if;
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if char_length(coalesce(p_ghi_chu, '')) > 500 then raise exception 'Ghi chú quá dài'; end if;
  v_du := public.quy_so_du_noi_bo(p_tu);
  if p_so_tien > v_du then raise exception 'Quỹ "%" chỉ còn % đ, không đủ chuyển % đ', p_tu, round(v_du), round(p_so_tien); end if;
  v_gc := case when p_tu = 'Tiền mặt' then 'Nộp tiền mặt vào tài khoản' else 'Rút tiền từ tài khoản về tiền mặt' end
          || coalesce(' - ' || nullif(btrim(coalesce(p_ghi_chu, '')), ''), '');
  perform public.so_quy_ghi('chuyen_quy', p_tu,  -p_so_tien, null, null, v_nhom, null, null, null, null, null, 'Chuyển quỹ', null, v_gc, null, null);
  perform public.so_quy_ghi('chuyen_quy', p_den,  p_so_tien, null, null, v_nhom, null, null, null, null, null, 'Chuyển quỹ', null, v_gc, null, null);
  perform public.ghi_nhat_ky('chuyen_quy', 'Sổ quỹ', null, p_tu || ' -> ' || p_den, null, 'so_quy', null, null,
    jsonb_build_object('tu', p_tu, 'den', p_den, 'so_tien', p_so_tien, 'ghi_chu', p_ghi_chu), null);
  return v_nhom;
end $$;
revoke execute on function public.chuyen_quy(text, text, numeric, text) from public, anon;
grant execute on function public.chuyen_quy(text, text, numeric, text) to authenticated;

-- Kiểm quỹ: nhập số đếm thực tế -> máy chủ tự tính chênh lệch với sổ -> ghi dòng điều chỉnh (lý do bắt buộc)
create or replace function public.kiem_quy(p_quy text, p_thuc_te numeric, p_ly_do text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_du numeric; v_cl numeric; v_ly text := btrim(coalesce(p_ly_do, ''));
begin
  perform public.so_quy_kiem_tra_chung(p_quy);
  if p_thuc_te is null or p_thuc_te < 0 or p_thuc_te <> round(p_thuc_te) then raise exception 'Số tiền thực tế phải là số nguyên, không âm'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do khi kiểm quỹ'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  v_du := public.quy_so_du_noi_bo(p_quy);
  v_cl := p_thuc_te - v_du;
  if v_cl = 0 then raise exception 'Số đếm thực tế khớp với sổ (%) đ, không có chênh lệch để điều chỉnh', round(v_du); end if;
  perform public.so_quy_ghi('kiem_quy', p_quy, v_cl, null, null, null, null, null, null, null, null, 'Kiểm quỹ điều chỉnh', null,
    'Sổ ' || round(v_du) || ' đ, thực tế ' || round(p_thuc_te) || ' đ', null, v_ly);
  perform public.ghi_nhat_ky('kiem_quy', 'Sổ quỹ', null, p_quy, null, 'so_quy', null,
    jsonb_build_object('so_du_so', v_du), jsonb_build_object('so_du_thuc_te', p_thuc_te, 'chenh_lech', v_cl), v_ly);
  return v_cl;
end $$;
revoke execute on function public.kiem_quy(text, numeric, text) from public, anon;
grant execute on function public.kiem_quy(text, numeric, text) to authenticated;

-- Hủy giao dịch thủ công (phiếu thu khác, phiếu chi, chuyển quỹ, kiểm quỹ) bằng dòng đảo. Dòng cũ giữ nguyên.
-- Dòng sinh từ khoản thu của phiếu sửa chữa: hủy ở phiếu (Hủy khoản thu / Hủy phiếu), sổ quỹ tự đảo.
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

-- Đối chiếu: tổng khoản thu (chưa hủy) của phiếu phải bằng tổng các dòng thu liên kết trong sổ quỹ
create or replace function public.so_quy_doi_chieu()
returns table (order_id uuid, ma_phieu text, tong_khoan_thu numeric, tong_so_quy numeric, chenh_lech numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đối chiếu sổ quỹ'; end if;
  return query
    with a as (select p.order_id as oid, sum(p.so_tien) as t from public.order_payments p where not p.da_huy group by p.order_id),
         b as (select s.order_id as oid, sum(s.so_tien) as t from public.so_quy s where s.payment_id is not null group by s.order_id),
         ids as (select a.oid from a union select b.oid from b)
    select ids.oid, 'PT' || lpad(coalesce(o.code, 0)::text, 4, '0'), coalesce(a.t, 0), coalesce(b.t, 0), coalesce(a.t, 0) - coalesce(b.t, 0)
    from ids left join a on a.oid = ids.oid left join b on b.oid = ids.oid left join public.repair_orders o on o.id = ids.oid
    where coalesce(a.t, 0) <> coalesce(b.t, 0)
    order by o.code;
end $$;
revoke execute on function public.so_quy_doi_chieu() from public, anon;
grant execute on function public.so_quy_doi_chieu() to authenticated;

-- 9. Bảo mật (RLS): chỉ Chủ xem; không ai ghi trực tiếp ----------------------------------------------------------------
alter table public.so_quy enable row level security;
alter table public.quy_cai_dat enable row level security;
alter table public.loai_phieu_chi enable row level security;
alter table public.so_quy_dem enable row level security;
revoke all on public.so_quy from anon, authenticated;
revoke all on public.quy_cai_dat from anon, authenticated;
revoke all on public.loai_phieu_chi from anon, authenticated;
revoke all on public.so_quy_dem from anon, authenticated;
revoke all on public.so_quy_xem from anon, authenticated;
grant select on public.so_quy, public.quy_cai_dat, public.loai_phieu_chi, public.so_quy_xem to authenticated;

drop policy if exists sq_chi_chu_xem on public.so_quy;
create policy sq_chi_chu_xem on public.so_quy for select to authenticated using (public.la_chu());
drop policy if exists qcd_chi_chu_xem on public.quy_cai_dat;
create policy qcd_chi_chu_xem on public.quy_cai_dat for select to authenticated using (public.la_chu());
drop policy if exists lpc_chi_chu_xem on public.loai_phieu_chi;
create policy lpc_chi_chu_xem on public.loai_phieu_chi for select to authenticated using (public.la_chu());

-- 10. Kiểm tra nhanh sau khi chạy (xem kết quả ở tab Results) ---------------------------------------------------------------
select
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'so_quy') as so_quy_bat_bao_mat_phai_la_true,
  (select count(*) from public.so_quy) as so_dong_so_quy,
  (select count(*) from public.order_payments where so_tien <> 0) as so_khoan_thu,
  (select count(*) from (
     select coalesce(a.oid, b.oid) from
       (select order_id as oid, sum(so_tien) as t from public.order_payments where not da_huy group by order_id) a
       full join (select order_id as oid, sum(so_tien) as t from public.so_quy where payment_id is not null group by order_id) b on a.oid = b.oid
     where coalesce(a.t, 0) <> coalesce(b.t, 0)) x) as so_phieu_lech_phai_la_0;
