-- GIAI ĐOẠN 10b: Nhân viên xem được dòng báo giá + tổng tiền của phiếu đã hoàn thành (chỉ GIÁ BÁN)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run. Chạy lại nhiều lần vẫn an toàn.
-- Không đổi chính sách RLS: Nhân viên vẫn không đọc/sửa trực tiếp bảng repair_items của phiếu đã thu tiền.
-- Hàm chỉ trả: id, loại, tên, số lượng, đơn giá bán. KHÔNG có giá nhập, chi phí, thuê ngoài, lợi nhuận.
create or replace function public.dong_bao_gia(p_order uuid)
returns table (id uuid, kind text, name text, qty numeric, unit_price numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.kind, i.name, i.qty, i.unit_price
  from public.repair_items i
  where public.vai_tro() is not null and i.order_id = p_order
  order by i.created_at
$$;
revoke execute on function public.dong_bao_gia(uuid) from public, anon;
grant execute on function public.dong_bao_gia(uuid) to authenticated;

notify pgrst, 'reload schema';
