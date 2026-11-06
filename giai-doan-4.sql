-- GIAI ĐOẠN 4: Phân quyền Chủ xưởng / Nhân viên (bảo mật ở phía cơ sở dữ liệu)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không đổi vai trò đã có).
--
-- Kết quả:
--  * Mọi tài khoản đang có -> vai trò "chu" (Chủ xưởng). Tài khoản tạo mới -> "nhan_vien" (Nhân viên).
--  * Giá nhập chuyển sang bảng riêng chỉ Chủ đọc được: part_costs, repair_item_costs.
--  * Nhân viên không đọc được dòng báo giá của phiếu ĐÃ thu tiền => không tính được doanh thu.
--
-- Đổi vai trò một người (chạy trong SQL Editor):
--   update public.user_roles set role = 'nhan_vien'
--   where user_id = (select id from auth.users where email = 'email@vi-du.com');
--
-- LƯU Ý: sau file này KHÔNG chạy lại giai-doan-2.sql và giai-doan-3.sql (đã có chốt chặn).

-- 1. Bảng vai trò ---------------------------------------------------------
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'nhan_vien' check (role in ('chu','nhan_vien')),
  created_at timestamptz not null default now()
);

-- Mọi tài khoản đang có chưa có vai trò -> Chủ (không đụng tài khoản đã có vai trò)
insert into public.user_roles (user_id, role)
select id, 'chu' from auth.users
on conflict (user_id) do nothing;

-- Hàm kiểm tra vai trò (security definer để chính sách RLS dùng được, không bị vòng lặp)
create or replace function public.vai_tro() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;
create or replace function public.la_chu() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'chu' from public.user_roles where user_id = auth.uid()), false)
$$;
revoke execute on function public.vai_tro() from public, anon;
revoke execute on function public.la_chu() from public, anon;
grant execute on function public.vai_tro() to authenticated;
grant execute on function public.la_chu() to authenticated;

-- Tài khoản mới tạo -> mặc định Nhân viên (an toàn nhất)
create or replace function public.gan_vai_tro_mac_dinh() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles (user_id, role) values (new.id, 'nhan_vien') on conflict do nothing;
  return new;
end $$;
drop trigger if exists gan_vai_tro_mac_dinh on auth.users;
create trigger gan_vai_tro_mac_dinh after insert on auth.users
  for each row execute function public.gan_vai_tro_mac_dinh();

-- 2. Giá nhập sang bảng riêng (chỉ Chủ) ------------------------------------
create table if not exists public.part_costs (
  part_id uuid primary key references public.parts(id) on delete cascade,
  cost_price numeric(14,0) not null default 0 check (cost_price >= 0)
);
create table if not exists public.repair_item_costs (
  item_id uuid primary key references public.repair_items(id) on delete cascade,
  cost_price numeric(14,0) not null default 0 check (cost_price >= 0)
);

-- Chuyển dữ liệu giá nhập cũ rồi xóa cột cũ (chỉ làm khi cột còn tồn tại)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='parts' and column_name='cost_price') then
    execute 'insert into public.part_costs (part_id, cost_price) select id, cost_price from public.parts on conflict (part_id) do nothing';
    execute 'alter table public.parts drop column cost_price';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='repair_items' and column_name='cost_price') then
    execute 'insert into public.repair_item_costs (item_id, cost_price) select id, cost_price from public.repair_items where kind = ''part'' on conflict (item_id) do nothing';
    execute 'alter table public.repair_items drop column cost_price';
  end if;
end $$;

-- 3. Hoàn thành phiếu: chạy với quyền hệ thống để chốt giá nhập, nhưng chỉ cho người có vai trò
create or replace function public.hoan_thanh_phieu(p_order uuid, p_method text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare o record; r record;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
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

  insert into public.repair_item_costs (item_id, cost_price)
    select i.id, coalesce(c.cost_price, 0)
    from public.repair_items i left join public.part_costs c on c.part_id = i.part_id
    where i.order_id = p_order and i.kind = 'part'
  on conflict (item_id) do update set cost_price = excluded.cost_price;

  update public.repair_orders set status = 'Hoàn thành', payment_method = p_method,
    paid_at = coalesce(p_date, current_date), stock_deducted = true where id = p_order;
end $$;
revoke execute on function public.hoan_thanh_phieu(uuid, text, date) from public, anon;
grant execute on function public.hoan_thanh_phieu(uuid, text, date) to authenticated;

-- Phiếu còn mở (chưa thu tiền)? Dùng cho chính sách của Nhân viên
create or replace function public.phieu_dang_mo(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not stock_deducted from public.repair_orders where id = p_order), false)
$$;
revoke execute on function public.phieu_dang_mo(uuid) from public, anon;
grant execute on function public.phieu_dang_mo(uuid) to authenticated;

-- 4. Bảo mật RLS theo vai trò -------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_roles','customers','vehicles','repair_orders','parts','repair_items','part_costs','repair_item_costs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', 'chi_nguoi_dang_nhap', t); -- bỏ chính sách cũ "ai đăng nhập cũng được"
  end loop;
  -- user_roles: chỉ đọc (đổi vai trò làm trong SQL Editor, không ai tự nâng quyền được)
  revoke all on public.user_roles from authenticated;
  grant select on public.user_roles to authenticated;
  foreach t in array array['customers','vehicles','repair_orders','parts','repair_items','part_costs','repair_item_costs'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- user_roles: mỗi người thấy vai trò của mình, Chủ thấy tất cả
drop policy if exists vt_xem on public.user_roles;
create policy vt_xem on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.la_chu());

-- Giá nhập: chỉ Chủ
drop policy if exists vt_chi_chu on public.part_costs;
create policy vt_chi_chu on public.part_costs for all to authenticated
  using (public.la_chu()) with check (public.la_chu());
drop policy if exists vt_chi_chu on public.repair_item_costs;
create policy vt_chi_chu on public.repair_item_costs for all to authenticated
  using (public.la_chu()) with check (public.la_chu());

-- Phụ tùng (không còn giá nhập): cả hai vai trò dùng được
drop policy if exists vt_moi_vai_tro on public.parts;
create policy vt_moi_vai_tro on public.parts for all to authenticated
  using (public.vai_tro() is not null) with check (public.vai_tro() is not null);

-- Khách hàng: cả hai vai trò; Nhân viên không xóa được khách đã có phiếu thu tiền (tránh mất doanh thu)
drop policy if exists vt_xem on public.customers;
drop policy if exists vt_them on public.customers;
drop policy if exists vt_sua on public.customers;
drop policy if exists vt_xoa on public.customers;
create policy vt_xem on public.customers for select to authenticated using (public.vai_tro() is not null);
create policy vt_them on public.customers for insert to authenticated with check (public.vai_tro() is not null);
create policy vt_sua on public.customers for update to authenticated
  using (public.vai_tro() is not null) with check (public.vai_tro() is not null);
create policy vt_xoa on public.customers for delete to authenticated
  using (public.la_chu() or (public.vai_tro() = 'nhan_vien'
    and not exists (select 1 from public.repair_orders o where o.customer_id = customers.id and o.stock_deducted)));

-- Xe: tương tự khách hàng
drop policy if exists vt_xem on public.vehicles;
drop policy if exists vt_them on public.vehicles;
drop policy if exists vt_sua on public.vehicles;
drop policy if exists vt_xoa on public.vehicles;
create policy vt_xem on public.vehicles for select to authenticated using (public.vai_tro() is not null);
create policy vt_them on public.vehicles for insert to authenticated with check (public.vai_tro() is not null);
create policy vt_sua on public.vehicles for update to authenticated
  using (public.vai_tro() is not null) with check (public.vai_tro() is not null);
create policy vt_xoa on public.vehicles for delete to authenticated
  using (public.la_chu() or (public.vai_tro() = 'nhan_vien'
    and not exists (select 1 from public.repair_orders o where o.vehicle_id = vehicles.id and o.stock_deducted)));

-- Phiếu tiếp nhận: Nhân viên chỉ sửa/xóa phiếu chưa thu tiền, không tự đánh dấu "đã thu"
drop policy if exists vt_xem on public.repair_orders;
drop policy if exists vt_them on public.repair_orders;
drop policy if exists vt_sua on public.repair_orders;
drop policy if exists vt_xoa on public.repair_orders;
create policy vt_xem on public.repair_orders for select to authenticated using (public.vai_tro() is not null);
create policy vt_them on public.repair_orders for insert to authenticated
  with check (public.la_chu() or (public.vai_tro() = 'nhan_vien' and not stock_deducted));
create policy vt_sua on public.repair_orders for update to authenticated
  using (public.la_chu() or (public.vai_tro() = 'nhan_vien' and not stock_deducted))
  with check (public.la_chu() or (public.vai_tro() = 'nhan_vien' and not stock_deducted));
create policy vt_xoa on public.repair_orders for delete to authenticated
  using (public.la_chu() or (public.vai_tro() = 'nhan_vien' and not stock_deducted));

-- Dòng báo giá: Chủ tất cả; Nhân viên chỉ thấy/sửa dòng của phiếu chưa thu tiền
drop policy if exists vt_chu on public.repair_items;
create policy vt_chu on public.repair_items for all to authenticated
  using (public.la_chu()) with check (public.la_chu());
drop policy if exists vt_nhan_vien on public.repair_items;
create policy vt_nhan_vien on public.repair_items for all to authenticated
  using (public.vai_tro() = 'nhan_vien' and public.phieu_dang_mo(order_id))
  with check (public.vai_tro() = 'nhan_vien' and public.phieu_dang_mo(order_id));

notify pgrst, 'reload schema';

-- Kiểm tra: danh sách tài khoản và vai trò (tất cả hiện "chu"), rồi trạng thái bảo mật (đều true)
select u.email, r.role as vai_tro
from auth.users u left join public.user_roles r on r.user_id = u.id
order by u.created_at;

select tablename, rowsecurity as da_bat_bao_mat
from pg_tables
where schemaname = 'public'
  and tablename in ('user_roles','customers','vehicles','repair_orders','parts','repair_items','part_costs','repair_item_costs')
order by tablename;
