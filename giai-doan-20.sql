-- GIAI ĐOẠN 20: Siết chặt chống sửa/xóa dữ liệu tài chính và kho + Nhật ký hoạt động (audit log)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không ghi trùng). Cần đã chạy giai-doan-4 ... 16.
-- Số liệu doanh thu, lợi nhuận, tồn kho cũ KHÔNG đổi: file này không sửa dòng phiếu, giá, tồn kho nào.
--
-- ===== BÁO CÁO RÀ SOÁT: những chỗ còn hở trước giai đoạn 20 =====
--  1. Phiếu sửa chữa: Chủ xóa cứng được phiếu đã thu tiền; xóa khách/xe còn kéo theo xóa luôn phiếu đã thu
--     (mất doanh thu, mất sổ kho). Nhân viên đặt được trạng thái "Hoàn thành" bằng tay, sửa được cột thu tiền.
--  2. Dòng phiếu (repair_items): Nhân viên ghi/xóa thẳng vào bảng, giá do giao diện gửi lên (giả được).
--  3. Khoản thu: chưa có sổ riêng; tiền thu nằm trong cột của phiếu, không hủy/không điều chỉnh có dấu vết.
--  4. Chi phí phiếu: chi_phi_xoa xóa cứng dòng chi phí; chi_phi_sua đổi số tiền (chỉ có nhật ký riêng từng phiếu).
--  5. Phụ tùng: Nhân viên sửa giá bán, xóa phụ tùng (tồn mất theo); xóa phụ tùng đã có lịch sử kho.
--  6. Vốn / chi phí vận hành / lợi nhuận nhập tay (5 bảng von_*): Chủ sửa & xóa cứng thẳng, không để lại dấu vết.
--  7. Nhật ký cũ (repair_edit_logs, repair_cost_logs, ev_nhat_ky, stock_import_logs): chưa chặn sửa/xóa/truncate.
--  8. Cột người thực hiện/thời gian của chi phí, vốn... chưa có hoặc do phía ứng dụng gửi lên.
--  9. Tên hiển thị tài khoản được phép để trống; chưa có nhật ký chung nên phải mở từng phiếu mới thấy lịch sử.
--
-- ===== SAU KHI CHẠY =====
--  * nhat_ky_hoat_dong: nhật ký chung, CHỈ THÊM dòng (chặn sửa/xóa/truncate bằng trigger, kể cả Chủ).
--  * Trigger ghi nhật ký tự động ở mọi bảng tài chính + kho (không phụ thuộc giao diện).
--  * order_payments: sổ khoản thu (thu / điều chỉnh / đảo). Doanh thu vẫn tính từ dòng phiếu như cũ.
--  * Phiếu đã có dòng / đã thu / đã trừ kho: không xóa cứng; Chủ "Hủy phiếu" (lý do bắt buộc).
--    Nhân viên chỉ xóa được phiếu nháp (xoa_phieu_nhap).
--  * Khoản thu: Chủ "Hủy khoản thu" (lý do bắt buộc), muốn sửa số tiền thì hủy rồi ghi khoản mới.
--  * Chi phí phiếu và 4 bảng vốn: không xóa cứng, chỉ "Hủy" có lý do (dòng được giữ, đánh dấu đã hủy).
--  * Mọi dòng thu / chi phí / nhập / xuất / điều chỉnh có người thực hiện + thời gian do máy chủ đặt.
--  * Mọi tài khoản đều có tên hiển thị (tài khoản cũ nhận tạm phần trước @ của email; Chủ đặt lại ở Cài đặt).

-- 0. Hàm phụ ------------------------------------------------------------------------------------
create or replace function public.ngay_hom_nay() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- 1. Tên hiển thị bắt buộc -----------------------------------------------------------------------
alter table public.ev_ten_hien_thi add column if not exists ten_mac_dinh boolean not null default false;

do $$
begin
  perform set_config('app.bo_qua_nhat_ky', '1', true);
  insert into public.ev_ten_hien_thi (user_id, ten, ten_mac_dinh)
  select x.id,
         x.goc || case when x.rn > 1 then x.rn::text else '' end,
         true
  from (
    select u.id,
           coalesce(nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''), 'TK' || substr(u.id::text, 1, 4)) as goc,
           row_number() over (partition by lower(coalesce(nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''), 'TK' || substr(u.id::text, 1, 4))) order by u.created_at, u.id) as rn
    from auth.users u
    where not exists (select 1 from public.ev_ten_hien_thi t where t.user_id = u.id)
  ) x
  on conflict (user_id) do nothing;
  perform set_config('app.bo_qua_nhat_ky', '', true);
end $$;

-- Tài khoản tạo mới -> tự có tên tạm (Chủ đặt lại ở Cài đặt)
create or replace function public.gan_ten_mac_dinh() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text := coalesce(nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''), 'TK' || substr(new.id::text, 1, 4));
begin
  if exists (select 1 from public.ev_ten_hien_thi where lower(ten) = lower(v)) then v := v || '-' || substr(new.id::text, 1, 4); end if;
  insert into public.ev_ten_hien_thi (user_id, ten, ten_mac_dinh) values (new.id, v, true) on conflict (user_id) do nothing;
  return new;
end $$;
revoke execute on function public.gan_ten_mac_dinh() from public, anon, authenticated;
drop trigger if exists gan_ten_mac_dinh on auth.users;
create trigger gan_ten_mac_dinh after insert on auth.users for each row execute function public.gan_ten_mac_dinh();

create or replace function public.dat_ten_hien_thi(p_user uuid, p_ten text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_ten, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đặt tên hiển thị'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'Không tìm thấy tài khoản'; end if;
  if v = '' then raise exception 'Bắt buộc nhập tên hiển thị cho mọi tài khoản (ví dụ KTV02)'; end if;
  if char_length(v) > 40 then raise exception 'Tên hiển thị tối đa 40 ký tự'; end if;
  if exists (select 1 from public.ev_ten_hien_thi where user_id <> p_user and lower(btrim(ten)) = lower(v)) then
    raise exception 'Tên "%" đã được tài khoản khác dùng', v;
  end if;
  insert into public.ev_ten_hien_thi (user_id, ten, ten_mac_dinh) values (p_user, v, false)
  on conflict (user_id) do update set ten = excluded.ten, ten_mac_dinh = false;
end $$;
revoke execute on function public.dat_ten_hien_thi(uuid, text) from public, anon;
grant execute on function public.dat_ten_hien_thi(uuid, text) to authenticated;

drop function if exists public.ds_tai_khoan();
create function public.ds_tai_khoan()
returns table (tk_id uuid, tk_email text, tk_vai_tro text, tk_ten text, tk_ten_tam boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem danh sách tài khoản'; end if;
  return query
    select u.id, u.email::text, r.role, t.ten, coalesce(t.ten_mac_dinh, true)
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    left join public.ev_ten_hien_thi t on t.user_id = u.id
    order by u.created_at;
end $$;
revoke execute on function public.ds_tai_khoan() from public, anon;
grant execute on function public.ds_tai_khoan() to authenticated;

-- 2. Bảng nhật ký hoạt động (chỉ thêm dòng) ---------------------------------------------------------
create table if not exists public.nhat_ky_hoat_dong (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),         -- giờ máy chủ
  user_id uuid,
  email text,
  ten_hien_thi text,
  vai_tro text,
  hanh_dong text not null,
  loai_doi_tuong text not null,
  ma_doi_tuong text,        -- mã phiếu (PT0012), mã phụ tùng...
  ten_doi_tuong text,       -- tên phụ tùng, nội dung chi phí...
  ma_phieu bigint,
  bang text,
  ban_ghi_id uuid,
  truoc jsonb,
  sau jsonb,
  ly_do text,
  nguon text,               -- chỉ dùng khi chép nhật ký cũ sang (chống ghi trùng)
  nguon_id uuid
);
create index if not exists nhat_ky_seq_idx on public.nhat_ky_hoat_dong (seq desc);
create index if not exists nhat_ky_time_idx on public.nhat_ky_hoat_dong (created_at desc);
create index if not exists nhat_ky_phieu_idx on public.nhat_ky_hoat_dong (ma_phieu);
create unique index if not exists nhat_ky_nguon_uq on public.nhat_ky_hoat_dong (nguon, nguon_id) where nguon is not null;

-- Chặn sửa/xóa/truncate. Nhật ký chung: tuyệt đối. Nhật ký cũ: chỉ cho phép (a) tự về null khi tài khoản bị xóa,
-- (b) xóa theo khi xóa phiếu NHÁP (cờ app.xoa_phieu do hàm xoa_phieu_nhap đặt).
create or replace function public.chan_sua_xoa_nhat_ky() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Không được xóa sạch bảng % (dữ liệu tài chính/nhật ký)', tg_table_name;
  end if;
  if tg_table_name <> 'nhat_ky_hoat_dong' then
    if tg_op = 'DELETE' and coalesce(current_setting('app.xoa_phieu', true), '') = '1' then return old; end if;
    if tg_op = 'UPDATE' and to_jsonb(old)->>'created_by' is not null and to_jsonb(new)->>'created_by' is null
       and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
      return new;
    end if;
  end if;
  raise exception 'Nhật ký chỉ được thêm dòng, không được sửa hoặc xóa (bảng %)', tg_table_name;
end $$;
revoke execute on function public.chan_sua_xoa_nhat_ky() from public, anon, authenticated;

drop trigger if exists chan_sua_xoa on public.nhat_ky_hoat_dong;
create trigger chan_sua_xoa before update or delete on public.nhat_ky_hoat_dong
  for each row execute function public.chan_sua_xoa_nhat_ky();
drop trigger if exists chan_truncate on public.nhat_ky_hoat_dong;
create trigger chan_truncate before truncate on public.nhat_ky_hoat_dong
  for each statement execute function public.chan_sua_xoa_nhat_ky();

alter table public.nhat_ky_hoat_dong enable row level security;
revoke all on public.nhat_ky_hoat_dong from anon;
revoke all on public.nhat_ky_hoat_dong from authenticated;
grant select on public.nhat_ky_hoat_dong to authenticated;
drop policy if exists nkhd_chi_chu_xem on public.nhat_ky_hoat_dong;
create policy nkhd_chi_chu_xem on public.nhat_ky_hoat_dong for select to authenticated using (public.la_chu());

-- Nhật ký cũ (từng phiếu / từng lần nhập) cũng chỉ thêm dòng: dùng lại, không tạo nhật ký thứ hai cho cùng việc
do $$
declare t text;
begin
  foreach t in array array['repair_edit_logs','repair_cost_logs','ev_nhat_ky','stock_import_logs'] loop
    execute format('drop trigger if exists chan_sua_xoa on public.%I', t);
    execute format('drop trigger if exists chan_truncate on public.%I', t);
    execute format('create trigger chan_sua_xoa before update or delete on public.%I for each row execute function public.chan_sua_xoa_nhat_ky()', t);
    execute format('create trigger chan_truncate before truncate on public.%I for each statement execute function public.chan_sua_xoa_nhat_ky()', t);
  end loop;
end $$;

-- 3. Cột mới ------------------------------------------------------------------------------------
-- 3a. Phiếu: hủy phiếu
alter table public.repair_orders add column if not exists da_huy boolean not null default false;
alter table public.repair_orders add column if not exists huy_ly_do text;
alter table public.repair_orders add column if not exists huy_boi uuid;
alter table public.repair_orders add column if not exists huy_boi_ten text;
alter table public.repair_orders add column if not exists huy_luc timestamptz;

-- 3b. Chi phí phiếu: người thực hiện + hủy (không xóa cứng)
alter table public.repair_costs add column if not exists created_by uuid;
alter table public.repair_costs add column if not exists created_by_name text;
alter table public.repair_costs add column if not exists da_huy boolean not null default false;
alter table public.repair_costs add column if not exists huy_ly_do text;
alter table public.repair_costs add column if not exists huy_boi uuid;
alter table public.repair_costs add column if not exists huy_boi_ten text;
alter table public.repair_costs add column if not exists huy_luc timestamptz;

-- 3c. Bốn bảng vốn: người thực hiện + hủy
do $$
declare t text;
begin
  foreach t in array array['von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu'] loop
    execute format('alter table public.%I add column if not exists created_by uuid', t);
    execute format('alter table public.%I add column if not exists created_by_name text', t);
    execute format('alter table public.%I add column if not exists da_huy boolean not null default false', t);
    execute format('alter table public.%I add column if not exists huy_ly_do text', t);
    execute format('alter table public.%I add column if not exists huy_boi uuid', t);
    execute format('alter table public.%I add column if not exists huy_boi_ten text', t);
    execute format('alter table public.%I add column if not exists huy_luc timestamptz', t);
  end loop;
end $$;

-- 3d. Sổ kho: số lượng trước (tính sẵn từ tồn sau - số thay đổi) + loại "huy_phieu"
alter table public.stock_ledger add column if not exists ton_truoc numeric(14,3) generated always as (ton_sau - so_luong) stored;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.stock_ledger'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%loai%' and pg_get_constraintdef(oid) not like '%huy_phieu%' loop
    execute format('alter table public.stock_ledger drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.stock_ledger'::regclass and conname = 'stock_ledger_loai_ok') then
    alter table public.stock_ledger add constraint stock_ledger_loai_ok
      check (loai in ('ton_dau','nhap_hang','xuat_phieu','them_khi_sua','xoa_khi_sua','khach_tra','kiem_ke','huy_nhap_hang','doi_don_vi','huy_phieu'));
  end if;
  -- Điều chỉnh/hủy/trả hàng luôn phải có lý do (NOT VALID: chỉ áp cho dòng mới, dòng cũ giữ nguyên)
  if not exists (select 1 from pg_constraint where conrelid = 'public.stock_ledger'::regclass and conname = 'stock_ledger_ly_do_ok') then
    alter table public.stock_ledger add constraint stock_ledger_ly_do_ok
      check (loai not in ('kiem_ke','khach_tra','huy_phieu','huy_nhap_hang') or btrim(coalesce(ghi_chu, '')) <> '') not valid;
  end if;
end $$;

-- 3e. Nhật ký chi phí: thêm hành động "huy"
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.repair_cost_logs'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%action%' and pg_get_constraintdef(oid) not like '%huy%' loop
    execute format('alter table public.repair_cost_logs drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.repair_cost_logs'::regclass and conname = 'repair_cost_logs_action_ok') then
    alter table public.repair_cost_logs add constraint repair_cost_logs_action_ok check (action in ('them','sua','xoa','huy'));
  end if;
end $$;

-- 3f. Sổ khoản thu
create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  order_id uuid not null references public.repair_orders(id) on delete restrict,
  loai text not null check (loai in ('thu','dieu_chinh','dao')),     -- thu: khoản thu; dieu_chinh: sửa phiếu sau khi thu; dao: đảo khi hủy phiếu
  so_tien numeric(18,3) not null,
  hinh_thuc text not null default 'Tiền mặt' check (hinh_thuc in ('Tiền mặt','Chuyển khoản')),
  ngay_thu date not null default public.ngay_hom_nay(),
  ghi_chu text,
  ref_id uuid,                                                         -- dòng "dao" trỏ về khoản thu bị đảo
  da_huy boolean not null default false,
  huy_ly_do text,
  huy_boi uuid,
  huy_boi_ten text,
  huy_luc timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  check ((loai = 'thu' and so_tien >= 0) or (loai <> 'thu' and so_tien <> 0)),
  check (not da_huy or btrim(coalesce(huy_ly_do, '')) <> '')
);
create index if not exists order_payments_order_idx on public.order_payments (order_id, seq);

-- Phiếu cũ đã hoàn thành -> mỗi phiếu 1 khoản thu bằng đúng tổng dòng phiếu (không đụng số liệu cũ). Chỉ chạy cho phiếu chưa có khoản thu.
do $$
declare n int;
begin
  perform set_config('app.bo_qua_nhat_ky', '1', true);
  insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu, created_by_name, created_at)
  select o.id, 'thu',
         coalesce((select sum(i.qty * i.unit_price) from public.repair_items i where i.order_id = o.id), 0),
         coalesce(o.payment_method, 'Tiền mặt'), coalesce(o.paid_at, o.created_at::date),
         'Dữ liệu cũ (chuyển sang sổ khoản thu ở giai đoạn 20)', 'Dữ liệu cũ', coalesce(o.paid_at::timestamptz, o.created_at)
  from public.repair_orders o
  where o.stock_deducted and not o.da_huy and not exists (select 1 from public.order_payments p where p.order_id = o.id);
  get diagnostics n = row_count;
  perform set_config('app.bo_qua_nhat_ky', '', true);
  if n > 0 then
    insert into public.nhat_ky_hoat_dong (ten_hien_thi, hanh_dong, loai_doi_tuong, bang, ly_do, sau)
    values ('Hệ thống / SQL Editor', 'khoi_tao', 'Sổ khoản thu', 'order_payments',
            'Chuyển phiếu đã hoàn thành sang sổ khoản thu (giai đoạn 20)', jsonb_build_object('so_khoan', n));
  end if;
end $$;

-- 4. Người thực hiện + thời gian do MÁY CHỦ đặt (người dùng không đặt được) ----------------------------
-- Khi có người đăng nhập (auth.uid() không rỗng): ghi đè created_by / created_by_name / created_at và xóa mọi dấu "đã hủy" gửi lên.
-- Khi chạy từ SQL Editor / chuyển dữ liệu cũ (không có người đăng nhập): giữ giá trị được truyền.
create or replace function public.ep_nguoi_thuc_hien() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb := to_jsonb(new); o jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    if v ? 'created_by_name' and nullif(btrim(coalesce(v->>'created_by_name', '')), '') is null then
      o := o || jsonb_build_object('created_by_name', 'Hệ thống / SQL Editor');
    end if;
  else
    if v ? 'created_by' then o := o || jsonb_build_object('created_by', auth.uid()); end if;
    if v ? 'created_by_name' then o := o || jsonb_build_object('created_by_name', public.ten_nguoi_dung(auth.uid())); end if;
    if v ? 'created_at' then o := o || jsonb_build_object('created_at', now()); end if;
    if v ? 'da_huy' then
      o := o || jsonb_build_object('da_huy', false, 'huy_ly_do', null, 'huy_boi', null, 'huy_boi_ten', null, 'huy_luc', null);
    end if;
  end if;
  if o <> '{}'::jsonb then new := jsonb_populate_record(new, o); end if;
  return new;
end $$;
revoke execute on function public.ep_nguoi_thuc_hien() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['repair_costs','order_payments','stock_imports','stock_ledger','repair_edit_logs','repair_cost_logs',
                           'stock_import_logs','ev_nhat_ky','von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu'] loop
    execute format('drop trigger if exists ep_nguoi_thuc_hien on public.%I', t);
    execute format('create trigger ep_nguoi_thuc_hien before insert on public.%I for each row execute function public.ep_nguoi_thuc_hien()', t);
  end loop;
end $$;

-- 5. Ghi nhật ký tự động bằng trigger ----------------------------------------------------------------
-- Hàm ghi 1 dòng (người thực hiện lấy từ phiên đăng nhập; giờ lấy từ máy chủ)
create or replace function public.ghi_nhat_ky(p_hanh_dong text, p_loai text, p_ma text, p_ten text, p_ma_phieu bigint,
                                              p_bang text, p_id uuid, p_truoc jsonb, p_sau jsonb, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_ten text; v_role text;
begin
  if coalesce(current_setting('app.bo_qua_nhat_ky', true), '') = '1' then return; end if;
  if v_uid is not null then
    select email::text into v_email from auth.users where id = v_uid;
    v_ten := public.ten_nguoi_dung(v_uid);
    select role into v_role from public.user_roles where user_id = v_uid;
  else
    v_ten := 'Hệ thống / SQL Editor';
  end if;
  insert into public.nhat_ky_hoat_dong (user_id, email, ten_hien_thi, vai_tro, hanh_dong, loai_doi_tuong, ma_doi_tuong, ten_doi_tuong,
                                        ma_phieu, bang, ban_ghi_id, truoc, sau, ly_do)
  values (v_uid, v_email, v_ten, v_role, p_hanh_dong, p_loai, p_ma, p_ten, p_ma_phieu, p_bang, p_id, p_truoc, p_sau, nullif(btrim(coalesce(p_ly_do, '')), ''));
end $$;
revoke execute on function public.ghi_nhat_ky(text, text, text, text, bigint, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;

-- Trigger chung cho mọi bảng tài chính + kho. Chỉ ghi các cột THAY ĐỔI (trước/sau) khi sửa.
create or replace function public.nhat_ky_tu_dong() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t text := tg_table_name; op text := tg_op;
  vn jsonb; vo jsonb; vr jsonb; k text; tr jsonb; sa jsonb;
  hd text; loai text; ma text; ten text; phieu bigint; ord uuid; ly text; rid text;
begin
  if coalesce(current_setting('app.bo_qua_nhat_ky', true), '') = '1' then return null; end if;
  if op <> 'DELETE' then vn := to_jsonb(new); end if;
  if op <> 'INSERT' then vo := to_jsonb(old); end if;
  vr := coalesce(vn, vo);

  -- Bỏ qua các dòng chỉ là hệ quả của việc khác (đã có nhật ký ở dòng gốc)
  if t = 'stock_ledger' and op <> 'INSERT' then return null; end if;
  if t = 'stock_import_items' and op = 'INSERT' then return null; end if;
  if t = 'repair_item_costs' and op = 'INSERT'
     and (coalesce(current_setting('app.sua_phieu', true), '') = '1' or coalesce(current_setting('app.hoan_thanh', true), '') = '1') then
    return null;
  end if;

  -- Mô tả đối tượng
  if t = 'repair_orders' then
    loai := 'Phiếu sửa chữa'; phieu := (vr->>'code')::bigint;
  elsif t in ('repair_items', 'repair_costs', 'order_payments') then
    ord := (vr->>'order_id')::uuid;
    loai := case t when 'repair_items' then 'Dòng phiếu' when 'repair_costs' then 'Chi phí phiếu' else 'Khoản thu' end;
    ten := case t when 'repair_items' then vr->>'name' when 'repair_costs' then vr->>'content' else coalesce(vr->>'loai', '') || ' ' || coalesce(vr->>'hinh_thuc', '') end;
  elsif t = 'repair_item_costs' then
    loai := 'Giá vốn dòng phiếu';
    select i.order_id, i.name into ord, ten from public.repair_items i where i.id = (vr->>'item_id')::uuid;
  elsif t = 'parts' then
    loai := 'Phụ tùng'; ma := vr->>'code'; ten := vr->>'name';
  elsif t = 'part_costs' then
    loai := 'Giá nhập phụ tùng';
    select p.code, p.name into ma, ten from public.parts p where p.id = (vr->>'part_id')::uuid;
  elsif t = 'stock_imports' then
    loai := 'Lần nhập hàng'; ma := to_char((vr->>'imported_on')::date, 'DD/MM/YYYY'); ten := vr->>'supplier';
  elsif t = 'stock_import_items' then
    loai := 'Dòng nhập hàng'; ma := vr->>'code'; ten := vr->>'name';
  elsif t = 'stock_ledger' then
    loai := 'Sổ kho'; ma := vr->>'part_code'; ten := vr->>'part_name'; phieu := (vr->>'order_code')::bigint;
  elsif t = 'von_chi_phi_mo_xuong' then loai := 'Vốn: chi phí mở xưởng'; ten := vr->>'category';
  elsif t = 'von_gop' then loai := 'Vốn: vốn góp'; ten := vr->>'contributor';
  elsif t = 'von_chi_phi_van_hanh' then loai := 'Chi phí vận hành'; ma := to_char((vr->>'month')::date, 'MM/YYYY'); ten := vr->>'kind';
  elsif t = 'von_loi_nhuan_cu' then loai := 'Lợi nhuận nhập tay'; ma := to_char((vr->>'month')::date, 'MM/YYYY'); ten := vr->>'note';
  elsif t = 'von_cai_dat' then loai := 'Cài đặt vốn'; ten := 'Ngày bắt đầu tính thu hồi vốn';
  elsif t = 'ev_ten_hien_thi' then
    loai := 'Tên hiển thị tài khoản'; ten := vr->>'ten';
    select u.email::text into ma from auth.users u where u.id = (vr->>'user_id')::uuid;
  elsif t = 'user_roles' then
    loai := 'Vai trò tài khoản'; ten := vr->>'role';
    select u.email::text into ma from auth.users u where u.id = (vr->>'user_id')::uuid;
  else
    loai := t;
  end if;
  if ord is not null and phieu is null then select o.code into phieu from public.repair_orders o where o.id = ord; end if;
  if t in ('repair_items', 'repair_costs', 'order_payments', 'repair_item_costs', 'repair_orders') and phieu is not null then
    ma := 'PT' || lpad(phieu::text, 4, '0');
  end if;

  -- Trước / sau
  if op = 'INSERT' then
    sa := vr;
  elsif op = 'DELETE' then
    tr := vr;
  else
    for k in select jsonb_object_keys(vn) loop
      if k in ('created_at', 'updated_at') then continue; end if;
      if t = 'parts' and k = 'stock' and coalesce(current_setting('app.doi_ton', true), '') = '1' then continue; end if;  -- đổi tồn đã có dòng sổ kho
      if vn->k is distinct from vo->k then
        tr := coalesce(tr, '{}'::jsonb) || jsonb_build_object(k, vo->k);
        sa := coalesce(sa, '{}'::jsonb) || jsonb_build_object(k, vn->k);
      end if;
    end loop;
    if tr is null then return null; end if;
  end if;

  hd := nullif(current_setting('app.hanh_dong', true), '');
  ly := nullif(current_setting('app.ly_do', true), '');
  if t = 'stock_ledger' then
    hd := vr->>'loai'; ly := vr->>'ghi_chu';
    tr := jsonb_build_object('ton', (vr->>'ton_sau')::numeric - (vr->>'so_luong')::numeric);
    sa := jsonb_build_object('ton', (vr->>'ton_sau')::numeric, 'so_luong_thay_doi', (vr->>'so_luong')::numeric, 'don_vi', vr->>'don_vi');
  end if;
  hd := coalesce(hd, case op when 'INSERT' then 'them' when 'UPDATE' then 'sua' else 'xoa' end);

  rid := coalesce(vr->>'id', vr->>'part_id', vr->>'item_id', vr->>'user_id');
  if rid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then rid := null; end if;
  perform public.ghi_nhat_ky(hd, loai, ma, ten, phieu, t, rid::uuid, tr, sa, ly);
  return null;
end $$;
revoke execute on function public.nhat_ky_tu_dong() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['repair_orders','repair_items','repair_item_costs','repair_costs','order_payments','parts','part_costs',
                           'stock_imports','stock_import_items','stock_ledger',
                           'von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu','von_cai_dat',
                           'ev_ten_hien_thi','user_roles'] loop
    execute format('drop trigger if exists nhat_ky_tu_dong on public.%I', t);
    execute format('create trigger nhat_ky_tu_dong after insert or update or delete on public.%I for each row execute function public.nhat_ky_tu_dong()', t);
  end loop;
end $$;

-- Chặn TRUNCATE (xóa sạch bảng) ở mọi bảng tài chính + kho
do $$
declare t text;
begin
  foreach t in array array['repair_orders','repair_items','repair_item_costs','repair_costs','order_payments','parts','part_costs',
                           'stock_imports','stock_import_items','stock_ledger',
                           'von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu','von_cai_dat'] loop
    execute format('drop trigger if exists chan_truncate on public.%I', t);
    execute format('create trigger chan_truncate before truncate on public.%I for each statement execute function public.chan_sua_xoa_nhat_ky()', t);
  end loop;
end $$;

-- 6. Chốt chặn ở cơ sở dữ liệu (áp cho mọi tài khoản, kể cả Chủ) ---------------------------------------
-- 6a. Phiếu sửa chữa: không xóa cứng; không tự đặt trạng thái thu tiền / hoàn thành / hủy bằng tay
create or replace function public.phieu_chan_tai_chinh() returns trigger
language plpgsql security definer set search_path = public as $$
declare cho_phep boolean := coalesce(current_setting('app.tai_chinh', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.xoa_phieu', true), '') = '1' then return old; end if;
    raise exception 'Phiếu sửa chữa không được xóa cứng. Phiếu nháp: bấm "Xóa phiếu nháp". Phiếu đã có dòng/khoản thu/trừ kho: Chủ xưởng bấm "Hủy phiếu" (có lý do). Nếu bạn đang xóa khách hoặc xe: khách/xe này còn phiếu nên không xóa được.';
  end if;
  if tg_op = 'INSERT' then
    if new.stock_deducted or new.da_huy or new.payment_method is not null or new.paid_at is not null
       or new.status in ('Hoàn thành', 'Đã hủy') then
      raise exception 'Phiếu mới không được tạo ở trạng thái đã thu tiền / hoàn thành / đã hủy';
    end if;
    return new;
  end if;
  -- UPDATE
  if old.da_huy then raise exception 'Phiếu đã hủy, không sửa được nữa'; end if;
  if not cho_phep then
    if new.payment_method is distinct from old.payment_method or new.paid_at is distinct from old.paid_at
       or new.stock_deducted is distinct from old.stock_deducted or new.da_huy is distinct from old.da_huy
       or new.huy_ly_do is distinct from old.huy_ly_do or new.huy_boi is distinct from old.huy_boi
       or new.huy_boi_ten is distinct from old.huy_boi_ten or new.huy_luc is distinct from old.huy_luc then
      raise exception 'Không sửa trực tiếp thông tin thu tiền / hủy của phiếu. Dùng "Hoàn thành và thu tiền" hoặc "Hủy phiếu"';
    end if;
    if new.status is distinct from old.status then
      if new.status in ('Hoàn thành', 'Đã hủy') then
        raise exception 'Trạng thái "%" chỉ đặt qua "Hoàn thành và thu tiền" hoặc "Hủy phiếu"', new.status;
      end if;
      if old.stock_deducted and new.status not in ('Hoàn thành', 'Đã giao xe') then
        raise exception 'Phiếu đã hoàn thành chỉ có thể ở trạng thái "Hoàn thành" hoặc "Đã giao xe"';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.phieu_chan_tai_chinh() from public, anon, authenticated;
drop trigger if exists phieu_chan_tai_chinh on public.repair_orders;
create trigger phieu_chan_tai_chinh before insert or update or delete on public.repair_orders
  for each row execute function public.phieu_chan_tai_chinh();

-- 6b. Khoản thu: không sửa, không xóa; chỉ đánh dấu hủy qua huy_khoan_thu()
create or replace function public.khoan_thu_chan_sua_xoa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Khoản thu không được xóa. Chủ xưởng dùng "Hủy khoản thu" (lý do bắt buộc)';
  end if;
  if coalesce(current_setting('app.huy_thu', true), '') = '1' and not old.da_huy and new.da_huy
     and (to_jsonb(new) - array['da_huy','huy_ly_do','huy_boi','huy_boi_ten','huy_luc'])
       = (to_jsonb(old) - array['da_huy','huy_ly_do','huy_boi','huy_boi_ten','huy_luc']) then
    return new;
  end if;
  raise exception 'Không sửa trực tiếp khoản thu. Chủ xưởng "Hủy khoản thu" rồi ghi khoản thu mới';
end $$;
revoke execute on function public.khoan_thu_chan_sua_xoa() from public, anon, authenticated;
drop trigger if exists khoan_thu_chan_sua_xoa on public.order_payments;
create trigger khoan_thu_chan_sua_xoa before update or delete on public.order_payments
  for each row execute function public.khoan_thu_chan_sua_xoa();

-- 6c. Chi phí phiếu: không xóa cứng; đã hủy thì khóa; không đổi người/thời gian tạo
create or replace function public.chi_phi_chan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Chi phí không được xóa cứng. Chủ xưởng dùng "Hủy chi phí" (lý do bắt buộc)';
  end if;
  if old.da_huy then raise exception 'Khoản chi phí đã hủy, không sửa được'; end if;
  if (new.da_huy is distinct from old.da_huy or new.huy_ly_do is distinct from old.huy_ly_do or new.huy_boi is distinct from old.huy_boi
      or new.huy_luc is distinct from old.huy_luc) and coalesce(current_setting('app.huy_cp', true), '') <> '1' then
    raise exception 'Chỉ hủy chi phí qua chức năng "Hủy chi phí"';
  end if;
  new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  return new;
end $$;
revoke execute on function public.chi_phi_chan() from public, anon, authenticated;
drop trigger if exists chi_phi_chan on public.repair_costs;
create trigger chi_phi_chan before update or delete on public.repair_costs
  for each row execute function public.chi_phi_chan();

-- 6d. Bảng vốn: không xóa cứng; chỉ hủy qua von_huy(); không đổi người/thời gian tạo
create or replace function public.von_chan() returns trigger
language plpgsql security definer set search_path = public as $$
declare vo jsonb; vn jsonb; k text[] := array['da_huy','huy_ly_do','huy_boi','huy_boi_ten','huy_luc'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Dữ liệu vốn không được xóa cứng. Chủ xưởng dùng "Hủy" (lý do bắt buộc)';
  end if;
  vo := to_jsonb(old); vn := to_jsonb(new);
  if vo ? 'da_huy' then
    if (vo->>'da_huy')::boolean then raise exception 'Khoản này đã hủy, không sửa được'; end if;
    if (vn - k) is not null and (vn->>'da_huy') is distinct from (vo->>'da_huy') and coalesce(current_setting('app.huy_von', true), '') <> '1' then
      raise exception 'Chỉ hủy qua chức năng "Hủy" (có lý do)';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('created_by', vo->'created_by', 'created_by_name', vo->'created_by_name', 'created_at', vo->'created_at'));
  end if;
  return new;
end $$;
revoke execute on function public.von_chan() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['von_chi_phi_mo_xuong','von_gop','von_chi_phi_van_hanh','von_loi_nhuan_cu','von_cai_dat'] loop
    execute format('drop trigger if exists von_chan on public.%I', t);
    execute format('create trigger von_chan before update or delete on public.%I for each row execute function public.von_chan()', t);
  end loop;
end $$;

-- 6e. Lịch sử nhập hàng: không xóa cứng
create or replace function public.chan_xoa_cung() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Không được xóa cứng dữ liệu "%": chỉ được hủy (có lý do)', tg_table_name;
end $$;
revoke execute on function public.chan_xoa_cung() from public, anon, authenticated;
drop trigger if exists chan_xoa_cung on public.stock_imports;
create trigger chan_xoa_cung before delete on public.stock_imports for each row execute function public.chan_xoa_cung();
drop trigger if exists chan_xoa_cung on public.stock_import_items;
create trigger chan_xoa_cung before delete on public.stock_import_items for each row execute function public.chan_xoa_cung();

-- 6f. Phụ tùng đã có lịch sử kho / phiếu / nhập hàng thì không xóa
create or replace function public.parts_chan_xoa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.stock <> 0 or exists (select 1 from public.stock_ledger where part_id = old.id)
     or exists (select 1 from public.repair_items where part_id = old.id)
     or exists (select 1 from public.stock_import_items where part_id = old.id) then
    raise exception 'Phụ tùng "%" đã có lịch sử kho / phiếu / nhập hàng nên không xóa được. Hãy để tồn bằng 0 (Kiểm kê điều chỉnh)', old.name;
  end if;
  return old;
end $$;
revoke execute on function public.parts_chan_xoa() from public, anon, authenticated;
drop trigger if exists parts_chan_xoa on public.parts;
create trigger parts_chan_xoa before delete on public.parts for each row execute function public.parts_chan_xoa();

-- 6g. Dòng báo giá: phiếu đã hủy khóa hẳn; phiếu đã thu tiền chỉ sửa qua các hàm có nhật ký (như giai đoạn 9)
create or replace function public.chan_sua_dong_phieu_da_thu() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_order uuid; v_done boolean; v_huy boolean;
begin
  v_order := case when tg_op = 'INSERT' then new.order_id else old.order_id end;
  select stock_deducted, da_huy into v_done, v_huy from public.repair_orders where id = v_order;
  if v_huy is true then raise exception 'Phiếu đã hủy, không sửa được dòng nào'; end if;
  if v_done is not true then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.order_id = old.order_id and new.kind = old.kind and new.name = old.name
     and new.qty = old.qty and new.unit_price = old.unit_price then
    return new;
  end if;
  if coalesce(current_setting('app.sua_phieu', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Phiếu đã hoàn thành: hãy bấm "Mở chỉnh sửa" trong phiếu để sửa (có ghi nhật ký)';
end $$;

create or replace function public.phieu_dang_mo(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not stock_deducted and not da_huy from public.repair_orders where id = p_order), false)
$$;

-- 6h. Sửa dòng của phiếu ĐÃ thu tiền -> tự ghi dòng điều chỉnh vào sổ khoản thu (tổng khoản thu luôn khớp tổng phiếu)
create or replace function public.dong_phieu_dieu_chinh_thu() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_oid uuid; o record; v_old numeric := 0; v_new numeric := 0; d numeric; v_name text; v_ghi text;
begin
  v_oid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select stock_deducted, da_huy, payment_method into o from public.repair_orders where id = v_oid;
  if not found or o.stock_deducted is not true or o.da_huy then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') then v_old := old.qty * old.unit_price; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := new.qty * new.unit_price; end if;
  d := v_new - v_old;
  if d = 0 then return null; end if;
  v_name := coalesce(case when tg_op = 'DELETE' then old.name else new.name end, '');
  v_ghi := case tg_op when 'INSERT' then 'Thêm "' || v_name || '" vào phiếu đã hoàn thành'
                      when 'DELETE' then 'Bỏ "' || v_name || '" khỏi phiếu đã hoàn thành'
                      else 'Giảm/đổi "' || v_name || '" (khách trả hàng hoặc sửa phiếu)' end;
  insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu)
    values (v_oid, 'dieu_chinh', d, coalesce(o.payment_method, 'Tiền mặt'), public.ngay_hom_nay(), v_ghi);
  return null;
end $$;
revoke execute on function public.dong_phieu_dieu_chinh_thu() from public, anon, authenticated;
drop trigger if exists dong_phieu_dieu_chinh_thu on public.repair_items;
create trigger dong_phieu_dieu_chinh_thu after insert or update or delete on public.repair_items
  for each row execute function public.dong_phieu_dieu_chinh_thu();

-- 7. Quyền ghi: Nhân viên không ghi thẳng vào bảng tài chính / kho -----------------------------------------
alter table public.order_payments enable row level security;
revoke all on public.order_payments from anon;
revoke all on public.order_payments from authenticated;
grant select on public.order_payments to authenticated;
drop policy if exists tt_chi_chu_xem on public.order_payments;
create policy tt_chi_chu_xem on public.order_payments for select to authenticated using (public.la_chu());

-- Dòng phiếu: chỉ đọc trực tiếp; thêm/xóa đi qua các hàm phieu_* (và sua_phieu_* cho phiếu đã hoàn thành)
revoke insert, update, delete on public.repair_items from authenticated;
-- Phiếu: không có quyền xóa trực tiếp (xóa phiếu nháp đi qua xoa_phieu_nhap)
revoke delete on public.repair_orders from authenticated;
-- Vốn: không xóa trực tiếp (hủy qua von_huy)
revoke delete on public.von_chi_phi_mo_xuong from authenticated;
revoke delete on public.von_gop from authenticated;
revoke delete on public.von_chi_phi_van_hanh from authenticated;
revoke delete on public.von_loi_nhuan_cu from authenticated;
revoke delete on public.von_cai_dat from authenticated;
-- Phụ tùng: mọi vai trò xem và thêm mới; chỉ Chủ sửa / xóa (tồn kho vẫn chỉ đổi qua doi_ton)
drop policy if exists vt_moi_vai_tro on public.parts;
drop policy if exists vt_xem on public.parts;
drop policy if exists vt_them on public.parts;
drop policy if exists vt_sua on public.parts;
drop policy if exists vt_xoa on public.parts;
create policy vt_xem on public.parts for select to authenticated using (public.vai_tro() is not null);
create policy vt_them on public.parts for insert to authenticated with check (public.vai_tro() is not null);
create policy vt_sua on public.parts for update to authenticated using (public.la_chu()) with check (public.la_chu());
create policy vt_xoa on public.parts for delete to authenticated using (public.la_chu());

-- 8. Hàm nghiệp vụ -------------------------------------------------------------------------------------------
-- 8a. Hoàn thành + thu tiền: giữ nguyên cách trừ kho / chốt giá vốn, thêm ghi sổ khoản thu
create or replace function public.hoan_thanh_phieu(p_order uuid, p_method text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare o record; r record; v_total numeric;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_method not in ('Tiền mặt', 'Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy, không thể hoàn thành'; end if;
  if o.stock_deducted then raise exception 'Phiếu này đã hoàn thành và thu tiền rồi'; end if;

  perform set_config('app.hoan_thanh', '1', true);
  for r in select part_id, sum(qty) as qty from public.repair_items
           where order_id = p_order and kind = 'part' and part_id is not null group by part_id order by part_id loop
    perform public.doi_ton(r.part_id, -r.qty, 'xuat_phieu', p_order, null, null);
  end loop;

  insert into public.repair_item_costs (item_id, cost_price)
    select i.id, coalesce(c.cost_price, 0)
    from public.repair_items i left join public.part_costs c on c.part_id = i.part_id
    where i.order_id = p_order and i.kind = 'part'
  on conflict (item_id) do update set cost_price = excluded.cost_price;
  perform set_config('app.hoan_thanh', '', true);

  perform set_config('app.tai_chinh', '1', true);
  perform set_config('app.hanh_dong', 'hoan_thanh', true);
  update public.repair_orders set status = 'Hoàn thành', payment_method = p_method,
    paid_at = coalesce(p_date, public.ngay_hom_nay()), stock_deducted = true where id = p_order;
  perform set_config('app.tai_chinh', '', true);
  perform set_config('app.hanh_dong', '', true);

  select coalesce(sum(qty * unit_price), 0) into v_total from public.repair_items where order_id = p_order;
  insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu)
    values (p_order, 'thu', v_total, p_method, coalesce(p_date, public.ngay_hom_nay()), 'Thu khi hoàn thành phiếu');
end $$;
revoke execute on function public.hoan_thanh_phieu(uuid, text, date) from public, anon;
grant execute on function public.hoan_thanh_phieu(uuid, text, date) to authenticated;

-- 8b. Thêm / xóa dòng cho phiếu CHƯA hoàn thành (mọi vai trò; giá lấy từ máy chủ, không tin giá giao diện gửi lên)
create or replace function public.phieu_them_phu_tung(p_order uuid, p_part uuid, p_qty numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare o record; p record; v_id uuid;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Số lượng phải lớn hơn 0'; end if;
  if p_qty <> round(p_qty, 3) then raise exception 'Số lượng chỉ được tối đa 3 chữ số thập phân'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  if o.stock_deducted then raise exception 'Phiếu đã hoàn thành: Chủ xưởng dùng "Mở chỉnh sửa"'; end if;
  select * into p from public.parts where id = p_part and not is_hidden;
  if not found then raise exception 'Không tìm thấy phụ tùng'; end if;
  insert into public.repair_items (order_id, part_id, kind, name, qty, unit_price)
    values (p_order, p.id, 'part', p.name, p_qty, p.sale_price) returning id into v_id;
  return v_id;
end $$;

create or replace function public.phieu_them_cong(p_order uuid, p_name text, p_price numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare o record; v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if v_name = '' then raise exception 'Hãy nhập tên tiền công'; end if;
  if p_price is null or p_price < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  if o.stock_deducted then raise exception 'Phiếu đã hoàn thành: Chủ xưởng dùng "Mở chỉnh sửa"'; end if;
  insert into public.repair_items (order_id, kind, name, qty, unit_price) values (p_order, 'labor', v_name, 1, round(p_price)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.phieu_xoa_dong(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it record; o record;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  select * into it from public.repair_items where id = p_item;
  if not found then raise exception 'Không tìm thấy dòng (có thể đã bị xóa)'; end if;
  select * into o from public.repair_orders where id = it.order_id for update;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  if o.stock_deducted then raise exception 'Phiếu đã hoàn thành: Chủ xưởng dùng "Mở chỉnh sửa"'; end if;
  delete from public.repair_items where id = p_item;
end $$;

-- 8c. Xóa phiếu NHÁP (mọi vai trò): chưa có dòng nào, chưa thu, chưa trừ kho, chưa có chi phí
create or replace function public.xoa_phieu_nhap(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_co text := '';
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu (có thể đã bị xóa)'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy, không xóa được'; end if;
  if o.stock_deducted then v_co := v_co || ' đã hoàn thành/trừ kho;'; end if;
  if exists (select 1 from public.repair_items where order_id = p_order) then v_co := v_co || ' đã có dòng phụ tùng/tiền công;'; end if;
  if exists (select 1 from public.order_payments where order_id = p_order) then v_co := v_co || ' đã có khoản thu;'; end if;
  if exists (select 1 from public.repair_costs where order_id = p_order) then v_co := v_co || ' đã có chi phí;'; end if;
  if exists (select 1 from public.stock_ledger where order_id = p_order) then v_co := v_co || ' đã có phát sinh kho;'; end if;
  if v_co <> '' then
    raise exception 'Chỉ xóa được phiếu nháp. Phiếu này%. Nhờ Chủ xưởng bấm "Hủy phiếu" (có lý do).', rtrim(v_co, ';');
  end if;
  perform set_config('app.xoa_phieu', '1', true);
  perform set_config('app.hanh_dong', 'xoa_phieu_nhap', true);
  perform set_config('app.ly_do', 'Xóa phiếu nháp', true);
  delete from public.repair_orders where id = p_order;
  perform set_config('app.xoa_phieu', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
end $$;

-- 8d. Hủy phiếu (chỉ Chủ, lý do bắt buộc): hoàn kho qua sổ kho, đảo khoản thu bằng dòng điều chỉnh, loại khỏi doanh thu/lợi nhuận
create or replace function public.huy_phieu(p_order uuid, p_ly_do text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; r record; pm record; v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text; v_ma text; v_kho int := 0; v_dao int := 0;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy phiếu'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy phiếu'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu này đã hủy rồi'; end if;
  v_ma := 'PT' || lpad(o.code::text, 4, '0');
  v_ten := public.ten_nguoi_dung(auth.uid());

  if o.stock_deducted then
    for r in select part_id from public.repair_items
             where order_id = p_order and kind = 'part' and part_id is not null group by part_id order by part_id loop
      if public.dv_da_doi_sau(r.part_id, p_order, null) then
        raise exception 'Có phụ tùng đã đổi đơn vị sau khi bán nên không tự hoàn kho được. Hãy dùng "Kiểm kê điều chỉnh" cho phụ tùng đó rồi hủy phiếu lại';
      end if;
    end loop;
    for r in select part_id, sum(qty) as qty from public.repair_items
             where order_id = p_order and kind = 'part' and part_id is not null group by part_id order by part_id loop
      perform public.doi_ton(r.part_id, r.qty, 'huy_phieu', p_order, null, 'Hủy phiếu ' || v_ma || ': ' || v_ly);
      v_kho := v_kho + 1;
    end loop;

    perform set_config('app.hanh_dong', 'dao_khoan_thu', true);
    perform set_config('app.ly_do', 'Đảo khoản thu do hủy phiếu: ' || v_ly, true);
    for pm in select * from public.order_payments
              where order_id = p_order and not da_huy and loai in ('thu', 'dieu_chinh') and so_tien <> 0 order by seq loop
      insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu, ref_id)
        values (p_order, 'dao', -pm.so_tien, pm.hinh_thuc, public.ngay_hom_nay(), 'Đảo khoản thu do hủy phiếu: ' || v_ly, pm.id);
      v_dao := v_dao + 1;
    end loop;
    perform set_config('app.hanh_dong', '', true);
    perform set_config('app.ly_do', '', true);
  end if;

  perform set_config('app.tai_chinh', '1', true);
  perform set_config('app.hanh_dong', 'huy_phieu', true);
  perform set_config('app.ly_do', v_ly, true);
  update public.repair_orders set status = 'Đã hủy', da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(),
         huy_boi_ten = v_ten, huy_luc = now() where id = p_order;
  perform set_config('app.tai_chinh', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  return jsonb_build_object('hoan_kho', v_kho, 'dao_khoan_thu', v_dao);
end $$;

-- 8e. Hủy khoản thu / ghi khoản thu mới (chỉ Chủ)
create or replace function public.huy_khoan_thu(p_payment uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare pm record; o record; v_ly text := btrim(coalesce(p_ly_do, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy khoản thu'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy khoản thu'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  select * into pm from public.order_payments where id = p_payment for update;
  if not found then raise exception 'Không tìm thấy khoản thu'; end if;
  if pm.da_huy then raise exception 'Khoản thu này đã hủy rồi'; end if;
  if pm.loai <> 'thu' then raise exception 'Chỉ hủy được khoản thu gốc. Dòng điều chỉnh/đảo do hệ thống tự ghi, không hủy riêng'; end if;
  select * into o from public.repair_orders where id = pm.order_id for update;
  if o.da_huy then raise exception 'Phiếu đã hủy: các khoản thu đã được đảo, không hủy riêng được'; end if;
  perform set_config('app.huy_thu', '1', true);
  perform set_config('app.hanh_dong', 'huy_khoan_thu', true);
  perform set_config('app.ly_do', v_ly, true);
  update public.order_payments set da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(),
         huy_boi_ten = public.ten_nguoi_dung(auth.uid()), huy_luc = now() where id = p_payment;
  perform set_config('app.huy_thu', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
end $$;

create or replace function public.ghi_khoan_thu(p_order uuid, p_so_tien numeric, p_hinh_thuc text, p_ngay date, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o record; v_total numeric; v_da numeric; v_id uuid;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được ghi khoản thu'; end if;
  if p_hinh_thuc not in ('Tiền mặt', 'Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if p_so_tien is null or p_so_tien <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  if not o.stock_deducted then raise exception 'Phiếu chưa hoàn thành: dùng "Hoàn thành và thu tiền"'; end if;
  select coalesce(sum(qty * unit_price), 0) into v_total from public.repair_items where order_id = p_order;
  select coalesce(sum(so_tien), 0) into v_da from public.order_payments where order_id = p_order and not da_huy;
  if v_da + p_so_tien > v_total + 0.5 then
    raise exception 'Tổng thu sẽ vượt tổng phiếu: đã thu % đ + khoản này % đ > tổng phiếu % đ', round(v_da), round(p_so_tien), round(v_total);
  end if;
  insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu)
    values (p_order, 'thu', round(p_so_tien), p_hinh_thuc, coalesce(p_ngay, public.ngay_hom_nay()), nullif(btrim(coalesce(p_ghi_chu, '')), ''))
    returning id into v_id;
  return v_id;
end $$;

-- 8f. Chi phí phiếu: hủy thay cho xóa
create or replace function public.chi_phi_huy(p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy chi phí'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy chi phí'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  select * into c from public.repair_costs where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if c.da_huy then raise exception 'Khoản chi phí này đã hủy rồi'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());
  perform set_config('app.huy_cp', '1', true);
  perform set_config('app.hanh_dong', 'huy_chi_phi', true);
  perform set_config('app.ly_do', v_ly, true);
  update public.repair_costs set da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(), huy_boi_ten = v_ten, huy_luc = now() where id = p_id;
  perform set_config('app.huy_cp', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
    values (c.order_id, 'huy', c.kind, c.content, c.amount, null, c.note, 'Hủy chi phí. Lý do: ' || v_ly, v_ten);
end $$;
revoke execute on function public.chi_phi_huy(uuid, text) from public, anon;
grant execute on function public.chi_phi_huy(uuid, text) to authenticated;

create or replace function public.chi_phi_xoa(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Chi phí không được xóa cứng nữa. Hãy dùng "Hủy chi phí" (lý do bắt buộc)';
end $$;

-- 8g. Vốn / chi phí vận hành / lợi nhuận nhập tay: hủy thay cho xóa
create or replace function public.von_huy(p_bang text, p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ly text := btrim(coalesce(p_ly_do, '')); n int;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy khoản này'; end if;
  if p_bang not in ('von_chi_phi_mo_xuong', 'von_gop', 'von_chi_phi_van_hanh', 'von_loi_nhuan_cu') then raise exception 'Bảng không hợp lệ'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  perform set_config('app.huy_von', '1', true);
  perform set_config('app.hanh_dong', 'huy_von', true);
  perform set_config('app.ly_do', v_ly, true);
  execute format('update public.%I set da_huy = true, huy_ly_do = $1, huy_boi = $2, huy_boi_ten = $3, huy_luc = now() where id = $4 and not da_huy', p_bang)
    using v_ly, auth.uid(), public.ten_nguoi_dung(auth.uid()), p_id;
  get diagnostics n = row_count;
  perform set_config('app.huy_von', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  if n = 0 then raise exception 'Không tìm thấy khoản này hoặc đã hủy rồi'; end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'phieu_them_phu_tung(uuid, uuid, numeric)', 'phieu_them_cong(uuid, text, numeric)', 'phieu_xoa_dong(uuid)',
    'xoa_phieu_nhap(uuid)', 'huy_phieu(uuid, text)', 'huy_khoan_thu(uuid, text)',
    'ghi_khoan_thu(uuid, numeric, text, date, text)', 'chi_phi_xoa(uuid)', 'von_huy(text, uuid, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.chan_sua_dong_phieu_da_thu() from public, anon, authenticated;
revoke execute on function public.dong_phieu_dieu_chinh_thu() from public, anon, authenticated;
revoke execute on function public.phieu_dang_mo(uuid) from public, anon;
grant execute on function public.phieu_dang_mo(uuid) to authenticated;

-- 9. Chép nhật ký cũ sang nhật ký chung (chỉ một lần cho mỗi dòng cũ, chạy lại không ghi trùng) ---------------
insert into public.nhat_ky_hoat_dong (created_at, user_id, ten_hien_thi, hanh_dong, loai_doi_tuong, ma_doi_tuong, ten_doi_tuong, ma_phieu,
                                      bang, ban_ghi_id, truoc, sau, ly_do, nguon, nguon_id)
select l.created_at, l.created_by, coalesce(l.created_by_name, 'Không rõ'),
       case l.action when 'them' then 'them' when 'xoa' then 'xoa' else 'khach_tra' end,
       'Dòng phiếu', 'PT' || lpad(o.code::text, 4, '0'), l.item_name, o.code,
       'repair_edit_logs', l.order_id,
       jsonb_build_object('tong_phieu', l.total_before),
       jsonb_build_object('tong_phieu', l.total_after, 'so_luong', l.qty, 'don_gia', l.unit_price, 'loai_dong', l.kind),
       l.ghi_chu, 'repair_edit_logs', l.id
from public.repair_edit_logs l join public.repair_orders o on o.id = l.order_id
on conflict (nguon, nguon_id) where nguon is not null do nothing;

insert into public.nhat_ky_hoat_dong (created_at, user_id, ten_hien_thi, hanh_dong, loai_doi_tuong, ma_doi_tuong, ten_doi_tuong, ma_phieu,
                                      bang, ban_ghi_id, truoc, sau, ly_do, nguon, nguon_id)
select l.created_at, l.created_by, coalesce(l.created_by_name, 'Không rõ'),
       case l.action when 'huy' then 'huy_chi_phi' else l.action end,
       'Chi phí phiếu', 'PT' || lpad(o.code::text, 4, '0'), l.content, o.code,
       'repair_cost_logs', l.order_id,
       case when l.amount_before is null then null else jsonb_build_object('so_tien', l.amount_before) end,
       case when l.amount_after is null then null else jsonb_build_object('so_tien', l.amount_after, 'noi_dung', l.content) end,
       coalesce(l.detail, l.note), 'repair_cost_logs', l.id
from public.repair_cost_logs l join public.repair_orders o on o.id = l.order_id
on conflict (nguon, nguon_id) where nguon is not null do nothing;

insert into public.nhat_ky_hoat_dong (created_at, ten_hien_thi, hanh_dong, loai_doi_tuong, ma_doi_tuong, ten_doi_tuong,
                                      bang, ban_ghi_id, ly_do, nguon, nguon_id)
select l.created_at, coalesce(l.created_by_name, 'Không rõ'), case l.action when 'huy' then 'huy_lan_nhap' else 'sua_lan_nhap' end,
       'Lần nhập hàng', to_char(s.imported_on, 'DD/MM/YYYY'), s.supplier,
       'stock_import_logs', l.import_id, l.noi_dung, 'stock_import_logs', l.id
from public.stock_import_logs l join public.stock_imports s on s.id = l.import_id
on conflict (nguon, nguon_id) where nguon is not null do nothing;

insert into public.nhat_ky_hoat_dong (created_at, user_id, ten_hien_thi, hanh_dong, loai_doi_tuong, ma_doi_tuong, ma_phieu,
                                      bang, ban_ghi_id, ly_do, nguon, nguon_id)
select l.created_at, l.created_by, coalesce(l.created_by_name, 'Không rõ'), 'sua_thong_tin_ev',
       'Thông tin EV', 'PT' || lpad(o.code::text, 4, '0'), o.code,
       'ev_nhat_ky', l.order_id, l.noi_dung, 'ev_nhat_ky', l.id
from public.ev_nhat_ky l join public.repair_orders o on o.id = l.order_id
on conflict (nguon, nguon_id) where nguon is not null do nothing;

insert into public.nhat_ky_hoat_dong (created_at, user_id, ten_hien_thi, hanh_dong, loai_doi_tuong, ma_doi_tuong, ten_doi_tuong, ma_phieu,
                                      bang, ban_ghi_id, truoc, sau, ly_do, nguon, nguon_id)
select l.created_at, l.created_by, coalesce(l.created_by_name, 'Không rõ'), l.loai,
       'Sổ kho', l.part_code, l.part_name, l.order_code,
       'stock_ledger', l.part_id,
       jsonb_build_object('ton', l.ton_sau - l.so_luong),
       jsonb_build_object('ton', l.ton_sau, 'so_luong_thay_doi', l.so_luong, 'don_vi', l.don_vi),
       l.ghi_chu, 'stock_ledger', l.id
from public.stock_ledger l
on conflict (nguon, nguon_id) where nguon is not null do nothing;

notify pgrst, 'reload schema';

-- Kiểm tra (sau khi Run): các cột ..._phai_la_true đều = true; so_mon_lech = 0; so_phieu_lech_thu = 0
select
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'nhat_ky_hoat_dong') as nhat_ky_bat_bao_mat_phai_la_true,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'order_payments') as khoan_thu_bat_bao_mat_phai_la_true,
  exists (select 1 from pg_trigger where tgname = 'chan_sua_xoa' and tgrelid = 'public.nhat_ky_hoat_dong'::regclass) as chan_sua_xoa_phai_la_true,
  (select count(*) from public.parts p
    where p.stock <> coalesce((select sum(so_luong) from public.stock_ledger l where l.part_id = p.id), 0)) as so_mon_lech,
  (select count(*) from public.repair_orders o
    where o.stock_deducted and not o.da_huy
      and abs(coalesce((select sum(p.so_tien) from public.order_payments p where p.order_id = o.id and not p.da_huy), 0)
            - coalesce((select sum(i.qty * i.unit_price) from public.repair_items i where i.order_id = o.id), 0)) > 0.5) as so_phieu_lech_thu,
  (select count(*) from public.ev_ten_hien_thi) as so_tai_khoan_co_ten,
  (select count(*) from auth.users) as so_tai_khoan;
