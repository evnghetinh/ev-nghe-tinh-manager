-- GIAI ĐOẠN 12: Thông tin chuyên cho xe điện trong phiếu tiếp nhận
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu). Cần đã chạy giai-doan-4.sql và giai-doan-9.sql.
--
--  * repair_orders thêm cột: SOC, SOH, ghi chú pin, nguyên nhân hư hỏng, người tiếp nhận, lý do bỏ qua kiểm tra
--  * ev_ten_hien_thi      : tên hiển thị của tài khoản (Chủ đặt)
--  * ev_ky_thuat_vien     : danh sách kỹ thuật viên (chỉ tên); ev_phieu_ky_thuat_vien: chọn cho từng phiếu
--  * ev_ma_loi            : mã lỗi DTC của phiếu (nhiều mã, mỗi mã có ghi chú và tình trạng sau sửa)
--  * ev_kt_mau            : danh sách kiểm tra mặc định (Chủ sửa); ev_kt_phieu: kết quả kiểm tra từng phiếu
--  * ev_nhat_ky           : nhật ký sửa thông tin EV SAU KHI phiếu hoàn thành (chỉ Chủ xem)
--  * Chặn chuyển sang "Hoàn thành" khi còn mục kiểm tra chưa làm (Chủ bỏ qua được nếu nhập lý do)
--  Không có giá nhập/chi phí/lợi nhuận ở các bảng này.
--  Quyền: Nhân viên xem/nhập khi phiếu CHƯA hoàn thành; sau khi hoàn thành chỉ Chủ sửa và mọi thay đổi ghi nhật ký.

-- 1. Cột mới của phiếu --------------------------------------------------------
alter table public.repair_orders add column if not exists soc_nhan integer;
alter table public.repair_orders add column if not exists soh_nhan integer;
alter table public.repair_orders add column if not exists pin_ghi_chu text;
alter table public.repair_orders add column if not exists nguyen_nhan text;
alter table public.repair_orders add column if not exists tiep_nhan_boi uuid;
alter table public.repair_orders add column if not exists tiep_nhan_ten text;
alter table public.repair_orders add column if not exists kt_bo_qua_ly_do text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'repair_orders_soc_chk') then
    alter table public.repair_orders add constraint repair_orders_soc_chk check (soc_nhan is null or soc_nhan between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'repair_orders_soh_chk') then
    alter table public.repair_orders add constraint repair_orders_soh_chk check (soh_nhan is null or soh_nhan between 0 and 100);
  end if;
end $$;

-- 2. Bảng mới -----------------------------------------------------------------
create table if not exists public.ev_ten_hien_thi (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ten text not null check (btrim(ten) <> '')
);

create table if not exists public.ev_ky_thuat_vien (
  id uuid primary key default gen_random_uuid(),
  ten text not null check (btrim(ten) <> ''),
  dang_lam boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists ev_ktv_ten_uq on public.ev_ky_thuat_vien (lower(btrim(ten)));

create table if not exists public.ev_phieu_ky_thuat_vien (
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  ktv_id uuid not null references public.ev_ky_thuat_vien(id) on delete restrict,
  primary key (order_id, ktv_id)
);

create table if not exists public.ev_ma_loi (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  ma text not null check (btrim(ma) <> ''),
  ghi_chu text,
  sau_sua text check (sau_sua in ('da_xoa','con')),
  created_at timestamptz not null default now()
);
create index if not exists ev_ma_loi_order_idx on public.ev_ma_loi(order_id);

-- Danh sách kiểm tra mặc định: chỉ nạp 6 mục khi bảng được tạo lần đầu
do $$
declare moi boolean := to_regclass('public.ev_kt_mau') is null;
begin
  create table if not exists public.ev_kt_mau (
    id uuid primary key default gen_random_uuid(),
    thu_tu integer not null default 0,
    ten text not null check (btrim(ten) <> '')
  );
  if moi then
    insert into public.ev_kt_mau (thu_tu, ten) values
      (1,'Sạc thử'),(2,'Đo điện áp pin'),(3,'Kiểm tra phanh'),(4,'Kiểm tra đèn'),
      (5,'Đồng hồ không báo lỗi'),(6,'Chạy thử');
  end if;
end $$;

create table if not exists public.ev_kt_phieu (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  thu_tu integer not null default 0,
  ten text not null,
  ket_qua text check (ket_qua in ('dat','khong_dat')),
  ghi_chu text,
  nguoi_kt_id uuid,
  nguoi_kt_ten text,
  kt_luc timestamptz,
  unique (order_id, ten)
);
create index if not exists ev_kt_phieu_order_idx on public.ev_kt_phieu(order_id);

create table if not exists public.ev_nhat_ky (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  noi_dung text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists ev_nhat_ky_order_idx on public.ev_nhat_ky(order_id, created_at desc);

-- 3. Hàm phụ ----------------------------------------------------------------
create or replace function public.ten_nguoi_dung(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ten from public.ev_ten_hien_thi where user_id = p_uid),
    (select email::text from auth.users where id = p_uid),
    'Không rõ')
$$;
revoke execute on function public.ten_nguoi_dung(uuid) from public, anon;
grant execute on function public.ten_nguoi_dung(uuid) to authenticated;

-- Chủ xem danh sách tài khoản để đặt tên hiển thị
create or replace function public.ds_tai_khoan()
returns table (tk_id uuid, tk_email text, tk_vai_tro text, tk_ten text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem danh sách tài khoản'; end if;
  return query
    select u.id, u.email::text, r.role, t.ten
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    left join public.ev_ten_hien_thi t on t.user_id = u.id
    order by u.created_at;
end $$;
revoke execute on function public.ds_tai_khoan() from public, anon;
grant execute on function public.ds_tai_khoan() to authenticated;

create or replace function public.dat_ten_hien_thi(p_user uuid, p_ten text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_ten, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đặt tên hiển thị'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'Không tìm thấy tài khoản'; end if;
  if v = '' then
    delete from public.ev_ten_hien_thi where user_id = p_user;
  else
    insert into public.ev_ten_hien_thi (user_id, ten) values (p_user, v)
    on conflict (user_id) do update set ten = excluded.ten;
  end if;
end $$;
revoke execute on function public.dat_ten_hien_thi(uuid, text) from public, anon;
grant execute on function public.dat_ten_hien_thi(uuid, text) to authenticated;

-- Tạo danh sách kiểm tra cho phiếu từ danh sách mặc định (chỉ khi phiếu chưa có mục nào, chưa hoàn thành)
create or replace function public.khoi_tao_kiem_tra(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if not exists (select 1 from public.repair_orders where id = p_order and not stock_deducted) then return; end if;
  if exists (select 1 from public.ev_kt_phieu where order_id = p_order) then return; end if;
  insert into public.ev_kt_phieu (order_id, thu_tu, ten)
    select p_order, thu_tu, btrim(ten) from public.ev_kt_mau order by thu_tu, ten
  on conflict (order_id, ten) do nothing;
end $$;
revoke execute on function public.khoi_tao_kiem_tra(uuid) from public, anon;
grant execute on function public.khoi_tao_kiem_tra(uuid) to authenticated;

-- Chủ bỏ qua kiểm tra: bắt buộc có lý do, ghi nhật ký
create or replace function public.bo_qua_kiem_tra(p_order uuid, p_ly_do text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_ly_do, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được bỏ qua kiểm tra sau sửa'; end if;
  if v = '' then raise exception 'Hãy nhập lý do bỏ qua kiểm tra'; end if;
  if not exists (select 1 from public.repair_orders where id = p_order) then raise exception 'Không tìm thấy phiếu'; end if;
  update public.repair_orders set kt_bo_qua_ly_do = v where id = p_order;
  insert into public.ev_nhat_ky (order_id, noi_dung, created_by_name)
    values (p_order, 'Bỏ qua kiểm tra sau sửa. Lý do: ' || v, public.ten_nguoi_dung(auth.uid()));
end $$;
revoke execute on function public.bo_qua_kiem_tra(uuid, text) from public, anon;
grant execute on function public.bo_qua_kiem_tra(uuid, text) to authenticated;

-- 4. Trigger của phiếu: người tiếp nhận + chặn Hoàn thành khi chưa kiểm tra ------
create or replace function public.ev_truoc_ghi_phieu() returns trigger
language plpgsql security definer set search_path = public as $$
declare chua int;
begin
  if tg_op = 'INSERT' then
    new.tiep_nhan_boi := auth.uid();
    new.tiep_nhan_ten := case when auth.uid() is null then null else public.ten_nguoi_dung(auth.uid()) end;
    return new;
  end if;
  -- Người tiếp nhận không đổi được
  new.tiep_nhan_boi := old.tiep_nhan_boi;
  new.tiep_nhan_ten := old.tiep_nhan_ten;
  -- Lý do bỏ qua chỉ đặt qua hàm bo_qua_kiem_tra (Chủ)
  if new.kt_bo_qua_ly_do is distinct from old.kt_bo_qua_ly_do and coalesce(current_setting('app.bo_qua_kt', true), '') <> '1'
     and not public.la_chu() then
    new.kt_bo_qua_ly_do := old.kt_bo_qua_ly_do;
  end if;

  if new.status = 'Hoàn thành'
     and (old.status is distinct from 'Hoàn thành' or (new.stock_deducted and not old.stock_deducted)) then
    if not exists (select 1 from public.ev_kt_phieu where order_id = new.id) then
      insert into public.ev_kt_phieu (order_id, thu_tu, ten)
        select new.id, thu_tu, btrim(ten) from public.ev_kt_mau order by thu_tu, ten
      on conflict (order_id, ten) do nothing;
    end if;
    select count(*) into chua from public.ev_kt_phieu where order_id = new.id and ket_qua is null;
    if chua > 0 and not (public.la_chu() and btrim(coalesce(new.kt_bo_qua_ly_do, '')) <> '') then
      raise exception 'Còn % mục kiểm tra sau sửa chưa làm. Hãy kiểm tra xong rồi mới chuyển sang Hoàn thành (Chủ xưởng có thể bỏ qua nếu nhập lý do).', chua;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.ev_truoc_ghi_phieu() from public, anon, authenticated;
drop trigger if exists ev_truoc_ghi_phieu on public.repair_orders;
create trigger ev_truoc_ghi_phieu before insert or update on public.repair_orders
  for each row execute function public.ev_truoc_ghi_phieu();

-- Nhật ký khi sửa thông tin EV của phiếu ĐÃ hoàn thành
create or replace function public.ev_nhat_ky_phieu() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text; cot text[] := array['soc_nhan','soh_nhan','pin_ghi_chu','nguyen_nhan'];
        nhan text[] := array['SOC','SOH','Ghi chú pin','Nguyên nhân hư hỏng'];
        i int; ds text := '';
begin
  if not (old.stock_deducted and new.stock_deducted) then return new; end if;
  for i in 1 .. array_length(cot, 1) loop
    c := cot[i];
    if to_jsonb(new)->>c is distinct from to_jsonb(old)->>c then
      ds := ds || case when ds = '' then '' else '; ' end ||
            nhan[i] || ': "' || coalesce(to_jsonb(old)->>c, '') || '" → "' || coalesce(to_jsonb(new)->>c, '') || '"';
    end if;
  end loop;
  if ds <> '' then
    insert into public.ev_nhat_ky (order_id, noi_dung, created_by_name)
      values (new.id, 'Sửa phiếu đã hoàn thành. ' || ds, public.ten_nguoi_dung(auth.uid()));
  end if;
  return new;
end $$;
revoke execute on function public.ev_nhat_ky_phieu() from public, anon, authenticated;
drop trigger if exists ev_nhat_ky_phieu on public.repair_orders;
create trigger ev_nhat_ky_phieu after update on public.repair_orders
  for each row execute function public.ev_nhat_ky_phieu();

-- 5. Trigger bảng con ----------------------------------------------------------
-- Kết quả kiểm tra: tự ghi người kiểm tra + thời điểm
create or replace function public.ev_truoc_ghi_kt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.ket_qua is null then
      new.nguoi_kt_id := null; new.nguoi_kt_ten := null; new.kt_luc := null;
    else
      new.nguoi_kt_id := auth.uid(); new.nguoi_kt_ten := public.ten_nguoi_dung(auth.uid()); new.kt_luc := now();
    end if;
  else
    new.order_id := old.order_id;
    if new.ket_qua is distinct from old.ket_qua or new.ghi_chu is distinct from old.ghi_chu then
      if new.ket_qua is null then
        new.nguoi_kt_id := null; new.nguoi_kt_ten := null; new.kt_luc := null;
      else
        new.nguoi_kt_id := auth.uid(); new.nguoi_kt_ten := public.ten_nguoi_dung(auth.uid()); new.kt_luc := now();
      end if;
    else
      new.nguoi_kt_id := old.nguoi_kt_id; new.nguoi_kt_ten := old.nguoi_kt_ten; new.kt_luc := old.kt_luc;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.ev_truoc_ghi_kt() from public, anon, authenticated;
drop trigger if exists ev_truoc_ghi_kt on public.ev_kt_phieu;
create trigger ev_truoc_ghi_kt before insert or update on public.ev_kt_phieu
  for each row execute function public.ev_truoc_ghi_kt();

-- Nhật ký cho 3 bảng con (chỉ khi phiếu đã hoàn thành)
create or replace function public.ev_nhat_ky_con() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_order uuid; v_done boolean; s text; kq text[] := array['dat','khong_dat']; ten_kq text[] := array['Đạt','Không đạt'];
begin
  v_order := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select stock_deducted into v_done from public.repair_orders where id = v_order;
  if v_done is not true then return case when tg_op = 'DELETE' then old else new end; end if;

  if tg_table_name = 'ev_ma_loi' then
    if tg_op = 'INSERT' then s := 'Thêm mã lỗi ' || new.ma || coalesce(' (' || nullif(new.ghi_chu, '') || ')', '');
    elsif tg_op = 'DELETE' then s := 'Xóa mã lỗi ' || old.ma;
    else s := 'Sửa mã lỗi ' || old.ma || ': mã "' || old.ma || '" → "' || new.ma || '"; ghi chú "' || coalesce(old.ghi_chu, '') || '" → "' || coalesce(new.ghi_chu, '') ||
              '"; sau sửa "' || coalesce(old.sau_sua, '') || '" → "' || coalesce(new.sau_sua, '') || '"';
    end if;
  elsif tg_table_name = 'ev_kt_phieu' then
    if tg_op = 'UPDATE' then
      s := 'Sửa kiểm tra "' || new.ten || '": ' || coalesce(old.ket_qua, 'chưa làm') || ' → ' || coalesce(new.ket_qua, 'chưa làm') ||
           '; ghi chú "' || coalesce(old.ghi_chu, '') || '" → "' || coalesce(new.ghi_chu, '') || '"';
    elsif tg_op = 'INSERT' then s := 'Thêm mục kiểm tra "' || new.ten || '"';
    else s := 'Xóa mục kiểm tra "' || old.ten || '"';
    end if;
  else
    if tg_op = 'INSERT' then s := 'Thêm kỹ thuật viên: ' || (select ten from public.ev_ky_thuat_vien where id = new.ktv_id);
    else s := 'Bỏ kỹ thuật viên: ' || coalesce((select ten from public.ev_ky_thuat_vien where id = old.ktv_id), '?');
    end if;
  end if;
  insert into public.ev_nhat_ky (order_id, noi_dung, created_by_name)
    values (v_order, s, public.ten_nguoi_dung(auth.uid()));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.ev_nhat_ky_con() from public, anon, authenticated;
drop trigger if exists ev_nhat_ky_con on public.ev_ma_loi;
create trigger ev_nhat_ky_con after insert or update or delete on public.ev_ma_loi for each row execute function public.ev_nhat_ky_con();
drop trigger if exists ev_nhat_ky_con on public.ev_kt_phieu;
create trigger ev_nhat_ky_con after insert or update or delete on public.ev_kt_phieu for each row execute function public.ev_nhat_ky_con();
drop trigger if exists ev_nhat_ky_con on public.ev_phieu_ky_thuat_vien;
create trigger ev_nhat_ky_con after insert or delete on public.ev_phieu_ky_thuat_vien for each row execute function public.ev_nhat_ky_con();

-- 6. Bảo mật RLS ----------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ev_ten_hien_thi','ev_ky_thuat_vien','ev_phieu_ky_thuat_vien','ev_ma_loi','ev_kt_mau','ev_kt_phieu','ev_nhat_ky'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- Tên hiển thị: ai có vai trò cũng đọc được, ghi chỉ qua hàm dat_ten_hien_thi
grant select on public.ev_ten_hien_thi to authenticated;
drop policy if exists vt_xem on public.ev_ten_hien_thi;
create policy vt_xem on public.ev_ten_hien_thi for select to authenticated using (public.vai_tro() is not null);

-- Danh mục (kỹ thuật viên, mẫu kiểm tra): mọi vai trò xem, chỉ Chủ ghi
do $$
declare t text;
begin
  foreach t in array array['ev_ky_thuat_vien','ev_kt_mau'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists vt_xem on public.%I', t);
    execute format('drop policy if exists vt_chi_chu on public.%I', t);
    execute format('create policy vt_xem on public.%I for select to authenticated using (public.vai_tro() is not null)', t);
    execute format('create policy vt_chi_chu on public.%I for all to authenticated using (public.la_chu()) with check (public.la_chu())', t);
  end loop;
end $$;

-- Dữ liệu theo phiếu: Chủ tất cả; Nhân viên chỉ ghi khi phiếu chưa hoàn thành
do $$
declare t text;
begin
  foreach t in array array['ev_phieu_ky_thuat_vien','ev_ma_loi','ev_kt_phieu'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists vt_xem on public.%I', t);
    execute format('drop policy if exists vt_chu on public.%I', t);
    execute format('drop policy if exists vt_nhan_vien on public.%I', t);
    execute format('create policy vt_xem on public.%I for select to authenticated using (public.vai_tro() is not null)', t);
    execute format('create policy vt_chu on public.%I for all to authenticated using (public.la_chu()) with check (public.la_chu())', t);
    execute format('create policy vt_nhan_vien on public.%I for all to authenticated using (public.vai_tro() = ''nhan_vien'' and public.phieu_dang_mo(order_id)) with check (public.vai_tro() = ''nhan_vien'' and public.phieu_dang_mo(order_id))', t);
  end loop;
end $$;

-- Nhật ký: chỉ Chủ xem; ghi chỉ qua trigger/hàm
grant select on public.ev_nhat_ky to authenticated;
drop policy if exists vt_chi_chu_xem on public.ev_nhat_ky;
create policy vt_chi_chu_xem on public.ev_nhat_ky for select to authenticated using (public.la_chu());

notify pgrst, 'reload schema';

-- Kiểm tra: cả 7 dòng phải hiện da_bat_bao_mat = true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables where schemaname = 'public'
  and tablename in ('ev_ten_hien_thi','ev_ky_thuat_vien','ev_phieu_ky_thuat_vien','ev_ma_loi','ev_kt_mau','ev_kt_phieu','ev_nhat_ky')
order by tablename;
