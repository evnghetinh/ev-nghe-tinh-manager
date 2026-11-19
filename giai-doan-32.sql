-- GIAI ĐOẠN 32: Sổ quỹ tách "Dòng tiền hoạt động" và "Đầu tư và tài chính" + Phân loại lại + Liên kết với mục Vốn
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn. Cần đã chạy giai-doan-20, 21, 26, 30.
-- KHÔNG đổi số dư các quỹ, KHÔNG đổi cách tính doanh thu, lợi nhuận, tồn kho. Chỉ Chủ xưởng dùng được.
--
-- ===== NỘI DUNG =====
--  1. Loại thu mới (bảng loai_phieu_thu): "Vốn góp", "Thu tài chính khác".
--     Loại chi mới (bảng loai_phieu_chi): "Đầu tư mở xưởng", "Rút vốn hoặc chia lợi nhuận".
--     Mỗi loại có cờ dong_tien = 'dau_tu_tai_chinh' (đầu tư và tài chính) hoặc 'hoat_dong' (hoạt động)
--     và cờ tinh_vao_lai_lo = false (không tính vào lãi lỗ) cho 4 loại mới.
--  2. Tổng quát theo tháng và bảng 12 tháng tách hai khối. Tổng thu, tổng chi, số dư cuối tháng GIỮ NGUYÊN.
--  3. "Phân loại lại": chọn dòng thu/chi đã ghi -> hệ thống ghi dòng ĐẢO + dòng MỚI đúng loại (cùng ngày, cùng quỹ,
--     cùng số tiền, nên số dư mọi quỹ ở mọi thời điểm không đổi). Dòng cũ không sửa. Lý do bắt buộc. Có xem trước.
--  4. Liên kết với mục Vốn bằng bảng von_lien_ket_quy (chỉ thêm dòng):
--     phiếu thu "Vốn góp" <-> khoản trong "Vốn góp"; phiếu chi "Đầu tư mở xưởng" <-> khoản trong "Chi phí mở xưởng".
--     Phát hiện nhập trùng (cùng ngày, cùng số tiền, gợi ý cùng tên). KHÔNG tự gộp: Chủ xác nhận từng cặp.
--     Hủy một bên đã liên kết thì hủy cả hai (có lý do). Khoản đã liên kết không sửa số tiền / ngày / tên được.

-- 1. Loại thu / chi -----------------------------------------------------------------------------------------
alter table public.loai_phieu_chi add column if not exists dong_tien text not null default 'hoat_dong';
alter table public.loai_phieu_chi add column if not exists lien_ket text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loai_phieu_chi_dong_tien_hop_le') then
    alter table public.loai_phieu_chi add constraint loai_phieu_chi_dong_tien_hop_le check (dong_tien in ('hoat_dong', 'dau_tu_tai_chinh'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loai_phieu_chi_lien_ket_hop_le') then
    alter table public.loai_phieu_chi add constraint loai_phieu_chi_lien_ket_hop_le check (lien_ket is null or lien_ket in ('gop', 'mo_xuong'));
  end if;
end $$;

create table if not exists public.loai_phieu_thu (
  ten text primary key,
  tinh_vao_lai_lo boolean not null,
  dong_tien text not null check (dong_tien in ('hoat_dong', 'dau_tu_tai_chinh')),
  lien_ket text check (lien_ket is null or lien_ket in ('gop', 'mo_xuong')),
  thu_tu int not null,
  ghi_chu text
);

insert into public.loai_phieu_thu (ten, tinh_vao_lai_lo, dong_tien, lien_ket, thu_tu, ghi_chu) values
  ('Vốn góp',            false, 'dau_tu_tai_chinh', 'gop', 1, 'Tiền người góp vốn đưa vào quỹ: KHÔNG tính vào lãi lỗ. Tự gắn với mục Vốn góp'),
  ('Thu tài chính khác', false, 'dau_tu_tai_chinh', null,  2, 'Khoản thu tài chính khác (vay, nhận hỗ trợ...): KHÔNG tính vào lãi lỗ')
on conflict (ten) do nothing;

insert into public.loai_phieu_chi (ten, tinh_vao_lai_lo, thu_tu, ghi_chu, dong_tien, lien_ket) values
  ('Đầu tư mở xưởng',             false, 9,  'Thiết bị, sửa chữa mặt bằng, đặt cọc: KHÔNG tính vào lãi lỗ. Tự gắn với Chi phí mở xưởng', 'dau_tu_tai_chinh', 'mo_xuong'),
  ('Rút vốn hoặc chia lợi nhuận', false, 10, 'Chủ rút vốn hoặc chia lợi nhuận cho người góp: KHÔNG tính vào lãi lỗ',                      'dau_tu_tai_chinh', null)
on conflict (ten) do nothing;

alter table public.loai_phieu_thu enable row level security;
revoke all on public.loai_phieu_thu from anon, authenticated;
grant select on public.loai_phieu_thu to authenticated;
drop policy if exists lpt_chi_chu_xem on public.loai_phieu_thu;
create policy lpt_chi_chu_xem on public.loai_phieu_thu for select to authenticated using (public.la_chu());

-- 2. Bảng liên kết Sổ quỹ <-> Vốn (chỉ thêm dòng) -------------------------------------------------------------
create table if not exists public.von_lien_ket_quy (
  id uuid primary key default gen_random_uuid(),
  kieu text not null check (kieu in ('gop', 'mo_xuong')),   -- gop = von_gop ; mo_xuong = von_chi_phi_mo_xuong
  von_id uuid not null,
  so_quy_id uuid not null references public.so_quy(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text
);
create unique index if not exists von_lien_ket_von_uq on public.von_lien_ket_quy (kieu, von_id);
create unique index if not exists von_lien_ket_quy_uq on public.von_lien_ket_quy (so_quy_id);

create or replace function public.von_lien_ket_chan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Liên kết sổ quỹ - vốn chỉ được thêm, không sửa hoặc xóa. Muốn bỏ: hủy giao dịch (lý do bắt buộc)';
end $$;
revoke execute on function public.von_lien_ket_chan() from public, anon, authenticated;
drop trigger if exists chan_sua_xoa on public.von_lien_ket_quy;
create trigger chan_sua_xoa before update or delete on public.von_lien_ket_quy for each row execute function public.von_lien_ket_chan();
drop trigger if exists chan_truncate on public.von_lien_ket_quy;
create trigger chan_truncate before truncate on public.von_lien_ket_quy for each statement execute function public.von_lien_ket_chan();
drop trigger if exists ep_nguoi_thuc_hien on public.von_lien_ket_quy;
create trigger ep_nguoi_thuc_hien before insert on public.von_lien_ket_quy for each row execute function public.ep_nguoi_thuc_hien();

alter table public.von_lien_ket_quy enable row level security;
revoke all on public.von_lien_ket_quy from anon, authenticated;
grant select on public.von_lien_ket_quy to authenticated;
drop policy if exists vlk_chi_chu_xem on public.von_lien_ket_quy;
create policy vlk_chi_chu_xem on public.von_lien_ket_quy for select to authenticated using (public.la_chu());

-- Khoản vốn đã liên kết: không sửa số tiền / ngày / tên / hạng mục (ghi chú vẫn sửa được)
create or replace function public.von_khoa_sua_da_lien_ket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.huy_von', true), '') = '1' then return new; end if;
  if (to_jsonb(new) - 'note') is distinct from (to_jsonb(old) - 'note')
     and exists (select 1 from public.von_lien_ket_quy k where k.von_id = old.id and k.kieu = tg_argv[0]) then
    raise exception 'Khoản này đã liên kết với Sổ quỹ nên không sửa số tiền, ngày, tên. Hãy hủy (lý do bắt buộc) rồi nhập lại';
  end if;
  return new;
end $$;
revoke execute on function public.von_khoa_sua_da_lien_ket() from public, anon, authenticated;
drop trigger if exists von_khoa_sua on public.von_gop;
create trigger von_khoa_sua before update on public.von_gop for each row execute function public.von_khoa_sua_da_lien_ket('gop');
drop trigger if exists von_khoa_sua on public.von_chi_phi_mo_xuong;
create trigger von_khoa_sua before update on public.von_chi_phi_mo_xuong for each row execute function public.von_khoa_sua_da_lien_ket('mo_xuong');

-- 3. View phân loại: thêm cột dong_tien ở cuối (các cột cũ giữ nguyên) -------------------------------------------
create or replace view public.so_quy_phan_loai with (security_invoker = true) as
select s.id, s.ngay, s.quy, s.so_tien,
       x.loai_goc,
       case x.loai_goc
         when 'thu' then
           case when coalesce(o.payment_id, s.payment_id) is null then coalesce(lt.ten, 'thu_khac')
                when position(' - Thu nợ' in coalesce(o.ghi_chu, s.ghi_chu, '')) > 0 then 'thu_no'
                else 'thu_phieu' end
         when 'chi' then coalesce(lc.ten, 'Chi khác')
         else coalesce(o.loai, s.loai)
       end as nhom,
       case x.loai_goc when 'thu' then coalesce(lt.dong_tien, 'hoat_dong') when 'chi' then coalesce(lc.dong_tien, 'hoat_dong') else 'hoat_dong' end as dong_tien
from public.so_quy s
left join public.so_quy o on o.id = s.dao_cua
cross join lateral (select coalesce(o.loai, case when s.so_tien < 0 then 'chi' else 'thu' end) as loai_goc,
                           coalesce(o.danh_muc, s.danh_muc) as dm,
                           coalesce(o.payment_id, s.payment_id) as pid) x
left join public.loai_phieu_thu lt on x.loai_goc = 'thu' and x.pid is null and lt.ten = x.dm
left join public.loai_phieu_chi lc on x.loai_goc = 'chi' and lc.ten = x.dm;
revoke all on public.so_quy_phan_loai from public, anon, authenticated;

-- 4. Tổng quát một tháng (thêm thu_dt / chi_dt trong từng quỹ; thu/chi vẫn là TỔNG như cũ) -------------------------
create or replace function public.so_quy_tong_thang(p_nam int, p_thang int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_dau date; v_cuoi date; v_bd date; v_quy jsonb; v_thu jsonb; v_chi jsonb;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem tổng quát thu chi'; end if;
  if p_nam is null or p_thang is null or p_nam < 2000 or p_nam > 2100 or p_thang < 1 or p_thang > 12 then
    raise exception 'Tháng hoặc năm không hợp lệ';
  end if;
  v_dau := make_date(p_nam, p_thang, 1);
  v_cuoi := (v_dau + interval '1 month')::date;
  select min(ngay_bat_dau) into v_bd from public.quy_cai_dat;
  if v_bd is null or v_cuoi <= v_bd then
    return jsonb_build_object('co_du_lieu', false, 'bat_dau', v_bd);
  end if;

  select coalesce(jsonb_agg(x order by x->>'quy'), '[]'::jsonb) into v_quy from (
    select jsonb_build_object(
      'quy', c.quy,
      'dau', c.so_du_dau + coalesce((select sum(s.so_tien) from public.so_quy s where s.quy = c.quy and s.ngay >= c.ngay_bat_dau and s.ngay < v_dau), 0),
      'thu', coalesce((select sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'thu' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'chi', coalesce((select -sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'chi' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'thu_dt', coalesce((select sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'thu' and p.dong_tien = 'dau_tu_tai_chinh' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'chi_dt', coalesce((select -sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'chi' and p.dong_tien = 'dau_tu_tai_chinh' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'chuyen', coalesce((select sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'chuyen_quy' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'kiem', coalesce((select sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'kiem_quy' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'cuoi', c.so_du_dau + coalesce((select sum(s.so_tien) from public.so_quy s where s.quy = c.quy and s.ngay >= c.ngay_bat_dau and s.ngay < v_cuoi), 0)
    ) as x
    from public.quy_cai_dat c where c.ngay_bat_dau < v_cuoi
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('nhom', g.nhom, 'dong_tien', g.dt, 'tien_mat', g.tm, 'tai_khoan', g.tk, 'tong', g.tm + g.tk) order by g.ord), '[]'::jsonb) into v_thu
  from (
    select k.nhom, k.ord, k.dt,
           coalesce(sum(p.so_tien) filter (where p.quy = 'Tiền mặt'), 0) as tm,
           coalesce(sum(p.so_tien) filter (where p.quy = 'Tài khoản ngân hàng'), 0) as tk
    from (
      select 'thu_phieu' as nhom, 1 as ord, 'hoat_dong' as dt
      union all select 'thu_no', 2, 'hoat_dong'
      union all select 'thu_khac', 3, 'hoat_dong'
      union all select lt.ten, 10 + lt.thu_tu, lt.dong_tien from public.loai_phieu_thu lt
    ) k
    left join (
      select x.nhom, x.quy, x.so_tien from public.so_quy_phan_loai x
      join public.quy_cai_dat c on c.quy = x.quy
      where x.loai_goc = 'thu' and x.ngay >= greatest(v_dau, c.ngay_bat_dau) and x.ngay < v_cuoi
    ) p on p.nhom = k.nhom
    group by k.nhom, k.ord, k.dt
  ) g;

  select coalesce(jsonb_agg(jsonb_build_object('nhom', g.ten, 'dong_tien', g.dt, 'tinh_vao_lai_lo', g.lailo, 'tien_mat', g.tm, 'tai_khoan', g.tk, 'tong', g.tm + g.tk) order by g.thu_tu), '[]'::jsonb) into v_chi
  from (
    select l.ten, l.dong_tien as dt, l.tinh_vao_lai_lo as lailo, l.thu_tu,
           coalesce(-sum(p.so_tien) filter (where p.quy = 'Tiền mặt'), 0) as tm,
           coalesce(-sum(p.so_tien) filter (where p.quy = 'Tài khoản ngân hàng'), 0) as tk
    from public.loai_phieu_chi l
    left join (
      select x.nhom, x.quy, x.so_tien from public.so_quy_phan_loai x
      join public.quy_cai_dat c on c.quy = x.quy
      where x.loai_goc = 'chi' and x.ngay >= greatest(v_dau, c.ngay_bat_dau) and x.ngay < v_cuoi
    ) p on p.nhom = l.ten
    group by l.ten, l.dong_tien, l.tinh_vao_lai_lo, l.thu_tu
  ) g;

  return jsonb_build_object('co_du_lieu', true, 'bat_dau', v_bd, 'quy', v_quy, 'thu', v_thu, 'chi', v_chi);
end $$;
revoke execute on function public.so_quy_tong_thang(int, int) from public, anon;
grant execute on function public.so_quy_tong_thang(int, int) to authenticated;

-- 5. Bảng 12 tháng tách hai khối (hàm mới, hàm cũ so_quy_12_thang giữ nguyên) -----------------------------------
create or replace function public.so_quy_12_thang_dt(p_nam int)
returns table (thang int, co_du_lieu boolean, thu_hd numeric, chi_hd numeric, thu_dt numeric, chi_dt numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_bd date;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem tổng quát thu chi'; end if;
  if p_nam is null or p_nam < 2000 or p_nam > 2100 then raise exception 'Năm không hợp lệ'; end if;
  select min(ngay_bat_dau) into v_bd from public.quy_cai_dat;
  return query
    with a as (
      select extract(month from x.ngay)::int as m,
             sum(x.so_tien) filter (where x.loai_goc = 'thu' and x.dong_tien = 'hoat_dong') as th,
             -sum(x.so_tien) filter (where x.loai_goc = 'chi' and x.dong_tien = 'hoat_dong') as ch,
             sum(x.so_tien) filter (where x.loai_goc = 'thu' and x.dong_tien = 'dau_tu_tai_chinh') as td,
             -sum(x.so_tien) filter (where x.loai_goc = 'chi' and x.dong_tien = 'dau_tu_tai_chinh') as cd
      from public.so_quy_phan_loai x
      join public.quy_cai_dat q on q.quy = x.quy
      where x.ngay >= make_date(p_nam, 1, 1) and x.ngay < make_date(p_nam + 1, 1, 1) and x.ngay >= q.ngay_bat_dau
      group by 1
    )
    select g.m, (v_bd is not null and (make_date(p_nam, g.m, 1) + interval '1 month')::date > v_bd),
           coalesce(a.th, 0)::numeric, coalesce(a.ch, 0)::numeric, coalesce(a.td, 0)::numeric, coalesce(a.cd, 0)::numeric
    from generate_series(1, 12) g(m) left join a on a.m = g.m
    order by g.m;
end $$;
revoke execute on function public.so_quy_12_thang_dt(int) from public, anon;
grant execute on function public.so_quy_12_thang_dt(int) to authenticated;

-- 6. Phân loại lại (ghi dòng đảo + dòng mới) -----------------------------------------------------------------------
-- Trả về lý do KHÔNG phân loại lại được (null = được)
create or replace function public.so_quy_loi_phan_loai(p_id uuid, p_loai_moi text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s record; v_cu text;
begin
  select * into s from public.so_quy where id = p_id;
  if not found then return 'Không tìm thấy dòng sổ quỹ'; end if;
  if s.loai not in ('thu', 'chi') then return 'Chỉ phân loại lại dòng thu hoặc chi'; end if;
  if exists (select 1 from public.so_quy d where d.dao_cua = s.id) then return 'Dòng này đã hủy'; end if;
  if s.payment_id is not null then return 'Là khoản thu của phiếu sửa chữa, không phân loại lại'; end if;
  if s.chi_phi_id is not null then return 'Là chi phí của phiếu sửa chữa, không phân loại lại'; end if;
  if exists (select 1 from public.von_lien_ket_quy k where k.so_quy_id = s.id) then return 'Đã gắn với mục Vốn, muốn sửa hãy hủy giao dịch'; end if;
  if s.loai = 'thu' then
    if p_loai_moi <> 'Thu khác' and not exists (select 1 from public.loai_phieu_thu where ten = p_loai_moi) then return 'Loại thu mới không hợp lệ'; end if;
    v_cu := coalesce(s.danh_muc, 'Thu khác');
  else
    if not exists (select 1 from public.loai_phieu_chi where ten = p_loai_moi) then return 'Loại chi mới không hợp lệ'; end if;
    v_cu := coalesce(s.danh_muc, 'Chi khác');
  end if;
  if v_cu = p_loai_moi then return 'Đã đúng loại này rồi'; end if;
  return null;
end $$;
revoke execute on function public.so_quy_loi_phan_loai(uuid, text) from public, anon, authenticated;

-- Nội bộ: phân loại lại 1 dòng, trả về id dòng mới. Cùng ngày + cùng quỹ + cùng số tiền => số dư không đổi.
create or replace function public.so_quy_doi_loai_noi_bo(p_id uuid, p_loai_moi text, p_ly_do text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_loi text; v_lai boolean; v_new uuid; v_cu text; v_gc text;
begin
  v_loi := public.so_quy_loi_phan_loai(p_id, p_loai_moi);
  if v_loi is not null then raise exception '%', v_loi; end if;
  select * into s from public.so_quy where id = p_id;
  if s.loai = 'thu' then
    v_cu := coalesce(s.danh_muc, 'Thu khác');
    select lt.tinh_vao_lai_lo into v_lai from public.loai_phieu_thu lt where lt.ten = p_loai_moi;
  else
    v_cu := coalesce(s.danh_muc, 'Chi khác');
    select lc.tinh_vao_lai_lo into v_lai from public.loai_phieu_chi lc where lc.ten = p_loai_moi;
  end if;
  v_gc := 'Phân loại lại từ "' || v_cu || '"' || coalesce(' (' || s.so_phieu || ')', '') || coalesce(' - ' || s.ghi_chu, '');
  -- Thu: ghi dòng mới trước rồi đảo (số dư không bao giờ tụt xuống thấp hơn). Chi: đảo trước rồi ghi dòng mới.
  if s.loai = 'thu' then
    v_new := public.so_quy_ghi('thu', s.quy, s.so_tien, s.ngay, null, null, s.doi_tuong, s.doi_tuong_ten, s.order_id, null, s.import_id,
                               p_loai_moi, v_lai, v_gc, null, p_ly_do);
    perform public.so_quy_ghi('dao', s.quy, -s.so_tien, s.ngay, null, null, s.doi_tuong, s.doi_tuong_ten, s.order_id, null, s.import_id,
                              coalesce(s.danh_muc, 'Thu khác'), s.tinh_vao_lai_lo, 'Đảo ' || coalesce(s.so_phieu, 'thu') || ' - phân loại lại', s.id, p_ly_do);
  else
    perform public.so_quy_ghi('dao', s.quy, -s.so_tien, s.ngay, null, null, s.doi_tuong, s.doi_tuong_ten, s.order_id, null, s.import_id,
                              coalesce(s.danh_muc, 'Chi khác'), s.tinh_vao_lai_lo, 'Đảo ' || coalesce(s.so_phieu, 'chi') || ' - phân loại lại', s.id, p_ly_do);
    v_new := public.so_quy_ghi('chi', s.quy, s.so_tien, s.ngay, null, null, s.doi_tuong, s.doi_tuong_ten, s.order_id, null, s.import_id,
                               p_loai_moi, v_lai, v_gc, null, p_ly_do);
  end if;
  perform public.ghi_nhat_ky('phan_loai_lai_quy', 'Sổ quỹ', s.so_phieu, s.quy, null, 'so_quy', s.id,
    jsonb_build_object('loai', v_cu, 'so_tien', s.so_tien, 'ngay', s.ngay),
    jsonb_build_object('loai', p_loai_moi, 'dong_moi', v_new), p_ly_do);
  return v_new;
end $$;
revoke execute on function public.so_quy_doi_loai_noi_bo(uuid, text, text) from public, anon, authenticated;

-- Công cụ cho Chủ: p_thuc_hien = false -> chỉ XEM TRƯỚC (không ghi gì). true -> ghi (lý do bắt buộc), tất cả hoặc không dòng nào.
create or replace function public.so_quy_phan_loai_lai(p_ids uuid[], p_loai_moi text, p_ly_do text, p_thuc_hien boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ly text := btrim(coalesce(p_ly_do, '')); v_loai text := btrim(coalesce(p_loai_moi, ''));
  r record; v_dong jsonb := '[]'::jsonb; v_loi text; v_so int := 0; v_dt_moi text; v_dt_cu text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được phân loại lại sổ quỹ'; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Hãy chọn ít nhất một dòng'; end if;
  if array_length(p_ids, 1) > 200 then raise exception 'Mỗi lần chọn tối đa 200 dòng'; end if;
  if v_loai = '' then raise exception 'Hãy chọn loại mới'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  if p_thuc_hien and v_ly = '' then raise exception 'Bắt buộc nhập lý do phân loại lại'; end if;
  perform pg_advisory_xact_lock(7210021);

  for r in select s.* from public.so_quy s where s.id = any (p_ids) order by s.seq loop
    v_loi := public.so_quy_loi_phan_loai(r.id, v_loai);
    if p_thuc_hien then
      if v_loi is not null then raise exception 'Dòng % (% đ): %', coalesce(r.so_phieu, r.loai), abs(r.so_tien), v_loi; end if;
      perform public.so_quy_doi_loai_noi_bo(r.id, v_loai, v_ly);
      v_so := v_so + 1;
    end if;
    v_dt_cu := coalesce((select case r.loai when 'thu' then (select lt.dong_tien from public.loai_phieu_thu lt where lt.ten = r.danh_muc)
                                            else (select lc.dong_tien from public.loai_phieu_chi lc where lc.ten = r.danh_muc) end), 'hoat_dong');
    v_dt_moi := coalesce((select case r.loai when 'thu' then (select lt.dong_tien from public.loai_phieu_thu lt where lt.ten = v_loai)
                                             else (select lc.dong_tien from public.loai_phieu_chi lc where lc.ten = v_loai) end), 'hoat_dong');
    v_dong := v_dong || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'ngay', r.ngay, 'quy', r.quy, 'loai', r.loai, 'so_tien', r.so_tien, 'so_phieu', r.so_phieu, 'ten', r.doi_tuong_ten,
      'loai_cu', coalesce(r.danh_muc, case r.loai when 'thu' then 'Thu khác' else 'Chi khác' end), 'loai_moi', v_loai,
      'dong_tien_cu', v_dt_cu, 'dong_tien_moi', v_dt_moi, 'loi', v_loi));
  end loop;
  if jsonb_array_length(v_dong) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'Có dòng không tồn tại trong sổ quỹ';
  end if;
  return jsonb_build_object('da_ghi', p_thuc_hien, 'so_dong_phan_loai', v_so, 'so_dong_se_ghi_them', jsonb_array_length(v_dong) * 2,
                            'thay_doi_so_du', 0, 'dong', v_dong);
end $$;
revoke execute on function public.so_quy_phan_loai_lai(uuid[], text, text, boolean) from public, anon;
grant execute on function public.so_quy_phan_loai_lai(uuid[], text, text, boolean) to authenticated;

-- 7. Chặn phiếu thu / phiếu chi thường dùng loại có liên kết Vốn (phải đi qua von_quy_ghi) ---------------------------
create or replace function public.tao_phieu_thu(p_quy text, p_so_tien numeric, p_doi_tuong text, p_ten text, p_ma_phieu text, p_danh_muc text, p_ghi_chu text)
returns text language plpgsql security definer set search_path = public as $$
declare v_so bigint; v_ma text; v_oid uuid; v_ten text := nullif(btrim(coalesce(p_ten, '')), ''); f record; v_dm text := coalesce(nullif(btrim(coalesce(p_danh_muc, '')), ''), 'Thu khác'); lt record; v_co_loai boolean;
begin
  perform public.so_quy_kiem_tra_chung(p_quy);
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if p_doi_tuong not in ('khach', 'nha_cung_cap', 'tho', 'khac') then raise exception 'Đối tượng không hợp lệ'; end if;
  if char_length(coalesce(p_ghi_chu, '')) > 500 or char_length(v_dm) > 100 or char_length(coalesce(v_ten, '')) > 200 then raise exception 'Nội dung quá dài'; end if;
  select * into lt from public.loai_phieu_thu t where lower(t.ten) = lower(v_dm);
  v_co_loai := found;
  if v_co_loai then
    if lt.lien_ket is not null then raise exception 'Loại thu "%" phải ghi để gắn với mục Vốn. Hãy tải lại trang (Ctrl+F5) rồi chọn loại này trong form phiếu thu', lt.ten; end if;
    v_dm := lt.ten;
  end if;
  if nullif(btrim(coalesce(p_ma_phieu, '')), '') is not null then
    select * into f from public.so_quy_tim_phieu(p_ma_phieu); v_oid := f.oid;
    v_ten := coalesce(v_ten, f.khach);
  end if;
  update public.so_quy_dem set so = so + 1 where loai = 'THU' returning so into v_so;
  v_ma := 'THU' || lpad(v_so::text, 4, '0');
  perform public.so_quy_ghi('thu', p_quy, p_so_tien, null, v_ma, null, p_doi_tuong, v_ten, v_oid, null, null, v_dm, case when v_co_loai then lt.tinh_vao_lai_lo else null end, p_ghi_chu, null, null);
  perform public.ghi_nhat_ky('phieu_thu', 'Sổ quỹ', v_ma, v_ten, null, 'so_quy', null, null,
    jsonb_build_object('quy', p_quy, 'so_tien', p_so_tien, 'doi_tuong', p_doi_tuong, 'danh_muc', v_dm, 'ghi_chu', p_ghi_chu), null);
  return v_ma;
end $$;
revoke execute on function public.tao_phieu_thu(text, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.tao_phieu_thu(text, numeric, text, text, text, text, text) to authenticated;

create or replace function public.tao_phieu_chi(p_quy text, p_so_tien numeric, p_loai_chi text, p_doi_tuong text, p_ten text, p_ma_phieu text, p_import uuid, p_ghi_chu text)
returns text language plpgsql security definer set search_path = public as $$
declare v_so bigint; v_ma text; v_oid uuid; v_ten text := nullif(btrim(coalesce(p_ten, '')), ''); f record; l record; v_du numeric;
begin
  perform public.so_quy_kiem_tra_chung(p_quy);
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if p_doi_tuong not in ('khach', 'nha_cung_cap', 'tho', 'khac') then raise exception 'Đối tượng không hợp lệ'; end if;
  select * into l from public.loai_phieu_chi where ten = p_loai_chi;
  if not found then raise exception 'Loại phiếu chi không hợp lệ'; end if;
  if l.lien_ket is not null then raise exception 'Loại chi "%" phải ghi để gắn với Chi phí mở xưởng. Hãy tải lại trang (Ctrl+F5) rồi chọn loại này trong form phiếu chi', l.ten; end if;
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

-- 8. Liên kết Sổ quỹ <-> Vốn ----------------------------------------------------------------------------------------
-- Nội bộ: ghi 1 phiếu thu / chi thuộc nhóm đầu tư-tài chính (có ngày, có số phiếu, có nhật ký)
create or replace function public.phieu_von_tao(p_chieu text, p_quy text, p_so_tien numeric, p_ngay date, p_danh_muc text, p_ten text, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_so bigint; v_ma text; v_du numeric; v_id uuid; v_lai boolean; v_ten text := nullif(btrim(coalesce(p_ten, '')), '');
begin
  perform public.so_quy_kiem_tra_chung(p_quy);
  if p_chieu not in ('thu', 'chi') then raise exception 'Chiều không hợp lệ'; end if;
  if p_so_tien is null or p_so_tien <= 0 or p_so_tien <> round(p_so_tien) then raise exception 'Số tiền phải là số nguyên lớn hơn 0'; end if;
  if p_ngay is null or p_ngay > public.ngay_hom_nay() then raise exception 'Ngày không hợp lệ (không được ở tương lai)'; end if;
  if char_length(coalesce(p_ghi_chu, '')) > 500 or char_length(coalesce(v_ten, '')) > 200 then raise exception 'Nội dung quá dài'; end if;
  if p_chieu = 'chi' then
    v_du := public.quy_so_du_noi_bo(p_quy);
    if p_so_tien > v_du then
      raise exception 'Quỹ "%" chỉ còn % đ, không đủ chi % đ. Kiểm tra lại số dư đầu kỳ / chuyển quỹ / kiểm quỹ', p_quy, round(v_du), round(p_so_tien);
    end if;
    select tinh_vao_lai_lo into v_lai from public.loai_phieu_chi where ten = p_danh_muc;
  else
    select tinh_vao_lai_lo into v_lai from public.loai_phieu_thu where ten = p_danh_muc;
  end if;
  update public.so_quy_dem set so = so + 1 where loai = upper(p_chieu) returning so into v_so;
  v_ma := upper(p_chieu) || lpad(v_so::text, 4, '0');
  v_id := public.so_quy_ghi(p_chieu, p_quy, case when p_chieu = 'thu' then p_so_tien else -p_so_tien end, p_ngay, v_ma, null, 'khac', v_ten, null, null, null,
                            p_danh_muc, coalesce(v_lai, false), p_ghi_chu, null, null);
  perform public.ghi_nhat_ky(case when p_chieu = 'thu' then 'phieu_thu' else 'phieu_chi' end, 'Sổ quỹ', v_ma, v_ten, null, 'so_quy', v_id, null,
    jsonb_build_object('quy', p_quy, 'so_tien', p_so_tien, 'loai', p_danh_muc, 'ngay', p_ngay, 'ghi_chu', p_ghi_chu), null);
  return v_id;
end $$;
revoke execute on function public.phieu_von_tao(text, text, numeric, date, text, text, text) from public, anon, authenticated;

-- Nội bộ: hủy khoản vốn bằng "Hủy" (không xóa). Không báo lỗi nếu đã hủy rồi.
create or replace function public.von_huy_noi_bo(p_bang text, p_id uuid, p_ly_do text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_bang not in ('von_chi_phi_mo_xuong', 'von_gop', 'von_chi_phi_van_hanh', 'von_loi_nhuan_cu') then raise exception 'Bảng không hợp lệ'; end if;
  perform set_config('app.huy_von', '1', true);
  perform set_config('app.hanh_dong', 'huy_von', true);
  perform set_config('app.ly_do', p_ly_do, true);
  execute format('update public.%I set da_huy = true, huy_ly_do = $1, huy_boi = $2, huy_boi_ten = $3, huy_luc = now() where id = $4 and not da_huy', p_bang)
    using p_ly_do, auth.uid(), public.ten_nguoi_dung(auth.uid()), p_id;
  get diagnostics n = row_count;
  perform set_config('app.huy_von', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  return n;
end $$;
revoke execute on function public.von_huy_noi_bo(text, uuid, text) from public, anon, authenticated;

-- Hủy khoản vốn: nếu đã liên kết với dòng quỹ chưa hủy thì hủy cả dòng quỹ (thêm dòng đảo) và khoản vốn
create or replace function public.von_huy(p_bang text, p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ly text := btrim(coalesce(p_ly_do, '')); n int; lk record;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy khoản này'; end if;
  if p_bang not in ('von_chi_phi_mo_xuong', 'von_gop', 'von_chi_phi_van_hanh', 'von_loi_nhuan_cu') then raise exception 'Bảng không hợp lệ'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  if p_bang in ('von_gop', 'von_chi_phi_mo_xuong') then
    select * into lk from public.von_lien_ket_quy k
      where k.von_id = p_id and k.kieu = case p_bang when 'von_gop' then 'gop' else 'mo_xuong' end;
    if found and not exists (select 1 from public.so_quy d where d.dao_cua = lk.so_quy_id) then
      perform public.huy_giao_dich_quy(lk.so_quy_id, v_ly);   -- hủy dòng quỹ, hàm đó cũng hủy khoản vốn
      return;
    end if;
  end if;
  n := public.von_huy_noi_bo(p_bang, p_id, v_ly);
  if n = 0 then raise exception 'Không tìm thấy khoản này hoặc đã hủy rồi'; end if;
end $$;
revoke execute on function public.von_huy(text, uuid, text) from public, anon;
grant execute on function public.von_huy(text, uuid, text) to authenticated;

-- Hủy giao dịch sổ quỹ: như giai đoạn 26, thêm: nếu dòng đã liên kết với mục Vốn thì hủy luôn khoản vốn
create or replace function public.huy_giao_dich_quy(p_id uuid, p_ly_do text)
returns integer language plpgsql security definer set search_path = public as $$
declare s record; r record; v_ly text := btrim(coalesce(p_ly_do, '')); n int := 0; v_ngay date; lk record; v_co_lk boolean;
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
  select * into lk from public.von_lien_ket_quy k where k.so_quy_id = s.id;
  v_co_lk := found;
  if v_co_lk then
    perform public.von_huy_noi_bo(case lk.kieu when 'gop' then 'von_gop' else 'von_chi_phi_mo_xuong' end, lk.von_id, 'Hủy cùng giao dịch sổ quỹ: ' || v_ly);
  end if;
  perform public.ghi_nhat_ky('huy_giao_dich_quy', 'Sổ quỹ', s.so_phieu, s.quy, null, 'so_quy', s.id,
    jsonb_build_object('loai', s.loai, 'so_tien', s.so_tien, 'quy', s.quy), jsonb_build_object('da_huy', true, 'so_dong_dao', n, 'huy_ca_khoan_von', v_co_lk), v_ly);
  return n;
end $$;
revoke execute on function public.huy_giao_dich_quy(uuid, text) from public, anon;
grant execute on function public.huy_giao_dich_quy(uuid, text) to authenticated;

-- Hàm chính: ghi / gắn một cặp (khoản vốn, dòng quỹ).
--   p_kieu = 'gop' (Vốn góp, dòng THU) hoặc 'mo_xuong' (Chi phí mở xưởng, dòng CHI).
--   p_von_id có, p_so_quy_id không  : tạo dòng quỹ từ khoản vốn có sẵn (cần p_quy)
--   p_von_id không, p_so_quy_id có  : tạo khoản vốn từ dòng quỹ có sẵn
--   cả hai có                       : Chủ xác nhận 2 khoản là MỘT (chỉ gắn, không ghi thêm tiền)
--   cả hai không                    : tạo mới cả hai (cần p_quy, p_so_tien, p_ngay, p_ten)
-- Nếu dòng quỹ có sẵn chưa đúng loại (Vốn góp / Đầu tư mở xưởng) thì tự phân loại lại (đảo + dòng mới) rồi gắn dòng mới.
create or replace function public.von_quy_ghi(p_kieu text, p_von_id uuid, p_so_quy_id uuid, p_quy text, p_so_tien numeric, p_ngay date,
                                              p_ten text, p_hang_muc text, p_ghi_chu text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_chieu text; v_loai text; v_tien numeric; v_ngay date; v_ten text := nullif(btrim(coalesce(p_ten, '')), ''); v_gc text := nullif(btrim(coalesce(p_ghi_chu, '')), '');
  v_hm text := coalesce(nullif(btrim(coalesce(p_hang_muc, '')), ''), 'Khác');
  g record; m record; s record; v_von uuid := p_von_id; v_sq uuid; v_lk uuid; v_ma text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được ghi liên kết Sổ quỹ - Vốn'; end if;
  if p_kieu not in ('gop', 'mo_xuong') then raise exception 'Loại liên kết không hợp lệ'; end if;
  if char_length(v_hm) > 100 or char_length(coalesce(v_gc, '')) > 500 or char_length(coalesce(v_ten, '')) > 200 then raise exception 'Nội dung quá dài'; end if;
  perform pg_advisory_xact_lock(7210021);
  v_chieu := case p_kieu when 'gop' then 'thu' else 'chi' end;
  v_loai  := case p_kieu when 'gop' then 'Vốn góp' else 'Đầu tư mở xưởng' end;

  -- Khoản vốn có sẵn
  if p_von_id is not null then
    if p_kieu = 'gop' then
      select * into g from public.von_gop where id = p_von_id;
      if not found or g.da_huy then raise exception 'Không tìm thấy khoản vốn góp (hoặc đã hủy)'; end if;
      v_tien := g.amount; v_ngay := g.contributed_on; v_ten := coalesce(v_ten, g.contributor);
    else
      select * into m from public.von_chi_phi_mo_xuong where id = p_von_id;
      if not found or m.da_huy then raise exception 'Không tìm thấy khoản chi phí mở xưởng (hoặc đã hủy)'; end if;
      v_tien := m.amount; v_ngay := m.spent_on; v_ten := coalesce(v_ten, m.paid_by); v_hm := m.category;
      if v_tien <= 0 then raise exception 'Khoản chi phí mở xưởng có số tiền 0, không ghi vào quỹ được'; end if;
    end if;
    if exists (select 1 from public.von_lien_ket_quy k where k.kieu = p_kieu and k.von_id = p_von_id) then
      raise exception 'Khoản vốn này đã gắn với một dòng sổ quỹ rồi';
    end if;
  end if;

  -- Dòng quỹ có sẵn
  if p_so_quy_id is not null then
    select * into s from public.so_quy where id = p_so_quy_id;
    if not found then raise exception 'Không tìm thấy dòng sổ quỹ'; end if;
    if s.loai <> v_chieu then raise exception 'Dòng sổ quỹ phải là dòng % để gắn với %', case v_chieu when 'thu' then 'THU' else 'CHI' end, case p_kieu when 'gop' then 'Vốn góp' else 'Chi phí mở xưởng' end; end if;
    if v_tien is not null and abs(s.so_tien) <> v_tien then raise exception 'Số tiền không khớp: khoản vốn % đ, dòng sổ quỹ % đ', round(v_tien), round(abs(s.so_tien)); end if;
    v_tien := abs(s.so_tien); v_ngay := coalesce(v_ngay, s.ngay); v_ten := coalesce(v_ten, s.doi_tuong_ten);
    if coalesce(s.danh_muc, '') = v_loai
       and not exists (select 1 from public.so_quy d where d.dao_cua = s.id)
       and s.payment_id is null and s.chi_phi_id is null
       and not exists (select 1 from public.von_lien_ket_quy k where k.so_quy_id = s.id) then
      v_sq := s.id;
    else
      v_sq := public.so_quy_doi_loai_noi_bo(s.id, v_loai, 'Gắn với mục Vốn (' || case p_kieu when 'gop' then 'Vốn góp' else 'Chi phí mở xưởng' end || ')');
    end if;
  else
    -- Tạo dòng quỹ mới
    if v_tien is null then v_tien := p_so_tien; v_ngay := coalesce(p_ngay, public.ngay_hom_nay()); end if;
    if p_quy is null then raise exception 'Hãy chọn quỹ'; end if;
    v_sq := public.phieu_von_tao(v_chieu, p_quy, v_tien, v_ngay, v_loai, v_ten, case p_kieu when 'mo_xuong' then v_hm || coalesce(' - ' || v_gc, '') else v_gc end);
  end if;

  -- Tạo khoản vốn mới nếu chưa có
  if v_von is null then
    if p_kieu = 'gop' then
      if v_ten is null then raise exception 'Vốn góp phải có tên người góp'; end if;
      insert into public.von_gop (contributor, amount, contributed_on, note) values (v_ten, v_tien, v_ngay, v_gc) returning id into v_von;
    else
      insert into public.von_chi_phi_mo_xuong (spent_on, category, amount, paid_by, note) values (v_ngay, v_hm, v_tien, v_ten, v_gc) returning id into v_von;
    end if;
  end if;

  insert into public.von_lien_ket_quy (kieu, von_id, so_quy_id) values (p_kieu, v_von, v_sq) returning id into v_lk;
  select so_phieu into v_ma from public.so_quy where id = v_sq;
  perform public.ghi_nhat_ky('lien_ket_von_quy', 'Sổ quỹ', v_ma, v_ten, null, 'von_lien_ket_quy', v_lk, null,
    jsonb_build_object('kieu', p_kieu, 'von_id', v_von, 'so_quy_id', v_sq, 'so_tien', v_tien, 'ngay', v_ngay), null);
  return jsonb_build_object('von_id', v_von, 'so_quy_id', v_sq, 'so_phieu', v_ma, 'so_tien', v_tien);
end $$;
revoke execute on function public.von_quy_ghi(text, uuid, uuid, text, numeric, date, text, text, text) from public, anon;
grant execute on function public.von_quy_ghi(text, uuid, uuid, text, numeric, date, text, text, text) to authenticated;

-- 9. Phát hiện nhập trùng ------------------------------------------------------------------------------------------
create or replace function public.von_tim_trung_von(p_kieu text, p_ten text, p_so_tien numeric, p_ngay date)
returns table (von_id uuid, ten text, so_tien numeric, ngay date, ghi_chu text, cung_ten boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_t text := lower(btrim(coalesce(p_ten, '')));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem'; end if;
  if p_kieu = 'gop' then
    return query select g.id, g.contributor, g.amount, g.contributed_on, g.note, (v_t <> '' and lower(btrim(g.contributor)) = v_t)
      from public.von_gop g
      where not g.da_huy and g.amount = p_so_tien and g.contributed_on = p_ngay
        and not exists (select 1 from public.von_lien_ket_quy k where k.kieu = 'gop' and k.von_id = g.id)
      order by g.created_at;
  elsif p_kieu = 'mo_xuong' then
    return query select m.id, coalesce(m.paid_by, m.category), m.amount, m.spent_on, m.note, (v_t <> '' and lower(btrim(coalesce(m.paid_by, ''))) = v_t)
      from public.von_chi_phi_mo_xuong m
      where not m.da_huy and m.amount = p_so_tien and m.spent_on = p_ngay
        and not exists (select 1 from public.von_lien_ket_quy k where k.kieu = 'mo_xuong' and k.von_id = m.id)
      order by m.created_at;
  else
    raise exception 'Loại không hợp lệ';
  end if;
end $$;
revoke execute on function public.von_tim_trung_von(text, text, numeric, date) from public, anon;
grant execute on function public.von_tim_trung_von(text, text, numeric, date) to authenticated;

create or replace function public.von_tim_trung_quy(p_kieu text, p_ten text, p_so_tien numeric, p_ngay date)
returns table (so_quy_id uuid, so_phieu text, quy text, ten text, so_tien numeric, ngay date, loai_hien_tai text, cung_ten boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_t text := lower(btrim(coalesce(p_ten, ''))); v_chieu text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem'; end if;
  if p_kieu not in ('gop', 'mo_xuong') then raise exception 'Loại không hợp lệ'; end if;
  v_chieu := case p_kieu when 'gop' then 'thu' else 'chi' end;
  return query select s.id, s.so_phieu, s.quy, s.doi_tuong_ten, abs(s.so_tien), s.ngay,
                      coalesce(s.danh_muc, case s.loai when 'thu' then 'Thu khác' else 'Chi khác' end),
                      (v_t <> '' and lower(btrim(coalesce(s.doi_tuong_ten, ''))) = v_t)
    from public.so_quy s
    where s.loai = v_chieu and abs(s.so_tien) = p_so_tien and s.ngay = p_ngay
      and s.payment_id is null and s.chi_phi_id is null
      and not exists (select 1 from public.so_quy d where d.dao_cua = s.id)
      and not exists (select 1 from public.von_lien_ket_quy k where k.so_quy_id = s.id)
    order by s.seq;
end $$;
revoke execute on function public.von_tim_trung_quy(text, text, numeric, date) from public, anon;
grant execute on function public.von_tim_trung_quy(text, text, numeric, date) to authenticated;

-- Gợi ý cho trang Sổ quỹ: các cặp có thể là một khoản nhập hai nơi + các dòng quỹ loại Vốn góp / Đầu tư mở xưởng chưa có khoản vốn
create or replace function public.von_quy_goi_y() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cap jsonb; v_le jsonb; v_von jsonb;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem'; end if;
  select coalesce(jsonb_agg(x order by x->>'ngay' desc), '[]'::jsonb) into v_cap from (
    select jsonb_build_object('kieu', 'gop', 'von_id', g.id, 'ten_von', g.contributor, 'so_quy_id', s.id, 'so_phieu', s.so_phieu, 'quy', s.quy,
             'ten_quy', s.doi_tuong_ten, 'so_tien', g.amount, 'ngay', g.contributed_on, 'loai_quy', coalesce(s.danh_muc, 'Thu khác'),
             'cung_ten', (lower(btrim(g.contributor)) = lower(btrim(coalesce(s.doi_tuong_ten, ''))))) as x
    from public.von_gop g
    join public.so_quy s on s.loai = 'thu' and s.so_tien = g.amount and s.ngay = g.contributed_on and s.payment_id is null and s.chi_phi_id is null
    where not g.da_huy and not exists (select 1 from public.von_lien_ket_quy k where k.kieu = 'gop' and k.von_id = g.id)
      and not exists (select 1 from public.von_lien_ket_quy k where k.so_quy_id = s.id)
      and not exists (select 1 from public.so_quy d where d.dao_cua = s.id)
    union all
    select jsonb_build_object('kieu', 'mo_xuong', 'von_id', m.id, 'ten_von', coalesce(m.paid_by, '') || ' ' || m.category, 'so_quy_id', s.id, 'so_phieu', s.so_phieu, 'quy', s.quy,
             'ten_quy', s.doi_tuong_ten, 'so_tien', m.amount, 'ngay', m.spent_on, 'loai_quy', coalesce(s.danh_muc, 'Chi khác'),
             'cung_ten', (m.paid_by is not null and lower(btrim(m.paid_by)) = lower(btrim(coalesce(s.doi_tuong_ten, '')))))
    from public.von_chi_phi_mo_xuong m
    join public.so_quy s on s.loai = 'chi' and -s.so_tien = m.amount and s.ngay = m.spent_on and s.payment_id is null and s.chi_phi_id is null
    where not m.da_huy and m.amount > 0 and not exists (select 1 from public.von_lien_ket_quy k where k.kieu = 'mo_xuong' and k.von_id = m.id)
      and not exists (select 1 from public.von_lien_ket_quy k where k.so_quy_id = s.id)
      and not exists (select 1 from public.so_quy d where d.dao_cua = s.id)
    limit 100
  ) t;
  select coalesce(jsonb_agg(jsonb_build_object('kieu', case s.danh_muc when 'Vốn góp' then 'gop' else 'mo_xuong' end, 'so_quy_id', s.id, 'so_phieu', s.so_phieu,
           'quy', s.quy, 'ten', s.doi_tuong_ten, 'so_tien', abs(s.so_tien), 'ngay', s.ngay) order by s.seq desc), '[]'::jsonb) into v_le
  from public.so_quy s
  where s.loai in ('thu', 'chi') and s.danh_muc in ('Vốn góp', 'Đầu tư mở xưởng')
    and ((s.loai = 'thu' and s.danh_muc = 'Vốn góp') or (s.loai = 'chi' and s.danh_muc = 'Đầu tư mở xưởng'))
    and not exists (select 1 from public.so_quy d where d.dao_cua = s.id)
    and not exists (select 1 from public.von_lien_ket_quy k where k.so_quy_id = s.id);
  select jsonb_build_object(
    'so_von_gop', (select count(*) from public.von_gop g where not g.da_huy and not exists (select 1 from public.von_lien_ket_quy k where k.kieu = 'gop' and k.von_id = g.id)),
    'so_mo_xuong', (select count(*) from public.von_chi_phi_mo_xuong m where not m.da_huy and not exists (select 1 from public.von_lien_ket_quy k where k.kieu = 'mo_xuong' and k.von_id = m.id))) into v_von;
  return jsonb_build_object('cap', v_cap, 'quy_chua_co_von', v_le, 'von_chua_ghi_quy', v_von);
end $$;
revoke execute on function public.von_quy_goi_y() from public, anon;
grant execute on function public.von_quy_goi_y() to authenticated;

notify pgrst, 'reload schema';

-- 10. Kiểm tra nhanh sau khi chạy --------------------------------------------------------------------------------------
select
  (select count(*) from public.loai_phieu_thu) as so_loai_thu_phai_la_2_tro_len,
  (select count(*) from public.loai_phieu_chi where dong_tien = 'dau_tu_tai_chinh') as so_loai_chi_dau_tu_phai_la_2_tro_len,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'von_lien_ket_quy') as lien_ket_bat_bao_mat_phai_la_true,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'loai_phieu_thu') as loai_thu_bat_bao_mat_phai_la_true;
