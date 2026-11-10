-- GIAI ĐOẠN 30: Tổng quát thu chi theo tháng trong trang Sổ quỹ
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn. Cần đã chạy giai-doan-21 đến 28.
-- File này CHỈ ĐỌC dữ liệu (không ghi, không sửa dòng nào, không đổi cách tính số dư quỹ).
--
-- ===== QUY TẮC TÍNH =====
--  * Chỉ tính dòng sổ quỹ từ ngày bắt đầu của từng quỹ trở đi (giống cách tính số dư hiện tại).
--  * Thu = dòng "thu"; Chi = dòng "chi". Chuyển quỹ và kiểm quỹ KHÔNG tính vào thu/chi (hiện thành dòng riêng).
--  * Dòng đảo (hủy) tính vào đúng tháng của chính dòng đảo, thuộc cùng nhóm với dòng gốc, làm cho số ròng.
--  * Thu chia: phiếu sửa chữa / thu nợ / phiếu thu khác. Chi chia theo loại chi (bảng loai_phieu_chi).
--  * Chỉ Chủ xưởng gọi được (hàm kiểm tra la_chu()). Nhân viên không xem được.

-- 1. View phân loại (nội bộ, không cấp quyền cho người dùng) -------------------------------------------
create or replace view public.so_quy_phan_loai with (security_invoker = true) as
select s.id, s.ngay, s.quy, s.so_tien,
       coalesce(o.loai, case when s.so_tien < 0 then 'chi' else 'thu' end) as loai_goc,
       case coalesce(o.loai, case when s.so_tien < 0 then 'chi' else 'thu' end)
         when 'thu' then
           case when coalesce(o.payment_id, s.payment_id) is null then 'thu_khac'
                when position(' - Thu nợ' in coalesce(o.ghi_chu, s.ghi_chu, '')) > 0 then 'thu_no'
                else 'thu_phieu' end
         when 'chi' then
           case when exists (select 1 from public.loai_phieu_chi l where l.ten = coalesce(o.danh_muc, s.danh_muc))
                then coalesce(o.danh_muc, s.danh_muc) else 'Chi khác' end
         else coalesce(o.loai, s.loai)
       end as nhom
from public.so_quy s
left join public.so_quy o on o.id = s.dao_cua;
revoke all on public.so_quy_phan_loai from public, anon, authenticated;

-- 2. Tổng quát một tháng ----------------------------------------------------------------------------------------
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
      'chuyen', coalesce((select sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'chuyen_quy' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'kiem', coalesce((select sum(p.so_tien) from public.so_quy_phan_loai p where p.quy = c.quy and p.loai_goc = 'kiem_quy' and p.ngay >= greatest(v_dau, c.ngay_bat_dau) and p.ngay < v_cuoi), 0),
      'cuoi', c.so_du_dau + coalesce((select sum(s.so_tien) from public.so_quy s where s.quy = c.quy and s.ngay >= c.ngay_bat_dau and s.ngay < v_cuoi), 0)
    ) as x
    from public.quy_cai_dat c where c.ngay_bat_dau < v_cuoi
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('nhom', g.nhom, 'tien_mat', g.tm, 'tai_khoan', g.tk, 'tong', g.tm + g.tk) order by g.ord), '[]'::jsonb) into v_thu
  from (
    select k.nhom, k.ord,
           coalesce(sum(p.so_tien) filter (where p.quy = 'Tiền mặt'), 0) as tm,
           coalesce(sum(p.so_tien) filter (where p.quy = 'Tài khoản ngân hàng'), 0) as tk
    from (values ('thu_phieu', 1), ('thu_no', 2), ('thu_khac', 3)) k(nhom, ord)
    left join (
      select x.nhom, x.quy, x.so_tien from public.so_quy_phan_loai x
      join public.quy_cai_dat c on c.quy = x.quy
      where x.loai_goc = 'thu' and x.ngay >= greatest(v_dau, c.ngay_bat_dau) and x.ngay < v_cuoi
    ) p on p.nhom = k.nhom
    group by k.nhom, k.ord
  ) g;

  select coalesce(jsonb_agg(jsonb_build_object('nhom', g.ten, 'tinh_vao_lai_lo', g.lailo, 'tien_mat', g.tm, 'tai_khoan', g.tk, 'tong', g.tm + g.tk) order by g.thu_tu), '[]'::jsonb) into v_chi
  from (
    select l.ten, l.tinh_vao_lai_lo as lailo, l.thu_tu,
           coalesce(-sum(p.so_tien) filter (where p.quy = 'Tiền mặt'), 0) as tm,
           coalesce(-sum(p.so_tien) filter (where p.quy = 'Tài khoản ngân hàng'), 0) as tk
    from public.loai_phieu_chi l
    left join (
      select x.nhom, x.quy, x.so_tien from public.so_quy_phan_loai x
      join public.quy_cai_dat c on c.quy = x.quy
      where x.loai_goc = 'chi' and x.ngay >= greatest(v_dau, c.ngay_bat_dau) and x.ngay < v_cuoi
    ) p on p.nhom = l.ten
    group by l.ten, l.tinh_vao_lai_lo, l.thu_tu
  ) g;

  return jsonb_build_object('co_du_lieu', true, 'bat_dau', v_bd, 'quy', v_quy, 'thu', v_thu, 'chi', v_chi);
end $$;
revoke execute on function public.so_quy_tong_thang(int, int) from public, anon;
grant execute on function public.so_quy_tong_thang(int, int) to authenticated;

-- 3. Bảng 12 tháng của một năm ---------------------------------------------------------------------------------
create or replace function public.so_quy_12_thang(p_nam int)
returns table (thang int, co_du_lieu boolean, thu numeric, chi numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_bd date;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem tổng quát thu chi'; end if;
  if p_nam is null or p_nam < 2000 or p_nam > 2100 then raise exception 'Năm không hợp lệ'; end if;
  select min(ngay_bat_dau) into v_bd from public.quy_cai_dat;
  return query
    with a as (
      select extract(month from x.ngay)::int as m,
             sum(x.so_tien) filter (where x.loai_goc = 'thu') as t,
             -sum(x.so_tien) filter (where x.loai_goc = 'chi') as c
      from public.so_quy_phan_loai x
      join public.quy_cai_dat q on q.quy = x.quy
      where x.ngay >= make_date(p_nam, 1, 1) and x.ngay < make_date(p_nam + 1, 1, 1) and x.ngay >= q.ngay_bat_dau
      group by 1
    )
    select g.m, (v_bd is not null and (make_date(p_nam, g.m, 1) + interval '1 month')::date > v_bd),
           coalesce(a.t, 0)::numeric, coalesce(a.c, 0)::numeric
    from generate_series(1, 12) g(m) left join a on a.m = g.m
    order by g.m;
end $$;
revoke execute on function public.so_quy_12_thang(int) from public, anon;
grant execute on function public.so_quy_12_thang(int) to authenticated;
