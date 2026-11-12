-- GIAI ĐOẠN 31: Giảm giá và thuế VAT cho phiếu sửa chữa (một hàm tính tổng duy nhất dùng ở mọi nơi)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không đổi số tiền của phiếu cũ).
-- Cần đã chạy giai-doan-4, 9, 13, 16, 20 đến 30.
--
-- ===== NỘI DUNG =====
--  * MỘT hàm duy nhất tính tổng phiếu: tinh_tong_phieu_noi_bo(phiếu). Mọi chỗ cần tổng phiếu đều gọi hàm này:
--    ghi khoản thu, công nợ, trang Công nợ khách, hồ sơ khách, danh sách phiếu, trang in, kiểm tra thu vượt,
--    xóa dòng, sửa phiếu đã hoàn thành, khách trả hàng, đối chiếu, doanh thu / lợi nhuận.
--  * Cách tính (làm tròn đến đồng):
--      tạm tính         = cộng (số lượng x đơn giá) từng dòng, mỗi dòng làm tròn đến đồng
--      giảm giá dòng    = theo % hoặc số tiền của từng dòng (không vượt thành tiền dòng)
--      giảm giá phiếu   = theo % hoặc số tiền, tính trên (tạm tính - giảm giá dòng), không vượt số đó
--      tiền hàng sau giảm = tạm tính - giảm giá dòng - giảm giá phiếu   (không bao giờ âm)
--      VAT chưa gồm     : VAT = tiền hàng sau giảm x thuế suất ; tổng thanh toán = tiền hàng + VAT ; doanh thu = tiền hàng
--      VAT đã gồm       : VAT = tiền hàng x thuế suất / (100 + thuế suất) ; tổng thanh toán = tiền hàng ; doanh thu = tiền hàng - VAT
--  * Doanh thu và lợi nhuận tính theo doanh thu trên (sau giảm, TRƯỚC thuế). Công nợ, khoản thu, sổ quỹ, "Tổng tiền" tính theo
--    tổng thanh toán (đã gồm VAT). Giá vốn và chi phí KHÔNG đổi cách tính.
--  * Phiếu cũ: giảm giá = 0, VAT = 0 nên tổng không đổi.
--  * Nhân viên chỉ giảm giá tới ngưỡng do Chủ đặt (mặc định 5%); vượt ngưỡng bị chặn ở cơ sở dữ liệu.
--  * Phiếu đã hoàn thành: chỉ Chủ sửa giảm giá / VAT, bắt buộc lý do, ghi nhật ký (người, giờ, trước, sau, lý do).
--  * Nhân viên không thấy giá vốn, lợi nhuận, VAT thu hộ, tổng giảm giá trong danh sách và báo cáo (chỉ Chủ).
--  * Không xóa bảng, không xóa cột, không truncate. Chỉ thay hàm (có xóa rồi tạo lại 3 hàm vì đổi cột trả về).

-- 1. Cài đặt: ngưỡng giảm giá của nhân viên + danh sách thuế suất --------------------------------------------
create table if not exists public.phieu_cai_dat (
  id boolean primary key default true check (id),
  giam_toi_da_nv numeric(5,2) not null default 5 check (giam_toi_da_nv >= 0 and giam_toi_da_nv <= 100),
  vat_suat_ds numeric[] not null default array[0, 5, 8, 10]::numeric[],
  updated_by_name text,
  updated_at timestamptz not null default now()
);
insert into public.phieu_cai_dat (id) values (true) on conflict (id) do nothing;

alter table public.phieu_cai_dat enable row level security;
revoke all on public.phieu_cai_dat from anon;
revoke all on public.phieu_cai_dat from authenticated;
grant select on public.phieu_cai_dat to authenticated;
drop policy if exists pcd_moi_vai_tro_xem on public.phieu_cai_dat;
create policy pcd_moi_vai_tro_xem on public.phieu_cai_dat for select to authenticated using (public.vai_tro() is not null);

drop trigger if exists chan_truncate on public.phieu_cai_dat;
create trigger chan_truncate before truncate on public.phieu_cai_dat
  for each statement execute function public.chan_sua_xoa_nhat_ky();

create or replace function public.phieu_cai_dat_luu(p_giam_toi_da_nv numeric, p_vat_suat_ds numeric[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_truoc record; v_ds numeric[]; v_ten text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đổi cài đặt giảm giá và VAT'; end if;
  if p_giam_toi_da_nv is null or p_giam_toi_da_nv < 0 or p_giam_toi_da_nv > 100 then
    raise exception 'Ngưỡng giảm giá của nhân viên phải từ 0 đến 100 phần trăm';
  end if;
  if p_vat_suat_ds is null or coalesce(array_length(p_vat_suat_ds, 1), 0) = 0 then
    raise exception 'Danh sách thuế suất không được trống';
  end if;
  if exists (select 1 from unnest(p_vat_suat_ds) x where x is null or x < 0 or x > 100) then
    raise exception 'Thuế suất phải từ 0 đến 100 phần trăm';
  end if;
  select coalesce(array_agg(distinct round(x, 2) order by round(x, 2)), array[]::numeric[]) into v_ds from unnest(p_vat_suat_ds) x;
  if not (0 = any (v_ds)) then raise exception 'Danh sách thuế suất phải có mức 0 phần trăm'; end if;
  if coalesce(array_length(v_ds, 1), 0) > 12 then raise exception 'Tối đa 12 mức thuế suất'; end if;

  select * into v_truoc from public.phieu_cai_dat where id;
  v_ten := public.ten_nguoi_dung(auth.uid());
  update public.phieu_cai_dat set giam_toi_da_nv = round(p_giam_toi_da_nv, 2), vat_suat_ds = v_ds,
         updated_by_name = v_ten, updated_at = now() where id;
  perform public.ghi_nhat_ky('sua_cai_dat_giam_gia_vat', 'Cài đặt giảm giá và VAT', null, 'Giảm giá nhân viên / thuế suất', null,
    'phieu_cai_dat', null,
    jsonb_build_object('giam_toi_da_nv', v_truoc.giam_toi_da_nv, 'vat_suat_ds', to_jsonb(v_truoc.vat_suat_ds)),
    jsonb_build_object('giam_toi_da_nv', round(p_giam_toi_da_nv, 2), 'vat_suat_ds', to_jsonb(v_ds)), null);
  return jsonb_build_object('giam_toi_da_nv', round(p_giam_toi_da_nv, 2), 'vat_suat_ds', to_jsonb(v_ds));
end $$;
revoke execute on function public.phieu_cai_dat_luu(numeric, numeric[]) from public, anon;
grant execute on function public.phieu_cai_dat_luu(numeric, numeric[]) to authenticated;

-- 2. Cột mới (phiếu cũ nhận giá trị mặc định: giảm giá 0, VAT 0 => tổng không đổi) ---------------------------
alter table public.repair_orders add column if not exists giam_kieu text not null default 'tien' check (giam_kieu in ('pt', 'tien'));
alter table public.repair_orders add column if not exists giam_gia_tri numeric(14,2) not null default 0 check (giam_gia_tri >= 0);
alter table public.repair_orders add column if not exists giam_ly_do text;
alter table public.repair_orders add column if not exists vat_suat numeric(5,2) not null default 0 check (vat_suat >= 0 and vat_suat <= 100);
alter table public.repair_orders add column if not exists vat_che_do text not null default 'chua' check (vat_che_do in ('chua', 'da'));
alter table public.repair_items add column if not exists giam_kieu text not null default 'tien' check (giam_kieu in ('pt', 'tien'));
alter table public.repair_items add column if not exists giam_gia_tri numeric(14,2) not null default 0 check (giam_gia_tri >= 0);

-- 3. HÀM TÍNH TỔNG DUY NHẤT --------------------------------------------------------------------------------------
-- 3a. Số tiền giảm của một khoản (dòng hoặc cả phiếu): % hoặc số tiền, không âm, không vượt số gốc
create or replace function public.giam_tien(p_goc numeric, p_kieu text, p_gia_tri numeric) returns numeric
language sql immutable parallel safe as $$
  select greatest(0, least(greatest(coalesce(p_goc, 0), 0),
    case when p_kieu = 'pt'
         then round(greatest(coalesce(p_goc, 0), 0) * least(greatest(coalesce(p_gia_tri, 0), 0), 100) / 100)
         else round(greatest(coalesce(p_gia_tri, 0), 0)) end))
$$;

-- 3b. Từ các con số -> toàn bộ các dòng tổng (công thức nằm ở ĐÂY và chỉ ở đây)
create or replace function public.tinh_tong_tu_so(
  p_tam_tinh numeric, p_giam_dong numeric, p_giam_kieu text, p_giam_gia_tri numeric, p_vat_suat numeric, p_vat_che_do text
) returns table (tam_tinh numeric, giam_dong numeric, giam_phieu numeric, giam_gia numeric, tien_hang numeric, vat numeric,
                 tong_thanh_toan numeric, doanh_thu numeric)
language sql immutable parallel safe as $$
  select x.tt, x.gd, x.gp, x.gd + x.gp, x.s, x.v,
         case when x.che_do = 'da' then x.s else x.s + x.v end,
         case when x.che_do = 'da' then x.s - x.v else x.s end
  from (
    select y.tt, y.gd, y.gp, y.tt - y.gd - y.gp as s, y.che_do,
           case when y.che_do = 'da' then round((y.tt - y.gd - y.gp) * y.r / (100 + y.r))
                else round((y.tt - y.gd - y.gp) * y.r / 100) end as v
    from (
      select z.tt, z.gd, public.giam_tien(z.tt - z.gd, p_giam_kieu, p_giam_gia_tri) as gp,
             case when p_vat_che_do = 'da' then 'da' else 'chua' end as che_do,
             greatest(coalesce(p_vat_suat, 0), 0) as r
      from (select coalesce(p_tam_tinh, 0) as tt, coalesce(p_giam_dong, 0) as gd) z
    ) y
  ) x
$$;
revoke execute on function public.giam_tien(numeric, text, numeric) from public, anon;
revoke execute on function public.tinh_tong_tu_so(numeric, numeric, text, numeric, numeric, text) from public, anon;
grant execute on function public.giam_tien(numeric, text, numeric) to authenticated;
grant execute on function public.tinh_tong_tu_so(numeric, numeric, text, numeric, numeric, text) to authenticated;

-- 3c. Tổng của một phiếu (nội bộ, các hàm khác gọi; KHÔNG cấp quyền cho người dùng)
create or replace function public.tinh_tong_phieu_noi_bo(p_order uuid)
returns table (tam_tinh numeric, giam_dong numeric, giam_phieu numeric, giam_gia numeric, tien_hang numeric, vat numeric,
               tong_thanh_toan numeric, doanh_thu numeric)
language sql stable as $$
  select t.tam_tinh, t.giam_dong, t.giam_phieu, t.giam_gia, t.tien_hang, t.vat, t.tong_thanh_toan, t.doanh_thu
  from public.repair_orders o
  cross join lateral (
    select coalesce(sum(round(i.qty * i.unit_price)), 0) as tt,
           coalesce(sum(public.giam_tien(round(i.qty * i.unit_price), i.giam_kieu, i.giam_gia_tri)), 0) as gd
    from public.repair_items i where i.order_id = o.id) l
  cross join lateral public.tinh_tong_tu_so(l.tt, l.gd, o.giam_kieu, o.giam_gia_tri, o.vat_suat, o.vat_che_do) t
  where o.id = p_order
$$;
revoke execute on function public.tinh_tong_phieu_noi_bo(uuid) from public, anon, authenticated;

-- Chỉ lấy "tổng thanh toán" (đã gồm VAT) - dùng cho công nợ / khoản thu / sổ quỹ
create or replace function public.tong_thanh_toan_phieu(p_order uuid) returns numeric
language sql stable as $$
  select coalesce((select t.tong_thanh_toan from public.tinh_tong_phieu_noi_bo(p_order) t), 0)
$$;
revoke execute on function public.tong_thanh_toan_phieu(uuid) from public, anon, authenticated;

-- 3d. Bản cho ứng dụng (kiểm tra đã đăng nhập có vai trò)
create or replace function public.tinh_tong_phieu(p_order uuid)
returns table (tam_tinh numeric, giam_dong numeric, giam_phieu numeric, giam_gia numeric, tien_hang numeric, vat numeric,
               tong_thanh_toan numeric, doanh_thu numeric)
language sql stable security definer set search_path = public as $$
  select t.tam_tinh, t.giam_dong, t.giam_phieu, t.giam_gia, t.tien_hang, t.vat, t.tong_thanh_toan, t.doanh_thu
  from public.tinh_tong_phieu_noi_bo(p_order) t where public.vai_tro() is not null
$$;
revoke execute on function public.tinh_tong_phieu(uuid) from public, anon;
grant execute on function public.tinh_tong_phieu(uuid) to authenticated;

-- 3e. Xem trước khi đang gõ (chưa lưu): dùng đúng công thức trên với giá trị đang nhập
-- p_dong: [{"id":"uuid dòng","kieu":"pt|tien","gia_tri":số}, ...]
create or replace function public.tinh_tong_xem_truoc(
  p_order uuid, p_giam_kieu text, p_giam_gia_tri numeric, p_vat_suat numeric, p_vat_che_do text, p_dong jsonb
) returns table (tam_tinh numeric, giam_dong numeric, giam_phieu numeric, giam_gia numeric, tien_hang numeric, vat numeric,
                 tong_thanh_toan numeric, doanh_thu numeric)
language sql stable security definer set search_path = public as $$
  select t.tam_tinh, t.giam_dong, t.giam_phieu, t.giam_gia, t.tien_hang, t.vat, t.tong_thanh_toan, t.doanh_thu
  from public.repair_orders o
  cross join lateral (
    select coalesce(sum(round(i.qty * i.unit_price)), 0) as tt,
           coalesce(sum(public.giam_tien(round(i.qty * i.unit_price), coalesce(d.kieu, i.giam_kieu), coalesce(d.gia_tri, i.giam_gia_tri))), 0) as gd
    from public.repair_items i
    left join jsonb_to_recordset(case when jsonb_typeof(p_dong) = 'array' then p_dong else '[]'::jsonb end) as d(id uuid, kieu text, gia_tri numeric) on d.id = i.id
    where i.order_id = o.id) l
  cross join lateral public.tinh_tong_tu_so(l.tt, l.gd, p_giam_kieu, p_giam_gia_tri, p_vat_suat, p_vat_che_do) t
  where o.id = p_order and public.vai_tro() is not null
$$;
revoke execute on function public.tinh_tong_xem_truoc(uuid, text, numeric, numeric, text, jsonb) from public, anon;
grant execute on function public.tinh_tong_xem_truoc(uuid, text, numeric, numeric, text, jsonb) to authenticated;

-- 4. Chốt chặn: giảm giá / VAT chỉ đổi qua hàm phieu_dat_giam_vat ------------------------------------------------
create or replace function public.chan_sua_giam_vat() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sai boolean;
begin
  if coalesce(current_setting('app.giam_vat', true), '') = '1' or auth.uid() is null then
    return new;   -- đi qua hàm có kiểm tra, hoặc chạy từ SQL Editor
  end if;
  if tg_table_name = 'repair_orders' then
    if tg_op = 'INSERT' then
      v_sai := new.giam_kieu <> 'tien' or new.giam_gia_tri <> 0 or new.giam_ly_do is not null or new.vat_suat <> 0 or new.vat_che_do <> 'chua';
    else
      v_sai := (new.giam_kieu, new.giam_gia_tri, new.giam_ly_do, new.vat_suat, new.vat_che_do)
               is distinct from (old.giam_kieu, old.giam_gia_tri, old.giam_ly_do, old.vat_suat, old.vat_che_do);
    end if;
  else
    if tg_op = 'INSERT' then
      v_sai := new.giam_kieu <> 'tien' or new.giam_gia_tri <> 0;
    else
      v_sai := (new.giam_kieu, new.giam_gia_tri) is distinct from (old.giam_kieu, old.giam_gia_tri);
    end if;
  end if;
  if v_sai then
    raise exception 'Không sửa trực tiếp giảm giá / VAT. Hãy dùng ô "Giảm giá và VAT" trong phiếu (có kiểm tra ngưỡng và ghi nhật ký)';
  end if;
  return new;
end $$;
revoke execute on function public.chan_sua_giam_vat() from public, anon, authenticated;
drop trigger if exists chan_sua_giam_vat on public.repair_orders;
create trigger chan_sua_giam_vat before insert or update on public.repair_orders
  for each row execute function public.chan_sua_giam_vat();
drop trigger if exists chan_sua_giam_vat on public.repair_items;
create trigger chan_sua_giam_vat before insert or update on public.repair_items
  for each row execute function public.chan_sua_giam_vat();

-- 5. Nhật ký sửa giảm giá / VAT (chỉ Chủ xem; chỉ thêm dòng) -------------------------------------------------------
create table if not exists public.phieu_giam_vat_nhat_ky (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  da_hoan_thanh boolean not null default false,
  ly_do text,
  truoc jsonb not null,
  sau jsonb not null,
  tong_truoc numeric(16,0) not null,
  tong_sau numeric(16,0) not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists phieu_giam_vat_nhat_ky_order_idx on public.phieu_giam_vat_nhat_ky (order_id, created_at desc);
alter table public.phieu_giam_vat_nhat_ky enable row level security;
revoke all on public.phieu_giam_vat_nhat_ky from anon;
revoke all on public.phieu_giam_vat_nhat_ky from authenticated;
grant select on public.phieu_giam_vat_nhat_ky to authenticated;
drop policy if exists pgv_chi_chu_xem on public.phieu_giam_vat_nhat_ky;
create policy pgv_chi_chu_xem on public.phieu_giam_vat_nhat_ky for select to authenticated using (public.la_chu());
drop trigger if exists chan_sua_xoa on public.phieu_giam_vat_nhat_ky;
create trigger chan_sua_xoa before update or delete on public.phieu_giam_vat_nhat_ky
  for each row execute function public.chan_sua_xoa_nhat_ky();
drop trigger if exists chan_truncate on public.phieu_giam_vat_nhat_ky;
create trigger chan_truncate before truncate on public.phieu_giam_vat_nhat_ky
  for each statement execute function public.chan_sua_xoa_nhat_ky();
drop trigger if exists ep_nguoi_thuc_hien on public.phieu_giam_vat_nhat_ky;
create trigger ep_nguoi_thuc_hien before insert on public.phieu_giam_vat_nhat_ky
  for each row execute function public.ep_nguoi_thuc_hien();

-- 6. Đặt giảm giá + VAT cho một phiếu (nháp: mọi vai trò trong ngưỡng; đã hoàn thành: chỉ Chủ) -----------------------
create or replace function public.phieu_dat_giam_vat(
  p_order uuid, p_giam_kieu text, p_giam_gia_tri numeric, p_vat_suat numeric, p_vat_che_do text, p_ly_do text,
  p_dong jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o record; cfg record; it record; d record; t0 record; t1 record;
  v_chu boolean := public.la_chu(); v_nhap text := btrim(coalesce(p_ly_do, '')); v_ly text;
  v_dong jsonb := coalesce(p_dong, '[]'::jsonb); v_gv numeric; v_goc numeric; v_da numeric;
  v_ggv numeric; v_doi boolean := false; v_doi_giam boolean := false;
  v_truoc jsonb; v_sau jsonb; v_ten text;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_giam_kieu is null or p_giam_kieu not in ('pt', 'tien') then raise exception 'Kiểu giảm giá không hợp lệ'; end if;
  if p_vat_che_do is null or p_vat_che_do not in ('chua', 'da') then raise exception 'Chế độ VAT không hợp lệ'; end if;
  if jsonb_typeof(v_dong) <> 'array' then raise exception 'Dữ liệu giảm giá từng dòng không hợp lệ'; end if;
  if p_giam_gia_tri is null or p_giam_gia_tri < 0 then raise exception 'Giảm giá không được âm'; end if;
  if p_giam_kieu = 'pt' and p_giam_gia_tri > 100 then raise exception 'Giảm giá theo phần trăm tối đa 100'; end if;
  if p_vat_suat is null or p_vat_suat < 0 or p_vat_suat > 100 then raise exception 'Thuế suất không hợp lệ'; end if;
  if char_length(v_nhap) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  v_ggv := case when p_giam_kieu = 'tien' then round(p_giam_gia_tri) else round(p_giam_gia_tri, 2) end;

  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy, không sửa được'; end if;
  if o.stock_deducted and not v_chu then
    raise exception 'Phiếu đã hoàn thành: chỉ Chủ xưởng được sửa giảm giá / VAT (bấm "Mở chỉnh sửa")';
  end if;
  select * into cfg from public.phieu_cai_dat limit 1;
  if p_vat_suat is distinct from o.vat_suat and not (round(p_vat_suat, 2) = any (cfg.vat_suat_ds)) then
    raise exception 'Thuế suất % phần trăm không có trong danh sách (Chủ xưởng chỉnh trong Cài đặt)', p_vat_suat;
  end if;

  -- kiểm tra từng dòng gửi lên
  for d in select * from jsonb_to_recordset(v_dong) as x(id uuid, kieu text, gia_tri numeric) loop
    select * into it from public.repair_items where id = d.id and order_id = p_order;
    if not found then raise exception 'Có dòng không thuộc phiếu này'; end if;
    if d.kieu is null or d.kieu not in ('pt', 'tien') then raise exception 'Kiểu giảm giá của dòng "%" không hợp lệ', it.name; end if;
    if d.gia_tri is null or d.gia_tri < 0 then raise exception 'Giảm giá của dòng "%" không được âm', it.name; end if;
    if d.kieu = 'pt' and d.gia_tri > 100 then raise exception 'Giảm giá phần trăm của dòng "%" tối đa 100', it.name; end if;
    v_goc := round(it.qty * it.unit_price);
    if d.kieu = 'tien' and round(d.gia_tri) > v_goc then
      raise exception 'Giảm giá của dòng "%" (% đ) lớn hơn thành tiền dòng (% đ)', it.name, round(d.gia_tri), v_goc;
    end if;
    v_gv := case when d.kieu = 'tien' then round(d.gia_tri) else round(d.gia_tri, 2) end;
    if it.giam_kieu is distinct from d.kieu or it.giam_gia_tri is distinct from v_gv then
      v_doi := true; v_doi_giam := true;
    end if;
  end loop;
  if o.giam_kieu is distinct from p_giam_kieu or o.giam_gia_tri is distinct from v_ggv then v_doi := true; v_doi_giam := true; end if;
  if o.vat_suat is distinct from round(p_vat_suat, 2) or o.vat_che_do is distinct from p_vat_che_do then v_doi := true; end if;

  select * into t0 from public.tinh_tong_phieu_noi_bo(p_order);
  if not v_doi then
    return jsonb_build_object('truoc', t0.tong_thanh_toan, 'sau', t0.tong_thanh_toan, 'doi', false);
  end if;
  if o.stock_deducted and v_nhap = '' then raise exception 'Bắt buộc nhập lý do khi sửa giảm giá / VAT của phiếu đã hoàn thành'; end if;

  v_truoc := jsonb_build_object(
    'giam_kieu', o.giam_kieu, 'giam_gia_tri', o.giam_gia_tri, 'giam_ly_do', o.giam_ly_do,
    'vat_suat', o.vat_suat, 'vat_che_do', o.vat_che_do,
    'giam_dong', (select coalesce(jsonb_agg(jsonb_build_object('dong', i.name, 'kieu', i.giam_kieu, 'gia_tri', i.giam_gia_tri) order by i.created_at), '[]'::jsonb)
                  from public.repair_items i where i.order_id = p_order and i.giam_gia_tri <> 0),
    'giam_gia', t0.giam_gia, 'vat', t0.vat, 'tong_thanh_toan', t0.tong_thanh_toan);

  v_ten := coalesce(public.ten_nguoi_dung(auth.uid()), (select email from auth.users where id = auth.uid()), 'Không rõ');
  perform set_config('app.giam_vat', '1', true);
  perform set_config('app.hanh_dong', 'sua_giam_gia_vat', true);
  perform set_config('app.ly_do', v_nhap, true);
  for d in select * from jsonb_to_recordset(v_dong) as x(id uuid, kieu text, gia_tri numeric) loop
    update public.repair_items
       set giam_kieu = d.kieu, giam_gia_tri = case when d.kieu = 'tien' then round(d.gia_tri) else round(d.gia_tri, 2) end
     where id = d.id and order_id = p_order;
  end loop;
  -- lý do giảm giá của phiếu (dùng lại lý do cũ nếu không nhập mới); không còn giảm giá nào thì xóa lý do
  update public.repair_orders
     set giam_kieu = p_giam_kieu, giam_gia_tri = v_ggv, vat_suat = round(p_vat_suat, 2), vat_che_do = p_vat_che_do,
         giam_ly_do = case when v_ggv = 0 and not exists (select 1 from public.repair_items where order_id = p_order and giam_gia_tri <> 0)
                           then null else nullif(coalesce(nullif(v_nhap, ''), o.giam_ly_do), '') end
   where id = p_order;

  select * into t1 from public.tinh_tong_phieu_noi_bo(p_order);
  if p_giam_kieu = 'tien' and v_ggv > t1.tam_tinh - t1.giam_dong then
    raise exception 'Giảm giá toàn phiếu (% đ) lớn hơn tiền hàng còn lại (% đ)', v_ggv, t1.tam_tinh - t1.giam_dong;
  end if;
  if t1.giam_gia > 0 then
    v_ly := coalesce(nullif(v_nhap, ''), o.giam_ly_do);
    if v_ly is null then raise exception 'Hãy nhập lý do giảm giá'; end if;
  end if;
  -- ngưỡng giảm giá của nhân viên (chỉ kiểm tra khi có đổi giảm giá)
  if not v_chu and v_doi_giam and t1.giam_gia > 0
     and t1.giam_gia * 100 > t1.tam_tinh * cfg.giam_toi_da_nv + 0.0001 then
    raise exception 'Giảm giá % đ (%) vượt ngưỡng nhân viên % phần trăm. Chỉ Chủ xưởng được giảm nhiều hơn',
      t1.giam_gia, round(t1.giam_gia * 100 / nullif(t1.tam_tinh, 0), 2) || '%', cfg.giam_toi_da_nv;
  end if;
  -- phiếu chưa hoàn thành: tổng mới không được thấp hơn số đã thu
  if not o.stock_deducted then
    select coalesce(sum(so_tien), 0) into v_da from public.order_payments where order_id = p_order and not da_huy;
    if v_da > t1.tong_thanh_toan + 0.5 then
      raise exception 'Đã thu % đ nhưng sau khi đổi tổng phiếu chỉ còn % đ. Hãy hủy bớt khoản thu trước', round(v_da), t1.tong_thanh_toan;
    end if;
  end if;

  v_sau := jsonb_build_object(
    'giam_kieu', p_giam_kieu, 'giam_gia_tri', v_ggv, 'giam_ly_do', v_ly,
    'vat_suat', round(p_vat_suat, 2), 'vat_che_do', p_vat_che_do,
    'giam_dong', (select coalesce(jsonb_agg(jsonb_build_object('dong', i.name, 'kieu', i.giam_kieu, 'gia_tri', i.giam_gia_tri) order by i.created_at), '[]'::jsonb)
                  from public.repair_items i where i.order_id = p_order and i.giam_gia_tri <> 0),
    'giam_gia', t1.giam_gia, 'vat', t1.vat, 'tong_thanh_toan', t1.tong_thanh_toan);
  insert into public.phieu_giam_vat_nhat_ky (order_id, da_hoan_thanh, ly_do, truoc, sau, tong_truoc, tong_sau, created_by_name)
    values (p_order, o.stock_deducted, nullif(v_nhap, ''), v_truoc, v_sau, t0.tong_thanh_toan, t1.tong_thanh_toan, v_ten);
  perform set_config('app.giam_vat', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  return jsonb_build_object('truoc', t0.tong_thanh_toan, 'sau', t1.tong_thanh_toan, 'doi', true);
end $$;
revoke execute on function public.phieu_dat_giam_vat(uuid, text, numeric, numeric, text, text, jsonb) from public, anon;
grant execute on function public.phieu_dat_giam_vat(uuid, text, numeric, numeric, text, text, jsonb) to authenticated;

-- 7. Dòng báo giá cho màn hình và trang in: thêm cột giảm giá của dòng (chỉ giá bán) ----------------------------------
drop function if exists public.dong_bao_gia(uuid);
create function public.dong_bao_gia(p_order uuid)
returns table (id uuid, kind text, name text, qty numeric, unit_price numeric, don_vi text,
               giam_kieu text, giam_gia_tri numeric, thanh_tien numeric, giam_tien numeric, sau_giam numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.kind, i.name, i.qty, i.unit_price, case when i.kind = 'part' then coalesce(i.don_vi, 'cái') else null end,
         i.giam_kieu, i.giam_gia_tri,
         round(i.qty * i.unit_price),
         public.giam_tien(round(i.qty * i.unit_price), i.giam_kieu, i.giam_gia_tri),
         round(i.qty * i.unit_price) - public.giam_tien(round(i.qty * i.unit_price), i.giam_kieu, i.giam_gia_tri)
  from public.repair_items i
  where public.vai_tro() is not null and i.order_id = p_order
  order by i.created_at
$$;
revoke execute on function public.dong_bao_gia(uuid) from public, anon;
grant execute on function public.dong_bao_gia(uuid) to authenticated;

-- 8. Thay mọi chỗ tự cộng qty x unit_price bằng hàm tổng duy nhất -----------------------------------------------------
-- 8a. Ghi khoản thu: kiểm tra thu vượt theo TỔNG THANH TOÁN
create or replace function public.ghi_khoan_thu(p_order uuid, p_so_tien numeric, p_hinh_thuc text, p_ngay date, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o record; v_total numeric; v_da numeric; v_id uuid;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_hinh_thuc not in ('Tiền mặt', 'Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if p_so_tien is null or p_so_tien <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  v_total := public.tong_thanh_toan_phieu(p_order);
  select coalesce(sum(so_tien), 0) into v_da from public.order_payments where order_id = p_order and not da_huy;
  if v_da + p_so_tien > v_total + 0.5 then
    raise exception 'Số thu vượt số còn nợ: tổng phiếu % đ, đã thu % đ, còn nợ % đ', round(v_total), round(v_da), round(v_total - v_da);
  end if;
  insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu)
    values (p_order, 'thu', round(p_so_tien), p_hinh_thuc, coalesce(p_ngay, public.ngay_hom_nay()), nullif(btrim(coalesce(p_ghi_chu, '')), ''))
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.ghi_khoan_thu(uuid, numeric, text, date, text) from public, anon;
grant execute on function public.ghi_khoan_thu(uuid, numeric, text, date, text) to authenticated;

-- 8b. Xóa dòng phiếu chưa hoàn thành: không để tổng phiếu thấp hơn số đã thu
create or replace function public.phieu_xoa_dong(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it record; o record; v_moi numeric; v_da numeric;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  select * into it from public.repair_items where id = p_item;
  if not found then raise exception 'Không tìm thấy dòng (có thể đã bị xóa)'; end if;
  select * into o from public.repair_orders where id = it.order_id for update;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  if o.stock_deducted then raise exception 'Phiếu đã hoàn thành: Chủ xưởng dùng "Mở chỉnh sửa"'; end if;
  delete from public.repair_items where id = p_item;
  v_moi := public.tong_thanh_toan_phieu(it.order_id);
  select coalesce(sum(so_tien), 0) into v_da from public.order_payments where order_id = it.order_id and not da_huy;
  if v_da > v_moi + 0.5 then
    raise exception 'Đã thu % đ, xóa dòng này tổng phiếu chỉ còn % đ. Hãy hủy bớt khoản thu trước', round(v_da), round(v_moi);
  end if;
end $$;
revoke execute on function public.phieu_xoa_dong(uuid) from public, anon;
grant execute on function public.phieu_xoa_dong(uuid) to authenticated;

-- 8c. Sửa phiếu đã hoàn thành (chỉ Chủ): tổng trước / sau ghi nhật ký là TỔNG THANH TOÁN
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

  v_before := public.tong_thanh_toan_phieu(p_order);
  perform set_config('app.sua_phieu', '1', true);
  perform public.doi_ton(p.id, -p_qty, 'them_khi_sua', p_order, null, 'Thêm phụ tùng khi sửa phiếu đã hoàn thành');
  insert into public.repair_items (order_id, part_id, kind, name, qty, unit_price)
    values (p_order, p.id, 'part', p.name, p_qty, p.sale_price) returning id into v_item;
  insert into public.repair_item_costs (item_id, cost_price)
    values (v_item, coalesce((select cost_price from public.part_costs where part_id = p.id), 0));
  perform set_config('app.sua_phieu', '', true);
  v_after := public.tong_thanh_toan_phieu(p_order);

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (p_order, 'them', 'part', p.name, p_qty, p.sale_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;
revoke execute on function public.sua_phieu_them_phu_tung(uuid, uuid, numeric) from public, anon;
grant execute on function public.sua_phieu_them_phu_tung(uuid, uuid, numeric) to authenticated;

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

  v_before := public.tong_thanh_toan_phieu(p_order);
  perform set_config('app.sua_phieu', '1', true);
  insert into public.repair_items (order_id, kind, name, qty, unit_price)
    values (p_order, 'labor', v_name, 1, round(p_price));
  perform set_config('app.sua_phieu', '', true);
  v_after := public.tong_thanh_toan_phieu(p_order);

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (p_order, 'them', 'labor', v_name, 1, round(p_price), v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;
revoke execute on function public.sua_phieu_them_cong(uuid, text, numeric) from public, anon;
grant execute on function public.sua_phieu_them_cong(uuid, text, numeric) to authenticated;

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

  v_before := public.tong_thanh_toan_phieu(o.id);
  perform set_config('app.sua_phieu', '1', true);
  if it.kind = 'part' and it.part_id is not null then
    perform public.doi_ton(it.part_id, it.qty, 'xoa_khi_sua', o.id, null, 'Xóa phụ tùng khi sửa phiếu đã hoàn thành');
  end if;
  delete from public.repair_items where id = p_item;
  perform set_config('app.sua_phieu', '', true);
  v_after := public.tong_thanh_toan_phieu(o.id);

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name)
    values (o.id, 'xoa', it.kind, it.name, it.qty, it.unit_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;
revoke execute on function public.sua_phieu_xoa_dong(uuid) from public, anon;
grant execute on function public.sua_phieu_xoa_dong(uuid) to authenticated;

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

  v_before := public.tong_thanh_toan_phieu(o.id);
  perform set_config('app.sua_phieu', '1', true);
  perform public.doi_ton(it.part_id, p_qty, 'khach_tra', o.id, null, v_ly_do);
  if p_qty = it.qty then
    delete from public.repair_items where id = it.id;
  else
    update public.repair_items set qty = qty - p_qty where id = it.id;
  end if;
  perform set_config('app.sua_phieu', '', true);
  v_after := public.tong_thanh_toan_phieu(o.id);

  insert into public.repair_edit_logs (order_id, action, kind, item_name, qty, unit_price, total_before, total_after, created_by_name, ghi_chu)
    values (o.id, 'tra', 'part', it.name, p_qty, it.unit_price, v_before, v_after,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'), v_ly_do);
  return jsonb_build_object('truoc', v_before, 'sau', v_after);
end $$;
revoke execute on function public.khach_tra_hang(uuid, numeric, text) from public, anon;
grant execute on function public.khach_tra_hang(uuid, numeric, text) to authenticated;

-- 8d. Công nợ: danh sách phiếu nợ, tổng nợ, đối chiếu (Tổng = tổng thanh toán đã gồm VAT)
create or replace function public.cong_no_phieu()
returns table (order_id uuid, ma_phieu bigint, customer_id uuid, bien_so text, ngay_hoan_thanh date, tong numeric, da_thu numeric, con_no numeric)
language sql stable security definer set search_path = public as $$
  select o.id, o.code, o.customer_id, v.plate, o.paid_at, t.tong, coalesce(p.da_thu, 0), t.tong - coalesce(p.da_thu, 0)
  from public.repair_orders o
  join public.vehicles v on v.id = o.vehicle_id
  cross join lateral (select x.tong_thanh_toan as tong from public.tinh_tong_phieu_noi_bo(o.id) x) t
  left join lateral (select sum(op.so_tien) as da_thu from public.order_payments op where op.order_id = o.id and not op.da_huy) p on true
  where public.vai_tro() is not null
    and o.stock_deducted and not o.da_huy
    and t.tong - coalesce(p.da_thu, 0) > 0.5
$$;
revoke execute on function public.cong_no_phieu() from public, anon;
grant execute on function public.cong_no_phieu() to authenticated;

create or replace function public.cong_no_tong()
returns table (tong numeric, so_khach bigint, so_phieu bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select o.customer_id,
           public.tong_thanh_toan_phieu(o.id)
         - (select coalesce(sum(op.so_tien), 0) from public.order_payments op where op.order_id = o.id and not op.da_huy) as no
    from public.repair_orders o
    where public.vai_tro() is not null and o.stock_deducted and not o.da_huy
  )
  select coalesce(sum(no), 0), count(distinct customer_id), count(*) from x where no > 0.5
$$;
revoke execute on function public.cong_no_tong() from public, anon;
grant execute on function public.cong_no_tong() to authenticated;

create or replace function public.cong_no_doi_chieu()
returns table (loai text, order_id uuid, ma_phieu bigint, ten_khach text, tong numeric, da_thu numeric, chenh numeric)
language sql stable security definer set search_path = public as $$
  select case when o.da_huy then 'Phiếu đã hủy nhưng còn khoản thu chưa đảo' else 'Đã thu nhiều hơn tổng phiếu' end,
         o.id, o.code, c.name, s.tong, s.da_thu, s.da_thu - s.tong
  from public.repair_orders o
  join public.customers c on c.id = o.customer_id
  cross join lateral (
    select public.tong_thanh_toan_phieu(o.id) as tong,
           (select coalesce(sum(op.so_tien), 0) from public.order_payments op where op.order_id = o.id and not op.da_huy) as da_thu
  ) s
  where public.vai_tro() is not null
    and ((o.da_huy and abs(s.da_thu) > 0.5) or (o.stock_deducted and not o.da_huy and s.da_thu - s.tong > 0.5))
  order by o.code
$$;
revoke execute on function public.cong_no_doi_chieu() from public, anon;
grant execute on function public.cong_no_doi_chieu() to authenticated;

-- 8e. Hồ sơ khách
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
           public.tong_thanh_toan_phieu(r.id) as tong,
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

-- 8f. Danh sách phiếu dạng bảng: Tổng tiền = tổng thanh toán; thêm cột Giá vốn / VAT / Giảm giá (chỉ Chủ, nhân viên nhận ô trống)
drop function if exists public.ds_phieu_tiep_nhan(text, text[], date, date, uuid, boolean, jsonb, text, text, int, int, text, text);
drop function if exists public.ds_phieu_co_so(text, text[], date, date, uuid, boolean, jsonb);

create function public.ds_phieu_co_so(
  p_tu_khoa text, p_trang_thai text[], p_tu date, p_den date, p_ktv uuid, p_chi_no boolean, p_loc jsonb
) returns table (
  id uuid, code bigint, received_at timestamptz, status text, da_huy boolean, stock_deducted boolean,
  khach text, sdt text, bien_so text, xe text, vin text, odometer integer, ktv text, issue text,
  tong numeric, da_thu numeric, con_no numeric, von numeric, loi_nhuan numeric, vat numeric, giam_gia numeric, ngay date
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
           t.tong_thanh_toan as tong, coalesce(p.da_thu, 0) as da_thu,
           case when o.stock_deducted and not o.da_huy then t.tong_thanh_toan - coalesce(p.da_thu, 0) else 0 end as con_no,
           case when (select la from chu) and o.stock_deducted and not o.da_huy then w.von else null end as von,
           case when (select la from chu) and o.stock_deducted and not o.da_huy
                then t.doanh_thu - w.von - coalesce(cp.chi_phi, 0) else null end as loi_nhuan,
           case when (select la from chu) then t.vat else null end as vat,
           case when (select la from chu) then t.giam_gia else null end as giam_gia,
           (o.received_at at time zone 'Asia/Ho_Chi_Minh')::date as ngay
    from public.repair_orders o
    join public.vehicles v on v.id = o.vehicle_id
    join public.customers c on c.id = o.customer_id
    cross join lateral public.tinh_tong_phieu_noi_bo(o.id) t
    cross join lateral (
      select case when (select la from chu) then coalesce(sum(case when ri.kind = 'part' then ri.qty * coalesce(rc.cost_price, 0) else 0 end), 0) else 0 end as von
      from public.repair_items ri
      left join public.repair_item_costs rc on rc.item_id = ri.id and (select la from chu)
      where ri.order_id = o.id) w
    left join lateral (select sum(op.so_tien) as da_thu from public.order_payments op where op.order_id = o.id and not op.da_huy) p on true
    left join lateral (select sum(r.amount) as chi_phi from public.repair_costs r where r.order_id = o.id and not r.da_huy and r.kind in ('vat_tu', 'thue_ngoai', 'khac') and (select la from chu)) cp on true
    where public.vai_tro() is not null
  )
  select x.id, x.code, x.received_at, x.status, x.da_huy, x.stock_deducted, x.khach, x.sdt, x.bien_so, x.xe, x.vin, x.odometer,
         x.ktv, x.issue, x.tong, x.da_thu, x.con_no, x.von, x.loi_nhuan, x.vat, x.giam_gia, x.ngay
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

create function public.ds_phieu_tiep_nhan(
  p_tu_khoa text, p_trang_thai text[], p_tu date, p_den date, p_ktv uuid, p_chi_no boolean, p_loc jsonb,
  p_sap_xep text, p_huong text, p_gioi_han int, p_bat_dau int, p_nhom_cot text, p_nhom_gia_tri text
) returns table (
  id uuid, code bigint, received_at timestamptz, status text, da_huy boolean, stock_deducted boolean,
  khach text, sdt text, bien_so text, xe text, vin text, odometer integer, ktv text, issue text,
  tong numeric, da_thu numeric, con_no numeric, von numeric, loi_nhuan numeric, vat numeric, giam_gia numeric, tong_hang bigint
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
    when 'von' then (case when public.la_chu() then 'von' else 'code' end)
    when 'loi_nhuan' then (case when public.la_chu() then 'loi_nhuan' else 'code' end)
    when 'vat' then (case when public.la_chu() then 'vat' else 'code' end)
    when 'giam_gia' then (case when public.la_chu() then 'giam_gia' else 'code' end)
    else 'received_at' end;
  v_huong := case when lower(coalesce(p_huong, '')) = 'asc' then 'asc' else 'desc' end;
  v_nhom := case p_nhom_cot
    when 'status' then 'status' when 'ngay' then 'to_char(ngay, ''DD/MM/YYYY'')'
    when 'khach' then 'khach' when 'ktv' then 'coalesce(ktv, ''(Chưa giao)'')' else null end;
  return query execute
    'select id, code, received_at, status, da_huy, stock_deducted, khach, sdt, bien_so, xe, vin, odometer, ktv, issue, tong, da_thu, con_no, von, loi_nhuan, vat, giam_gia, count(*) over() as tong_hang '
    || 'from public.ds_phieu_co_so($1, $2, $3, $4, $5, $6, $7) '
    || case when v_nhom is not null and p_nhom_gia_tri is not null then 'where ' || v_nhom || ' = $8 ' else '' end
    || format('order by %s %s nulls last, code desc limit %s offset %s', v_cot, v_huong, v_gh, greatest(coalesce(p_bat_dau, 0), 0))
    using p_tu_khoa, p_trang_thai, p_tu, p_den, p_ktv, p_chi_no, p_loc, p_nhom_gia_tri;
end $$;
revoke execute on function public.ds_phieu_tiep_nhan(text, text[], date, date, uuid, boolean, jsonb, text, text, int, int, text, text) from public, anon;
grant execute on function public.ds_phieu_tiep_nhan(text, text[], date, date, uuid, boolean, jsonb, text, text, int, int, text, text) to authenticated;

-- 9. Báo cáo doanh thu cho Chủ (Tổng quan, trang Vốn, bảng 12 tháng): doanh thu SAU giảm, TRƯỚC thuế -----------------
-- p_nhom = 'ngay' (mỗi ngày thu tiền một dòng) hoặc 'thang' (mỗi tháng một dòng). Tính theo ngày hoàn thành (paid_at) như cũ.
create or replace function public.bao_cao_phieu(p_tu date, p_den date, p_nhom text)
returns table (ky date, so_phieu bigint, tam_tinh numeric, giam_gia numeric, vat numeric, tong_thanh_toan numeric, doanh_thu numeric,
               gia_von numeric, chi_vat_tu numeric, chi_thue_ngoai numeric, chi_khac numeric, chi_tat_ca numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem báo cáo doanh thu'; end if;
  return query
    select case when p_nhom = 'thang' then date_trunc('month', o.paid_at)::date else o.paid_at end,
           count(*)::bigint, sum(t.tam_tinh), sum(t.giam_gia), sum(t.vat), sum(t.tong_thanh_toan), sum(t.doanh_thu),
           sum(w.von), sum(cp.vat_tu), sum(cp.thue_ngoai), sum(cp.khac), sum(cp.tat_ca)
    from public.repair_orders o
    cross join lateral public.tinh_tong_phieu_noi_bo(o.id) t
    cross join lateral (
      select coalesce(sum(case when i.kind = 'part' then i.qty * coalesce(c.cost_price, 0) else 0 end), 0) as von
      from public.repair_items i left join public.repair_item_costs c on c.item_id = i.id
      where i.order_id = o.id) w
    cross join lateral (
      select coalesce(sum(r.amount) filter (where r.kind = 'vat_tu'), 0) as vat_tu,
             coalesce(sum(r.amount) filter (where r.kind = 'thue_ngoai'), 0) as thue_ngoai,
             coalesce(sum(r.amount) filter (where r.kind = 'khac'), 0) as khac,
             coalesce(sum(r.amount), 0) as tat_ca
      from public.repair_costs r where r.order_id = o.id and not r.da_huy) cp
    where o.stock_deducted and not o.da_huy and o.paid_at >= p_tu and o.paid_at <= p_den
    group by 1
    order by 1;
end $$;
revoke execute on function public.bao_cao_phieu(date, date, text) from public, anon;
grant execute on function public.bao_cao_phieu(date, date, text) to authenticated;

-- 10. ĐỐI CHIẾU tổng phiếu (chỉ Chủ): trang in = tổng trong phiếu = tổng dùng tính công nợ = tổng trong danh sách -----------
-- Chỉ liệt kê chỗ LỆCH. Không có dòng nào = khớp hết.
create or replace function public.phieu_doi_chieu_tong()
returns table (loai text, order_id uuid, ma_phieu bigint, ten_khach text, tong_phieu numeric, tong_so_sanh numeric, chenh numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đối chiếu'; end if;
  return query
  with ds as (select d.id, d.tong from public.ds_phieu_co_so('', null, null, null, null, false, null) d),
  x as (
    select o.id, o.code, c.name as khach, o.giam_kieu, o.giam_gia_tri, o.vat_suat, o.vat_che_do, o.stock_deducted, o.da_huy,
           public.tong_thanh_toan_phieu(o.id) as tong_phieu,
           (select t2.tong_thanh_toan
              from (select coalesce(sum(b.thanh_tien), 0) as tt, coalesce(sum(b.giam_tien), 0) as gd from public.dong_bao_gia(o.id) b) l
              cross join lateral public.tinh_tong_tu_so(l.tt, l.gd, o.giam_kieu, o.giam_gia_tri, o.vat_suat, o.vat_che_do) t2) as tong_in,
           (select coalesce(sum(i.qty * i.unit_price), 0) from public.repair_items i where i.order_id = o.id) as tong_cu_tho,
           not exists (select 1 from public.repair_items i where i.order_id = o.id and i.giam_gia_tri <> 0) as dong_khong_giam
    from public.repair_orders o join public.customers c on c.id = o.customer_id
  )
  select q.loai, q.id, q.code, q.khach, q.tong_phieu, q.so_sanh, q.so_sanh - q.tong_phieu
  from (
    select 'Trang in khác tổng trong phiếu'::text as loai, x.id, x.code, x.khach, x.tong_phieu, x.tong_in as so_sanh
      from x where x.tong_in is distinct from x.tong_phieu
    union all
    select 'Công nợ tính khác tổng trong phiếu', x.id, x.code, x.khach, x.tong_phieu, n.tong
      from x join public.cong_no_phieu() n on n.order_id = x.id where n.tong <> x.tong_phieu
    union all
    select 'Danh sách phiếu hiện khác tổng trong phiếu', x.id, x.code, x.khach, x.tong_phieu, ds.tong
      from x join ds on ds.id = x.id where ds.tong <> x.tong_phieu
    union all
    select 'Phiếu chưa giảm giá / VAT nhưng tổng khác cách cộng cũ', x.id, x.code, x.khach, x.tong_phieu, round(x.tong_cu_tho)
      from x where x.giam_gia_tri = 0 and x.dong_khong_giam and x.vat_suat = 0 and abs(x.tong_phieu - x.tong_cu_tho) >= 1
  ) q
  order by q.code, q.loai;
end $$;
revoke execute on function public.phieu_doi_chieu_tong() from public, anon;
grant execute on function public.phieu_doi_chieu_tong() to authenticated;

notify pgrst, 'reload schema';

-- ===== KIỂM TRA SAU KHI RUN (chỉ đọc; kết quả là MỘT dòng) =====
-- Ví dụ yêu cầu: tạm tính 1.000.000, giảm 10 phần trăm, VAT 10 phần trăm (giá chưa gồm VAT)
--   => vd1_tong_phai_la_990000, vd1_doanh_thu_phai_la_900000, vd1_vat_phai_la_90000
-- Cùng số nhưng giá ĐÃ gồm VAT: tổng 900000, VAT tách ra 81818, doanh thu 818182
select
  (select tong_thanh_toan from public.tinh_tong_tu_so(1000000, 0, 'pt', 10, 10, 'chua')) as vd1_tong_phai_la_990000,
  (select doanh_thu from public.tinh_tong_tu_so(1000000, 0, 'pt', 10, 10, 'chua')) as vd1_doanh_thu_phai_la_900000,
  (select vat from public.tinh_tong_tu_so(1000000, 0, 'pt', 10, 10, 'chua')) as vd1_vat_phai_la_90000,
  (select tong_thanh_toan from public.tinh_tong_tu_so(1000000, 0, 'pt', 10, 10, 'da')) as vd2_tong_phai_la_900000,
  (select doanh_thu from public.tinh_tong_tu_so(1000000, 0, 'pt', 10, 10, 'da')) as vd2_doanh_thu_phai_la_818182,
  (select tong_thanh_toan from public.tinh_tong_tu_so(1000000, 0, 'tien', 0, 0, 'chua')) as vd3_phai_la_1000000,
  (select count(*) from public.repair_orders) as so_phieu,
  -- Phiếu chưa giảm giá / VAT mà tổng khác cách cộng cũ từ 1 đồng trở lên: phải = 0 (phiếu cũ giữ nguyên số)
  (select count(*) from public.repair_orders o
    where o.giam_gia_tri = 0 and o.vat_suat = 0
      and not exists (select 1 from public.repair_items i where i.order_id = o.id and i.giam_gia_tri <> 0)
      and abs(public.tong_thanh_toan_phieu(o.id) - coalesce((select sum(i.qty * i.unit_price) from public.repair_items i where i.order_id = o.id), 0)) >= 1
  ) as so_phieu_doi_so_phai_la_0,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'phieu_cai_dat') as cai_dat_bat_bao_mat_phai_la_true,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'phieu_giam_vat_nhat_ky') as nhat_ky_bat_bao_mat_phai_la_true;
