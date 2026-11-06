-- GIAI ĐOẠN 3: Hoàn thành và thu tiền, tự trừ tồn kho, tổng quan doanh thu
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không trừ kho thêm).

-- CHỐT CHẶN: đã nâng cấp giai đoạn 4 (phân quyền) thì không chạy lại file này
do $$ begin
  if to_regclass('public.user_roles') is not null then
    raise exception 'Đã nâng cấp lên giai đoạn 4, không chạy lại file này. Dùng giai-doan-4.sql.';
  end if;
end $$;

alter table public.repair_orders add column if not exists payment_method text check (payment_method in ('Tiền mặt','Chuyển khoản'));
alter table public.repair_orders add column if not exists paid_at date;
alter table public.repair_orders add column if not exists stock_deducted boolean not null default false;
alter table public.repair_items add column if not exists cost_price numeric(14,0) not null default 0;
alter table public.parts add column if not exists min_stock numeric(12,2) not null default 3;

-- Hoàn thành phiếu: thu tiền + trừ kho + chốt giá nhập, chỉ làm một lần (khóa dòng để không trừ 2 lần)
create or replace function public.hoan_thanh_phieu(p_order uuid, p_method text, p_date date)
returns void language plpgsql security invoker as $$
declare o record; r record;
begin
  if p_method not in ('Tiền mặt','Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.stock_deducted then raise exception 'Phiếu này đã hoàn thành và thu tiền rồi'; end if;

  for r in select part_id, sum(qty) as qty from public.repair_items
           where order_id = p_order and kind = 'part' and part_id is not null group by part_id loop
    update public.parts set stock = stock - r.qty where id = r.part_id and stock >= r.qty;
    if not found then
      raise exception 'Không đủ tồn kho cho phụ tùng: %', (select name from public.parts where id = r.part_id);
    end if;
  end loop;

  update public.repair_items i set cost_price = p.cost_price
    from public.parts p where i.part_id = p.id and i.order_id = p_order and i.kind = 'part';

  update public.repair_orders set status = 'Hoàn thành', payment_method = p_method,
    paid_at = coalesce(p_date, current_date), stock_deducted = true where id = p_order;
end $$;

revoke execute on function public.hoan_thanh_phieu(uuid, text, date) from public, anon;
grant execute on function public.hoan_thanh_phieu(uuid, text, date) to authenticated;

-- Bảo mật RLS (đã bật từ trước, bật lại cho chắc)
do $$
declare t text;
begin
  foreach t in array array['parts','repair_items','repair_orders'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Kiểm tra: cả ba bảng phải hiện true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables where schemaname = 'public' and tablename in ('parts','repair_items','repair_orders');
