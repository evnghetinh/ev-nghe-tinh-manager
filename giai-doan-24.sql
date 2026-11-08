-- GIAI ĐOẠN 24: Giá trị tồn kho (chỉ Chủ xưởng thấy số tiền)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run. Chạy lại nhiều lần vẫn an toàn.
-- Cần đã chạy giai-doan-4, 13, 16.
-- File này KHÔNG đổi cách tính doanh thu, lợi nhuận, tồn kho, sổ kho, sổ quỹ. Chỉ thêm hàm ĐỌC.
--  * Giá trị tồn của 1 phụ tùng = tồn hiện tại (đơn vị bán, có thể lẻ) x giá vốn mỗi đơn vị bán (part_costs), làm tròn đến 1 đồng.
--  * Phụ tùng đang ẩn mà còn tồn VẪN tính. Chưa có giá nhập (không có dòng giá hoặc giá = 0) thì tính 0 và được đếm riêng.
--  * Cả 3 hàm đều kiểm tra la_chu() ngay trong cơ sở dữ liệu: nhân viên gọi sẽ bị từ chối, không lấy được số tiền nào.

-- 1. Giá trị tồn từng phụ tùng ------------------------------------------------------------------
create or replace function public.gia_tri_ton()
returns table (part_id uuid, gia_von numeric, co_gia_nhap boolean, gia_tri_von numeric, gia_tri_ban numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem giá trị tồn kho'; end if;
  return query
    select p.id,
           coalesce(c.cost_price, 0),
           coalesce(c.cost_price, 0) > 0,
           round(p.stock * coalesce(c.cost_price, 0), 0),
           round(p.stock * p.sale_price, 0)
    from public.parts p
    left join public.part_costs c on c.part_id = p.id;
end $$;
revoke execute on function public.gia_tri_ton() from public, anon;
grant execute on function public.gia_tri_ton() to authenticated;

-- 2. Tổng (cho thẻ ở Tổng quan) -----------------------------------------------------------------
create or replace function public.tong_gia_tri_ton()
returns table (tong_von numeric, tong_ban numeric, so_con_hang bigint, so_het_hang bigint, so_thieu_gia bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem giá trị tồn kho'; end if;
  return query
    select coalesce(sum(g.gia_tri_von), 0), coalesce(sum(g.gia_tri_ban), 0),
           count(*) filter (where p.stock > 0),
           count(*) filter (where p.stock <= 0),
           count(*) filter (where p.stock <> 0 and not g.co_gia_nhap)
    from public.parts p
    join public.gia_tri_ton() g on g.part_id = p.id;
end $$;
revoke execute on function public.tong_gia_tri_ton() from public, anon;
grant execute on function public.tong_gia_tri_ton() to authenticated;

-- 3. Liệt kê chỗ lệch / chỗ chưa đầy đủ ---------------------------------------------------------
create or replace function public.doi_chieu_gia_tri_ton()
returns table (part_id uuid, ten text, ma text, loai text, ton numeric, tong_so numeric, tien_lech numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem giá trị tồn kho'; end if;
  return query
    with s as (select l.part_id as pid, sum(l.so_luong) as t from public.stock_ledger l group by l.part_id)
    select p.id, p.name, p.code,
           case when p.stock <> coalesce(s.t, 0) then 'Tồn lệch sổ kho (giá trị tồn tính theo tồn hiện tại)'
                when p.stock < 0 then 'Tồn âm'
                else 'Còn tồn nhưng chưa có giá nhập (tính 0)' end,
           p.stock, coalesce(s.t, 0),
           round((p.stock - coalesce(s.t, 0)) * coalesce(c.cost_price, 0), 0)
    from public.parts p
    left join s on s.pid = p.id
    left join public.part_costs c on c.part_id = p.id
    where p.stock <> coalesce(s.t, 0)
       or p.stock < 0
       or (p.stock <> 0 and coalesce(c.cost_price, 0) = 0)
    order by p.name;
end $$;
revoke execute on function public.doi_chieu_gia_tri_ton() from public, anon;
grant execute on function public.doi_chieu_gia_tri_ton() to authenticated;
