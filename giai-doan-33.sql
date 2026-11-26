-- GIAI ĐOẠN 33: Tách doanh thu CÔNG / PHỤ TÙNG + Chia tiền tháng + Quỹ dự phòng
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn. Cần đã chạy giai-doan-20, 21, 26, 31, 32.
--
-- ===== CAM KẾT KHÔNG LÀM SAI DỮ LIỆU HIỆN TẠI =====
--  * KHÔNG sửa / xóa dòng phiếu, giá, giá vốn, tồn kho, khoản thu, chi phí phiếu, sổ quỹ nào.
--  * KHÔNG đổi hàm cũ (bao_cao_phieu, tinh_tong_phieu, sổ quỹ...). Chỉ THÊM bảng, cột, hàm mới.
--  * Cuối file có KIỂM TRA TỰ ĐỘNG: số dư 2 quỹ, số dòng sổ quỹ / phiếu / kho / khoản thu / chi phí, tổng tồn kho
--    phải y hệt trước khi chạy; công + phụ tùng phải đúng bằng doanh thu của TỪNG phiếu cũ.
--    Lệch dù 1 đồng -> báo lỗi và Supabase hủy toàn bộ file (không lưu gì).
--
-- ===== NỘI DUNG =====
--  1. Tách doanh thu mỗi phiếu (áp dụng cho MỌI phiếu từ trước tới giờ, chỉ ĐỌC dữ liệu):
--       Doanh thu công      = tiền dòng công sau giảm giá dòng
--       Doanh thu phụ tùng  = tiền dòng phụ tùng sau giảm giá dòng
--       Giảm giá cả phiếu (và VAT nếu giá đã gồm VAT) chia theo tỷ lệ công / phụ tùng. Công + phụ tùng = doanh thu (trước VAT).
--       Lợi nhuận phụ tùng  = doanh thu phụ tùng - giá nhập đã chốt (của chủ, không chia)
--       Phần công còn lại   = doanh thu công - chi phí phiếu (vật tư, thuê ngoài, khác)
--  2. Nhóm chia tiền cho từng loại phiếu thu / chi (cột nhom_chia): 'cong' / 'phu_tung' / 'khong'.
--     Loại có sẵn được gán tự động: loại tính vào lãi lỗ + hoạt động -> 'cong' (chi phí nuôi xưởng); còn lại -> 'khong'.
--     Thêm loại chi "Chia tiền tháng" (KHÔNG tính lãi lỗ, KHÔNG trừ lần nữa) để ghi khi trả tiền chia cho mọi người.
--  3. Chia tiền tháng (chia_tien_ky + chia_tien_nguoi): chỉ thêm dòng. Hủy kỳ = đánh dấu hủy + lý do bắt buộc.
--       Phần công còn lại tháng = doanh thu công - chi phí phiếu - chi phí nuôi xưởng (nhóm 'cong') + thu nhóm 'cong' +/- khoản khác
--       Quỹ dự phòng          = phần công còn lại x % (chủ nhập). Phần công âm -> không trích, không chia.
--       Phần chia             = phần công còn lại - dự phòng -> chia theo % từng người (tổng 100%)
--       Lợi nhuận phụ tùng    = 100% của chủ (trừ chi nhóm 'phu_tung', cộng thu nhóm 'phu_tung')
--  4. Sổ quỹ dự phòng (du_phong_so): chỉ thêm dòng. Trích khi chốt kỳ, Dùng khi có việc (lý do bắt buộc), Hủy = dòng đảo.
--     Đây là sổ THEO DÕI, không phải quỹ tiền thứ ba: số dư Tiền mặt / Tài khoản ngân hàng KHÔNG đổi.
--  5. Chỉ Chủ xưởng xem và dùng (RLS + kiểm tra trong hàm). Mọi thao tác ghi nhật ký hoạt động.
--     Chính sách RLS đặt tên bắt đầu bằng "vt_" để file bao-mat.sql (nếu lỡ chạy lại) KHÔNG mở quyền các bảng này.

-- 0. Chốt chặn + chụp số liệu TRƯỚC khi chạy ---------------------------------------------------------------
do $$
begin
  if to_regclass('public.loai_phieu_thu') is null or to_regprocedure('public.tinh_tong_phieu_noi_bo(uuid)') is null
     or to_regclass('public.so_quy') is null then
    raise exception 'Chưa chạy đủ giai-doan-21, 26, 31, 32. Hãy chạy các file đó trước.';
  end if;
end $$;

drop table if exists pg_temp.gd33_truoc;
create temp table gd33_truoc as
select 'quy:' || c.quy as k, public.quy_so_du_noi_bo(c.quy) as v from public.quy_cai_dat c
union all select 'dong_so_quy', count(*)::numeric from public.so_quy
union all select 'tong_so_quy', coalesce(sum(so_tien), 0) from public.so_quy
union all select 'dong_phieu', count(*)::numeric from public.repair_orders
union all select 'dong_bao_gia', count(*)::numeric from public.repair_items
union all select 'tong_bao_gia', coalesce(sum(qty * unit_price), 0) from public.repair_items
union all select 'gia_von_chot', coalesce(sum(cost_price), 0) from public.repair_item_costs
union all select 'dong_khoan_thu', count(*)::numeric from public.order_payments
union all select 'tong_khoan_thu', coalesce(sum(so_tien), 0) from public.order_payments
union all select 'dong_chi_phi', count(*)::numeric from public.repair_costs
union all select 'tong_chi_phi', coalesce(sum(amount), 0) from public.repair_costs
union all select 'dong_so_kho', count(*)::numeric from public.stock_ledger
union all select 'tong_ton_kho', coalesce(sum(stock), 0) from public.parts;

-- 1. Tách doanh thu một phiếu (nội bộ, không cấp quyền trực tiếp) ---------------------------------------------
create or replace function public.tach_phieu_noi_bo(p_order uuid)
returns table (doanh_thu numeric, dt_cong numeric, dt_pt numeric, gia_von_pt numeric, ln_pt numeric,
               chi_phi_phieu numeric, phan_cong numeric, pt_thieu_gia int)
language sql stable as $$
  select t.doanh_thu, c.cong, t.doanh_thu - c.cong, l.von, t.doanh_thu - c.cong - l.von,
         cp.tat_ca, c.cong - cp.tat_ca, l.thieu
  from public.repair_orders o
  cross join lateral public.tinh_tong_phieu_noi_bo(o.id) t
  cross join lateral (
    select coalesce(sum(round(i.qty * i.unit_price) - public.giam_tien(round(i.qty * i.unit_price), i.giam_kieu, i.giam_gia_tri)), 0) as goc,
           coalesce(sum(round(i.qty * i.unit_price) - public.giam_tien(round(i.qty * i.unit_price), i.giam_kieu, i.giam_gia_tri))
                    filter (where i.kind = 'labor'), 0) as cong_goc,
           -- giá vốn: đúng công thức của bao_cao_phieu (giai đoạn 31)
           coalesce(sum(case when i.kind = 'part' then i.qty * coalesce(ic.cost_price, 0) else 0 end), 0) as von,
           (count(*) filter (where i.kind = 'part' and coalesce(ic.cost_price, 0) = 0))::int as thieu
    from public.repair_items i left join public.repair_item_costs ic on ic.item_id = i.id
    where i.order_id = o.id) l
  cross join lateral (select case when l.goc > 0 then round(t.doanh_thu * l.cong_goc / l.goc) else 0 end as cong) c
  cross join lateral (
    select coalesce(sum(r.amount), 0) as tat_ca from public.repair_costs r where r.order_id = o.id and not r.da_huy) cp
  where o.id = p_order
$$;
revoke execute on function public.tach_phieu_noi_bo(uuid) from public, anon, authenticated;

-- Bản cho ứng dụng: chỉ Chủ xưởng
create or replace function public.tach_phieu(p_order uuid)
returns table (doanh_thu numeric, dt_cong numeric, dt_pt numeric, gia_von_pt numeric, ln_pt numeric,
               chi_phi_phieu numeric, phan_cong numeric, pt_thieu_gia int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem tách doanh thu'; end if;
  return query select * from public.tach_phieu_noi_bo(p_order);
end $$;
revoke execute on function public.tach_phieu(uuid) from public, anon;
grant execute on function public.tach_phieu(uuid) to authenticated;

-- 2. Báo cáo tách theo ngày / tháng (cùng điều kiện với bao_cao_phieu: phiếu đã hoàn thành, chưa hủy, theo paid_at) ----
create or replace function public.bao_cao_tach_noi_bo(p_tu date, p_den date, p_nhom text)
returns table (ky date, so_phieu bigint, doanh_thu numeric, dt_cong numeric, dt_pt numeric, gia_von_pt numeric, ln_pt numeric,
               chi_phi_phieu numeric, phan_cong numeric, pt_thieu_gia bigint)
language sql stable as $$
  select case when p_nhom = 'thang' then date_trunc('month', o.paid_at)::date else o.paid_at end,
         count(*)::bigint, sum(x.doanh_thu), sum(x.dt_cong), sum(x.dt_pt), sum(x.gia_von_pt), sum(x.ln_pt),
         sum(x.chi_phi_phieu), sum(x.phan_cong), sum(x.pt_thieu_gia)::bigint
  from public.repair_orders o
  cross join lateral public.tach_phieu_noi_bo(o.id) x
  where o.stock_deducted and not o.da_huy and o.paid_at >= p_tu and o.paid_at <= p_den
  group by 1
  order by 1
$$;
revoke execute on function public.bao_cao_tach_noi_bo(date, date, text) from public, anon, authenticated;

create or replace function public.bao_cao_tach(p_tu date, p_den date, p_nhom text)
returns table (ky date, so_phieu bigint, doanh_thu numeric, dt_cong numeric, dt_pt numeric, gia_von_pt numeric, ln_pt numeric,
               chi_phi_phieu numeric, phan_cong numeric, pt_thieu_gia bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem báo cáo doanh thu'; end if;
  return query select * from public.bao_cao_tach_noi_bo(p_tu, p_den, p_nhom);
end $$;
revoke execute on function public.bao_cao_tach(date, date, text) from public, anon;
grant execute on function public.bao_cao_tach(date, date, text) to authenticated;

-- 3. Nhóm chia tiền cho loại phiếu thu / chi --------------------------------------------------------------------
alter table public.loai_phieu_chi add column if not exists nhom_chia text;
alter table public.loai_phieu_thu add column if not exists nhom_chia text;

insert into public.loai_phieu_chi (ten, tinh_vao_lai_lo, thu_tu, ghi_chu, dong_tien, lien_ket, nhom_chia) values
  ('Chia tiền tháng', false, 11, 'Trả tiền chia cuối tháng cho mọi người: KHÔNG tính vào lãi lỗ, KHÔNG trừ lại khi chia tháng sau', 'hoat_dong', null, 'khong')
on conflict (ten) do nothing;

-- Gán nhóm cho loại CHƯA có nhóm (chạy lại không đổi lựa chọn Chủ đã đặt)
update public.loai_phieu_chi set nhom_chia = case when tinh_vao_lai_lo and dong_tien = 'hoat_dong' then 'cong' else 'khong' end
  where nhom_chia is null;
update public.loai_phieu_thu set nhom_chia = case when tinh_vao_lai_lo and dong_tien = 'hoat_dong' then 'cong' else 'khong' end
  where nhom_chia is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loai_phieu_chi_nhom_chia_hop_le') then
    alter table public.loai_phieu_chi add constraint loai_phieu_chi_nhom_chia_hop_le check (nhom_chia is null or nhom_chia in ('cong', 'phu_tung', 'khong'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loai_phieu_thu_nhom_chia_hop_le') then
    alter table public.loai_phieu_thu add constraint loai_phieu_thu_nhom_chia_hop_le check (nhom_chia is null or nhom_chia in ('cong', 'phu_tung', 'khong'));
  end if;
end $$;

-- Chủ đổi nhóm của một loại (có nhật ký)
create or replace function public.loai_nhom_chia_dat(p_bang text, p_ten text, p_nhom text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cu text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đổi nhóm chia tiền'; end if;
  if p_nhom not in ('cong', 'phu_tung', 'khong') then raise exception 'Nhóm không hợp lệ'; end if;
  if p_bang = 'chi' then
    select nhom_chia into v_cu from public.loai_phieu_chi where ten = p_ten for update;
    if not found then raise exception 'Không tìm thấy loại chi "%"', p_ten; end if;
    update public.loai_phieu_chi set nhom_chia = p_nhom where ten = p_ten;
  elsif p_bang = 'thu' then
    select nhom_chia into v_cu from public.loai_phieu_thu where ten = p_ten for update;
    if not found then raise exception 'Không tìm thấy loại thu "%"', p_ten; end if;
    update public.loai_phieu_thu set nhom_chia = p_nhom where ten = p_ten;
  else
    raise exception 'Bảng không hợp lệ';
  end if;
  perform public.ghi_nhat_ky('doi_nhom_chia', 'Chia tiền', null, p_ten, null,
    case when p_bang = 'chi' then 'loai_phieu_chi' else 'loai_phieu_thu' end, null,
    jsonb_build_object('nhom_chia', v_cu), jsonb_build_object('nhom_chia', p_nhom), null);
end $$;
revoke execute on function public.loai_nhom_chia_dat(text, text, text) from public, anon;
grant execute on function public.loai_nhom_chia_dat(text, text, text) to authenticated;

-- 4. Thu / chi trong sổ quỹ theo nhóm chia (chỉ đọc) ------------------------------------------------------------
-- Bỏ qua: khoản thu của phiếu sửa chữa (doanh thu đã tính qua phiếu), dòng chi của "Chi phí phiếu" (đã trừ qua phiếu),
-- chuyển quỹ, kiểm quỹ. Dòng đảo / phân loại lại tự triệt tiêu theo loại gốc (cộng số có dấu).
-- so_tien trả về: số DƯƠNG = tiền chi ra (với chi) hoặc tiền thu vào (với thu).
create or replace function public.chia_thu_chi_noi_bo(p_tu date, p_den date)
returns table (loai text, danh_muc text, nhom_chia text, so_tien numeric)
language sql stable as $$
  select x.loai_goc,
         case when x.loai_goc = 'chi' then coalesce(lc.ten, 'Chi khác') else coalesce(lt.ten, 'Thu khác') end,
         case when x.loai_goc = 'chi' then coalesce(lc.nhom_chia, lc2.nhom_chia, 'cong') else coalesce(lt.nhom_chia, 'khong') end,
         case when x.loai_goc = 'chi' then -sum(s.so_tien) else sum(s.so_tien) end
  from public.so_quy s
  left join public.so_quy o on o.id = s.dao_cua
  cross join lateral (select coalesce(o.loai, s.loai) as loai_goc,
                             coalesce(o.danh_muc, s.danh_muc) as dm,
                             coalesce(o.payment_id, s.payment_id) as pid,
                             coalesce(o.chi_phi_id, s.chi_phi_id) as cpid,
                             coalesce(o.da_tinh_qua_chi_phi, s.da_tinh_qua_chi_phi, false) as qcp) x
  left join public.loai_phieu_chi lc on x.loai_goc = 'chi' and lc.ten = x.dm
  left join public.loai_phieu_chi lc2 on x.loai_goc = 'chi' and lc.ten is null and lc2.ten = 'Chi khác'
  left join public.loai_phieu_thu lt on x.loai_goc = 'thu' and lt.ten = x.dm
  where s.ngay >= p_tu and s.ngay <= p_den
    and x.loai_goc in ('thu', 'chi')
    and x.pid is null
    and x.cpid is null and not x.qcp
  group by 1, 2, 3
  having sum(s.so_tien) <> 0
$$;
revoke execute on function public.chia_thu_chi_noi_bo(date, date) from public, anon, authenticated;

-- 5. Bảng kỳ chia tiền, người nhận, sổ dự phòng ---------------------------------------------------------------
create table if not exists public.chia_tien_ky (
  id uuid primary key default gen_random_uuid(),
  nam int not null check (nam between 2000 and 2100),
  thang int not null check (thang between 1 and 12),
  tu date not null,
  den date not null,
  so_phieu int not null default 0,
  doanh_thu numeric not null default 0,
  dt_cong numeric not null default 0,
  chi_phi_phieu numeric not null default 0,
  chi_xuong numeric not null default 0,       -- chi nhóm 'cong' trong sổ quỹ (chi phí nuôi xưởng)
  thu_cong numeric not null default 0,        -- thu nhóm 'cong' trong sổ quỹ
  khoan_khac numeric not null default 0,      -- chủ cộng (+) / trừ (-) thêm, bắt buộc ghi chú
  khoan_khac_ghi_chu text,
  phan_cong numeric not null default 0,
  du_phong_pt numeric(5,2) not null default 0 check (du_phong_pt >= 0 and du_phong_pt <= 100),
  du_phong numeric not null default 0,
  phan_chia numeric not null default 0,
  dt_pt numeric not null default 0,
  gia_von_pt numeric not null default 0,
  chi_pt numeric not null default 0,
  thu_pt numeric not null default 0,
  ln_pt_chu numeric not null default 0,
  chi_tiet jsonb,
  ghi_chu text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  da_huy boolean not null default false,
  huy_ly_do text,
  huy_boi uuid,
  huy_boi_ten text,
  huy_luc timestamptz
);
create unique index if not exists chia_tien_ky_thang_uq on public.chia_tien_ky (nam, thang) where not da_huy;

create table if not exists public.chia_tien_nguoi (
  id uuid primary key default gen_random_uuid(),
  ky_id uuid not null references public.chia_tien_ky(id),
  thu_tu int not null,
  ten text not null check (btrim(ten) <> ''),
  phan_tram numeric(6,2) not null check (phan_tram >= 0 and phan_tram <= 100),
  so_tien numeric(18,0) not null
);
create index if not exists chia_tien_nguoi_ky_idx on public.chia_tien_nguoi (ky_id);

create table if not exists public.du_phong_so (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  ngay date not null default public.ngay_hom_nay(),
  loai text not null check (loai in ('trich', 'dung', 'dao')),
  so_tien numeric(18,0) not null check (so_tien <> 0),   -- dương = vào dự phòng, âm = dùng
  ky_id uuid references public.chia_tien_ky(id),
  so_phieu_chi text,                                      -- mã phiếu chi trong Sổ quỹ (nếu có), vd CHI0012
  ly_do text,
  dao_cua uuid references public.du_phong_so(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  check (loai <> 'dung' or (so_tien < 0 and btrim(coalesce(ly_do, '')) <> '')),
  check (loai <> 'dao' or (dao_cua is not null and btrim(coalesce(ly_do, '')) <> ''))
);
create unique index if not exists du_phong_dao_uq on public.du_phong_so (dao_cua) where dao_cua is not null;

-- Chỉ thêm dòng: chặn sửa / xóa / truncate (hủy kỳ đi qua hàm có cờ app.chia_tien)
create or replace function public.chia_tien_chan_sua_xoa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'chia_tien_ky' and coalesce(current_setting('app.chia_tien', true), '') = '1'
     and (to_jsonb(new) - array['da_huy', 'huy_ly_do', 'huy_boi', 'huy_boi_ten', 'huy_luc'])
         = (to_jsonb(old) - array['da_huy', 'huy_ly_do', 'huy_boi', 'huy_boi_ten', 'huy_luc']) then
    return new;
  end if;
  if tg_op = 'TRUNCATE' then raise exception 'Không được xóa sạch bảng %', tg_table_name; end if;
  raise exception 'Dữ liệu chia tiền / dự phòng chỉ được thêm, không sửa hoặc xóa. Muốn bỏ: bấm "Hủy" (lý do bắt buộc)';
end $$;
revoke execute on function public.chia_tien_chan_sua_xoa() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['chia_tien_ky', 'chia_tien_nguoi', 'du_phong_so'] loop
    execute format('drop trigger if exists chan_sua_xoa on public.%I', t);
    execute format('drop trigger if exists chan_truncate on public.%I', t);
    execute format('create trigger chan_sua_xoa before update or delete on public.%I for each row execute function public.chia_tien_chan_sua_xoa()', t);
    execute format('create trigger chan_truncate before truncate on public.%I for each statement execute function public.chia_tien_chan_sua_xoa()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists vt_chi_chu_xem on public.%I', t);
    execute format('create policy vt_chi_chu_xem on public.%I for select to authenticated using (public.la_chu())', t);
  end loop;
  foreach t in array array['chia_tien_ky', 'du_phong_so'] loop
    execute format('drop trigger if exists ep_nguoi_thuc_hien on public.%I', t);
    execute format('create trigger ep_nguoi_thuc_hien before insert on public.%I for each row execute function public.ep_nguoi_thuc_hien()', t);
  end loop;
end $$;

-- 6. Tính số liệu một tháng (nội bộ) -----------------------------------------------------------------------------
create or replace function public.chia_tien_tinh_noi_bo(p_nam int, p_thang int)
returns jsonb language plpgsql stable as $$
declare v_tu date; v_den date; b record; v_ct jsonb; v_thieu jsonb;
  v_chi_xuong numeric; v_thu_cong numeric; v_chi_pt numeric; v_thu_pt numeric;
begin
  if p_nam is null or p_thang is null or p_nam < 2000 or p_nam > 2100 or p_thang < 1 or p_thang > 12 then
    raise exception 'Tháng hoặc năm không hợp lệ';
  end if;
  v_tu := make_date(p_nam, p_thang, 1);
  v_den := (v_tu + interval '1 month' - interval '1 day')::date;

  select coalesce(sum(x.so_phieu), 0) as so_phieu, coalesce(sum(x.doanh_thu), 0) as doanh_thu, coalesce(sum(x.dt_cong), 0) as dt_cong,
         coalesce(sum(x.dt_pt), 0) as dt_pt, coalesce(sum(x.gia_von_pt), 0) as gia_von_pt, coalesce(sum(x.chi_phi_phieu), 0) as chi_phi_phieu
    into b from public.bao_cao_tach_noi_bo(v_tu, v_den, 'thang') x;

  select coalesce(jsonb_agg(jsonb_build_object('loai', c.loai, 'danh_muc', c.danh_muc, 'nhom_chia', c.nhom_chia, 'so_tien', c.so_tien)
                            order by c.loai, c.nhom_chia, c.danh_muc), '[]'::jsonb),
         coalesce(sum(c.so_tien) filter (where c.loai = 'chi' and c.nhom_chia = 'cong'), 0),
         coalesce(sum(c.so_tien) filter (where c.loai = 'thu' and c.nhom_chia = 'cong'), 0),
         coalesce(sum(c.so_tien) filter (where c.loai = 'chi' and c.nhom_chia = 'phu_tung'), 0),
         coalesce(sum(c.so_tien) filter (where c.loai = 'thu' and c.nhom_chia = 'phu_tung'), 0)
    into v_ct, v_chi_xuong, v_thu_cong, v_chi_pt, v_thu_pt
    from public.chia_thu_chi_noi_bo(v_tu, v_den) c;

  -- Phiếu có dòng phụ tùng chưa có giá nhập (giá vốn = 0 -> lợi nhuận phụ tùng bị tính cao)
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'ma_phieu', o.code, 'so_dong', x.pt_thieu_gia) order by o.code), '[]'::jsonb)
    into v_thieu
    from public.repair_orders o cross join lateral public.tach_phieu_noi_bo(o.id) x
    where o.stock_deducted and not o.da_huy and o.paid_at >= v_tu and o.paid_at <= v_den and x.pt_thieu_gia > 0;

  return jsonb_build_object(
    'nam', p_nam, 'thang', p_thang, 'tu', v_tu, 'den', v_den,
    'so_phieu', b.so_phieu, 'doanh_thu', b.doanh_thu, 'dt_cong', b.dt_cong, 'chi_phi_phieu', b.chi_phi_phieu,
    'chi_xuong', v_chi_xuong, 'thu_cong', v_thu_cong,
    'dt_pt', b.dt_pt, 'gia_von_pt', b.gia_von_pt, 'chi_pt', v_chi_pt, 'thu_pt', v_thu_pt,
    'chi_tiet', v_ct, 'pt_thieu_gia', v_thieu);
end $$;
revoke execute on function public.chia_tien_tinh_noi_bo(int, int) from public, anon, authenticated;

create or replace function public.du_phong_so_du_noi_bo() returns numeric
language sql stable as $$ select coalesce(sum(so_tien), 0) from public.du_phong_so $$;
revoke execute on function public.du_phong_so_du_noi_bo() from public, anon, authenticated;

-- 7. Hàm cho ứng dụng (chỉ Chủ) ------------------------------------------------------------------------------------
-- 7a. Xem trước một tháng: số liệu + kỳ đã chốt (nếu có) + số dư dự phòng
create or replace function public.chia_tien_xem_truoc(p_nam int, p_thang int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; k record;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem chia tiền'; end if;
  v := public.chia_tien_tinh_noi_bo(p_nam, p_thang);
  select * into k from public.chia_tien_ky where nam = p_nam and thang = p_thang and not da_huy;
  return v || jsonb_build_object(
    'ky_da_chot', case when k.id is null then null else to_jsonb(k) end,
    'nguoi_da_chot', (select coalesce(jsonb_agg(to_jsonb(n) order by n.thu_tu), '[]'::jsonb) from public.chia_tien_nguoi n where n.ky_id = k.id),
    'du_phong_so_du', public.du_phong_so_du_noi_bo(),
    'hom_nay', public.ngay_hom_nay());
end $$;
revoke execute on function public.chia_tien_xem_truoc(int, int) from public, anon;
grant execute on function public.chia_tien_xem_truoc(int, int) to authenticated;

-- 7b. Chốt kỳ: máy chủ TỰ TÍNH LẠI mọi con số (không tin số từ giao diện)
-- p_nguoi: [{"ten":"Anh A","phan_tram":40}, ...] tổng phải đúng 100
create or replace function public.chia_tien_chot(p_nam int, p_thang int, p_du_phong_pt numeric, p_khoan_khac numeric,
                                                 p_khoan_khac_ghi_chu text, p_nguoi jsonb, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v jsonb; v_id uuid; v_phan_cong numeric; v_du numeric; v_chia numeric; v_ln_pt numeric;
  v_kk numeric := coalesce(p_khoan_khac, 0); v_kk_gc text := nullif(btrim(coalesce(p_khoan_khac_ghi_chu, '')), '');
  v_tong_pt numeric; v_n int; v_da numeric := 0; r record; v_tien numeric; v_i int := 0;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được chốt chia tiền'; end if;
  if p_du_phong_pt is null or p_du_phong_pt < 0 or p_du_phong_pt > 100 then raise exception 'Phần trăm dự phòng phải từ 0 đến 100'; end if;
  if v_kk <> round(v_kk) then raise exception 'Khoản cộng/trừ khác phải là số nguyên'; end if;
  if v_kk <> 0 and v_kk_gc is null then raise exception 'Có khoản cộng/trừ khác thì phải ghi chú lý do'; end if;
  if char_length(coalesce(v_kk_gc, '')) > 500 or char_length(coalesce(p_ghi_chu, '')) > 500 then raise exception 'Ghi chú quá dài'; end if;
  if jsonb_typeof(p_nguoi) is distinct from 'array' or jsonb_array_length(p_nguoi) = 0 then raise exception 'Hãy nhập ít nhất một người nhận'; end if;
  if jsonb_array_length(p_nguoi) > 30 then raise exception 'Tối đa 30 người'; end if;
  select count(*), coalesce(sum((e->>'phan_tram')::numeric), 0) into v_n, v_tong_pt from jsonb_array_elements(p_nguoi) e;
  if exists (select 1 from jsonb_array_elements(p_nguoi) e
             where btrim(coalesce(e->>'ten', '')) = '' or (e->>'phan_tram') is null
                or (e->>'phan_tram')::numeric < 0 or (e->>'phan_tram')::numeric > 100) then
    raise exception 'Mỗi người phải có tên và phần trăm từ 0 đến 100';
  end if;
  if abs(v_tong_pt - 100) > 0.001 then raise exception 'Tổng phần trăm chia phải đúng 100 (đang là %)', v_tong_pt; end if;
  if make_date(p_nam, p_thang, 1) > public.ngay_hom_nay() then raise exception 'Không chốt được tháng chưa tới'; end if;

  perform pg_advisory_xact_lock(hashtext('chia_tien_' || p_nam || '_' || p_thang));
  if exists (select 1 from public.chia_tien_ky where nam = p_nam and thang = p_thang and not da_huy) then
    raise exception 'Tháng %/% đã chốt rồi. Muốn chốt lại: hủy kỳ cũ (lý do bắt buộc) trước', p_thang, p_nam;
  end if;

  v := public.chia_tien_tinh_noi_bo(p_nam, p_thang);
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
  values (p_nam, p_thang, (v->>'tu')::date, (v->>'den')::date, (v->>'so_phieu')::int, (v->>'doanh_thu')::numeric, (v->>'dt_cong')::numeric,
      (v->>'chi_phi_phieu')::numeric, (v->>'chi_xuong')::numeric, (v->>'thu_cong')::numeric, v_kk, v_kk_gc, v_phan_cong,
      p_du_phong_pt, v_du, v_chia, (v->>'dt_pt')::numeric, (v->>'gia_von_pt')::numeric, (v->>'chi_pt')::numeric, (v->>'thu_pt')::numeric,
      v_ln_pt, v->'chi_tiet', nullif(btrim(coalesce(p_ghi_chu, '')), ''))
  returning id into v_id;

  -- Chia theo %: làm tròn đồng, người cuối nhận phần lẻ để tổng đúng bằng phần chia
  for r in select btrim(e->>'ten') as ten, (e->>'phan_tram')::numeric as pt, ord from jsonb_array_elements(p_nguoi) with ordinality as x(e, ord) order by ord loop
    v_i := v_i + 1;
    v_tien := case when v_i = v_n then v_chia - v_da else round(v_chia * r.pt / 100) end;
    v_da := v_da + v_tien;
    insert into public.chia_tien_nguoi (ky_id, thu_tu, ten, phan_tram, so_tien) values (v_id, v_i, r.ten, r.pt, v_tien);
  end loop;

  if v_du > 0 then
    insert into public.du_phong_so (ngay, loai, so_tien, ky_id, ly_do)
      values (least((v->>'den')::date, public.ngay_hom_nay()), 'trich', v_du, v_id, 'Trích dự phòng tháng ' || p_thang || '/' || p_nam);
  end if;

  perform public.ghi_nhat_ky('chot_chia_tien', 'Chia tiền', 'T' || p_thang || '/' || p_nam, null, null, 'chia_tien_ky', v_id, null,
    jsonb_build_object('phan_cong', v_phan_cong, 'du_phong_pt', p_du_phong_pt, 'du_phong', v_du, 'phan_chia', v_chia,
                       'ln_phu_tung_chu', v_ln_pt, 'khoan_khac', v_kk, 'nguoi', p_nguoi), v_kk_gc);
  return v_id;
end $$;
revoke execute on function public.chia_tien_chot(int, int, numeric, numeric, text, jsonb, text) from public, anon;
grant execute on function public.chia_tien_chot(int, int, numeric, numeric, text, jsonb, text) to authenticated;

-- 7c. Hủy kỳ đã chốt: đánh dấu hủy + đảo phần trích dự phòng
create or replace function public.chia_tien_huy(p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare k record; d record; v_ly text := nullif(btrim(coalesce(p_ly_do, '')), '');
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy kỳ chia tiền'; end if;
  if v_ly is null then raise exception 'Hãy nhập lý do hủy'; end if;
  select * into k from public.chia_tien_ky where id = p_id for update;
  if not found then raise exception 'Không tìm thấy kỳ chia tiền'; end if;
  if k.da_huy then raise exception 'Kỳ này đã hủy rồi'; end if;
  perform set_config('app.chia_tien', '1', true);
  update public.chia_tien_ky set da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(),
    huy_boi_ten = public.ten_nguoi_dung(auth.uid()), huy_luc = now() where id = p_id;
  perform set_config('app.chia_tien', '', true);
  for d in select * from public.du_phong_so s where s.ky_id = p_id and s.loai = 'trich'
             and not exists (select 1 from public.du_phong_so r where r.dao_cua = s.id) loop
    insert into public.du_phong_so (loai, so_tien, ky_id, ly_do, dao_cua)
      values ('dao', -d.so_tien, p_id, 'Hủy kỳ T' || k.thang || '/' || k.nam || ': ' || v_ly, d.id);
  end loop;
  perform public.ghi_nhat_ky('huy_chia_tien', 'Chia tiền', 'T' || k.thang || '/' || k.nam, null, null, 'chia_tien_ky', p_id,
    jsonb_build_object('phan_chia', k.phan_chia, 'du_phong', k.du_phong), null, v_ly);
end $$;
revoke execute on function public.chia_tien_huy(uuid, text) from public, anon;
grant execute on function public.chia_tien_huy(uuid, text) to authenticated;

-- 7d. Dùng quỹ dự phòng (không vượt số dư)
create or replace function public.du_phong_dung(p_so_tien numeric, p_ngay date, p_ly_do text, p_so_phieu_chi text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ly text := nullif(btrim(coalesce(p_ly_do, '')), ''); v_sp text := nullif(upper(btrim(coalesce(p_so_phieu_chi, ''))), '');
  v_du numeric;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được dùng quỹ dự phòng'; end if;
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if v_ly is null then raise exception 'Hãy nhập lý do dùng quỹ dự phòng'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài'; end if;
  if p_ngay is not null and p_ngay > public.ngay_hom_nay() then raise exception 'Ngày dùng không được sau hôm nay'; end if;
  if v_sp is not null and not exists (select 1 from public.so_quy where so_phieu = v_sp and loai = 'chi') then
    raise exception 'Không tìm thấy phiếu chi % trong Sổ quỹ', v_sp;
  end if;
  perform pg_advisory_xact_lock(hashtext('du_phong_so'));
  v_du := public.du_phong_so_du_noi_bo();
  if p_so_tien > v_du then raise exception 'Quỹ dự phòng chỉ còn % đ, không đủ dùng % đ', round(v_du), round(p_so_tien); end if;
  insert into public.du_phong_so (ngay, loai, so_tien, so_phieu_chi, ly_do)
    values (coalesce(p_ngay, public.ngay_hom_nay()), 'dung', -p_so_tien, v_sp, v_ly)
    returning id into v_id;
  perform public.ghi_nhat_ky('dung_du_phong', 'Quỹ dự phòng', v_sp, null, null, 'du_phong_so', v_id, null,
    jsonb_build_object('so_tien', p_so_tien, 'ngay', coalesce(p_ngay, public.ngay_hom_nay())), v_ly);
  return v_id;
end $$;
revoke execute on function public.du_phong_dung(numeric, date, text, text) from public, anon;
grant execute on function public.du_phong_dung(numeric, date, text, text) to authenticated;

-- 7e. Hủy một lần dùng dự phòng (thêm dòng đảo)
create or replace function public.du_phong_huy(p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare d record; v_ly text := nullif(btrim(coalesce(p_ly_do, '')), '');
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy'; end if;
  if v_ly is null then raise exception 'Hãy nhập lý do hủy'; end if;
  select * into d from public.du_phong_so where id = p_id;
  if not found then raise exception 'Không tìm thấy dòng'; end if;
  if d.loai <> 'dung' then raise exception 'Chỉ hủy được lần "Dùng". Phần trích tự đảo khi hủy kỳ chia tiền'; end if;
  if exists (select 1 from public.du_phong_so where dao_cua = p_id) then raise exception 'Dòng này đã hủy rồi'; end if;
  insert into public.du_phong_so (loai, so_tien, ly_do, dao_cua) values ('dao', -d.so_tien, v_ly, p_id);
  perform public.ghi_nhat_ky('huy_dung_du_phong', 'Quỹ dự phòng', d.so_phieu_chi, null, null, 'du_phong_so', p_id,
    jsonb_build_object('so_tien', -d.so_tien), null, v_ly);
end $$;
revoke execute on function public.du_phong_huy(uuid, text) from public, anon;
grant execute on function public.du_phong_huy(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- 8. KIỂM TRA TỰ ĐỘNG (lệch -> báo lỗi, Supabase hủy toàn bộ file) ---------------------------------------------------
do $$
declare v_lech text; v_sai int;
begin
  -- 8a. Dữ liệu cũ y hệt trước khi chạy
  select string_agg(t.k || ' (trước ' || t.v || ', sau ' || coalesce(s.v::text, 'không có') || ')', '; ') into v_lech
  from pg_temp.gd33_truoc t
  left join (
    select 'quy:' || c.quy as k, public.quy_so_du_noi_bo(c.quy) as v from public.quy_cai_dat c
    union all select 'dong_so_quy', count(*)::numeric from public.so_quy
    union all select 'tong_so_quy', coalesce(sum(so_tien), 0) from public.so_quy
    union all select 'dong_phieu', count(*)::numeric from public.repair_orders
    union all select 'dong_bao_gia', count(*)::numeric from public.repair_items
    union all select 'tong_bao_gia', coalesce(sum(qty * unit_price), 0) from public.repair_items
    union all select 'gia_von_chot', coalesce(sum(cost_price), 0) from public.repair_item_costs
    union all select 'dong_khoan_thu', count(*)::numeric from public.order_payments
    union all select 'tong_khoan_thu', coalesce(sum(so_tien), 0) from public.order_payments
    union all select 'dong_chi_phi', count(*)::numeric from public.repair_costs
    union all select 'tong_chi_phi', coalesce(sum(amount), 0) from public.repair_costs
    union all select 'dong_so_kho', count(*)::numeric from public.stock_ledger
    union all select 'tong_ton_kho', coalesce(sum(stock), 0) from public.parts
  ) s on s.k = t.k
  where s.v is distinct from t.v;
  if v_lech is not null then raise exception 'DỪNG: số liệu cũ bị thay đổi: %', v_lech; end if;

  -- 8b. Mọi phiếu: công + phụ tùng = doanh thu; công, phụ tùng không âm; giá vốn khớp cách tính của bao_cao_phieu
  select count(*) into v_sai
  from public.repair_orders o
  cross join lateral public.tinh_tong_phieu_noi_bo(o.id) t
  cross join lateral public.tach_phieu_noi_bo(o.id) x
  cross join lateral (
    select coalesce(sum(case when i.kind = 'part' then i.qty * coalesce(c.cost_price, 0) else 0 end), 0) as von
    from public.repair_items i left join public.repair_item_costs c on c.item_id = i.id where i.order_id = o.id) w
  where x.dt_cong + x.dt_pt <> t.doanh_thu or x.dt_cong < 0 or x.dt_pt < 0 or x.gia_von_pt <> w.von;
  if v_sai > 0 then raise exception 'DỪNG: % phiếu tách công / phụ tùng không khớp doanh thu', v_sai; end if;
end $$;

-- Kết quả xem sau khi Run: doanh thu từng tháng = công + phụ tùng (cột lech phải bằng 0 ở mọi dòng)
select to_char(x.ky, 'MM/YYYY') as thang, x.so_phieu, x.doanh_thu, x.dt_cong as doanh_thu_cong, x.dt_pt as doanh_thu_phu_tung,
       x.gia_von_pt as gia_von_phu_tung, x.ln_pt as loi_nhuan_phu_tung, x.chi_phi_phieu, x.pt_thieu_gia as so_dong_pt_chua_co_gia_nhap,
       x.doanh_thu - x.dt_cong - x.dt_pt as lech
from public.bao_cao_tach_noi_bo('2000-01-01', '2100-12-31', 'thang') x
order by x.ky desc;
