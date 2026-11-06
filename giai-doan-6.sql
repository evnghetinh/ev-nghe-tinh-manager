-- GIAI ĐOẠN 6: Lịch sử sửa chữa của xe (xem trong trang chi tiết phiếu)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn. Không tạo bảng mới, không đổi dữ liệu.
--
-- Hàm này trả về các phiếu khác của cùng xe với phiếu p_order (mới nhất trước),
-- kèm tên phụ tùng / tiền công đã làm. KHÔNG trả về giá, giá nhập hay lợi nhuận,
-- nên Nhân viên xem được cả phiếu cũ đã thu tiền mà không lộ doanh thu.
create or replace function public.lich_su_xe(p_order uuid)
returns table (
  id uuid, code bigint, received_at timestamptz, odometer integer,
  issue text, status text, items jsonb
)
language sql stable security definer set search_path = public as $$
  select o.id, o.code, o.received_at, o.odometer, o.issue, o.status,
    coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'name', i.name, 'qty', i.qty) order by i.created_at)
              from public.repair_items i where i.order_id = o.id), '[]'::jsonb)
  from public.repair_orders o
  where public.vai_tro() is not null
    and o.vehicle_id = (select vehicle_id from public.repair_orders where id = p_order)
    and o.id <> p_order
  order by o.received_at desc, o.code desc
$$;
revoke execute on function public.lich_su_xe(uuid) from public, anon;
grant execute on function public.lich_su_xe(uuid) to authenticated;

notify pgrst, 'reload schema';
