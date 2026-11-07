-- GIAI ĐOẠN 10: Chi phí của phiếu (chỉ Chủ xưởng thấy và nhập) + nhật ký sửa chi phí
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu).
-- Cần đã chạy giai-doan-4.sql (có hàm la_chu).
--
--  * Bảng repair_costs: mỗi khoản gồm loại (Vật tư tiêu hao / Thuê ngoài / Khác), nội dung, số tiền, ghi chú.
--  * Bật RLS: chỉ Chủ đọc được. Nhân viên đọc ra rỗng, không ghi được.
--  * Ghi/sửa/xóa chỉ qua 3 hàm (chỉ Chủ), mỗi lần sửa ghi 1 dòng vào repair_cost_logs.
--  * Sửa được cả khi phiếu đã hoàn thành. Không in lên phiếu báo giá của khách.

-- 1. Bảng chi phí -------------------------------------------------------------
create table if not exists public.repair_costs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  kind text not null check (kind in ('vat_tu','thue_ngoai','khac')),
  content text not null check (btrim(content) <> ''),
  amount numeric(14,0) not null check (amount >= 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists repair_costs_order_idx on public.repair_costs(order_id);

alter table public.repair_costs enable row level security;
revoke all on public.repair_costs from anon;
revoke all on public.repair_costs from authenticated;
grant select on public.repair_costs to authenticated;          -- chỉ đọc; ghi đi qua hàm
drop policy if exists cp_chi_chu_xem on public.repair_costs;
create policy cp_chi_chu_xem on public.repair_costs for select to authenticated using (public.la_chu());

-- 2. Bảng nhật ký chi phí --------------------------------------------------------
create table if not exists public.repair_cost_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  action text not null check (action in ('them','sua','xoa')),
  kind text not null,
  content text not null,
  amount_before numeric(14,0),          -- null khi thêm mới
  amount_after numeric(14,0),           -- null khi xóa
  note text,
  detail text,                          -- mô tả thay đổi (khi sửa)
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists repair_cost_logs_order_idx on public.repair_cost_logs(order_id, created_at desc);

alter table public.repair_cost_logs enable row level security;
revoke all on public.repair_cost_logs from anon;
revoke all on public.repair_cost_logs from authenticated;
grant select on public.repair_cost_logs to authenticated;
drop policy if exists cpnk_chi_chu_xem on public.repair_cost_logs;
create policy cpnk_chi_chu_xem on public.repair_cost_logs for select to authenticated using (public.la_chu());

-- 3. Ba hàm thêm / sửa / xóa (chỉ Chủ) --------------------------------------------
create or replace function public.chi_phi_them(p_order uuid, p_kind text, p_content text, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_content text := btrim(coalesce(p_content, ''));
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được nhập chi phí'; end if;
  if p_kind not in ('vat_tu','thue_ngoai','khac') then raise exception 'Loại chi phí không hợp lệ'; end if;
  if v_content = '' then raise exception 'Hãy nhập nội dung chi phí'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  perform 1 from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;

  insert into public.repair_costs (order_id, kind, content, amount, note)
    values (p_order, p_kind, v_content, round(p_amount), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, created_by_name)
    values (p_order, 'them', p_kind, v_content, null, round(p_amount), nullif(btrim(coalesce(p_note, '')), ''),
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
  return v_id;
end $$;

create or replace function public.chi_phi_sua(p_id uuid, p_kind text, p_content text, p_amount numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_content text := btrim(coalesce(p_content, '')); v_note text := nullif(btrim(coalesce(p_note, '')), '');
        v_detail text := '';
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được sửa chi phí'; end if;
  if p_kind not in ('vat_tu','thue_ngoai','khac') then raise exception 'Loại chi phí không hợp lệ'; end if;
  if v_content = '' then raise exception 'Hãy nhập nội dung chi phí'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  select * into c from public.repair_costs where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản chi phí (có thể đã bị xóa)'; end if;

  if c.kind <> p_kind then v_detail := v_detail || 'Loại: ' || (case c.kind when 'vat_tu' then 'Vật tư tiêu hao' when 'thue_ngoai' then 'Thuê ngoài' else 'Khác' end) || ' → ' || (case p_kind when 'vat_tu' then 'Vật tư tiêu hao' when 'thue_ngoai' then 'Thuê ngoài' else 'Khác' end) || '. '; end if;
  if c.content <> v_content then v_detail := v_detail || 'Nội dung: "' || c.content || '" → "' || v_content || '". '; end if;
  if c.note is distinct from v_note then v_detail := v_detail || 'Ghi chú: "' || coalesce(c.note, '') || '" → "' || coalesce(v_note, '') || '". '; end if;

  update public.repair_costs set kind = p_kind, content = v_content, amount = round(p_amount), note = v_note where id = p_id;
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
    values (c.order_id, 'sua', p_kind, v_content, c.amount, round(p_amount), v_note, nullif(btrim(v_detail), ''),
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
end $$;

create or replace function public.chi_phi_xoa(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xóa chi phí'; end if;
  select * into c from public.repair_costs where id = p_id for update;
  if not found then raise exception 'Khoản chi phí này vừa bị xóa rồi'; end if;
  delete from public.repair_costs where id = p_id;
  insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, created_by_name)
    values (c.order_id, 'xoa', c.kind, c.content, c.amount, null, c.note,
            coalesce((select email from auth.users where id = auth.uid()), 'Không rõ'));
end $$;

revoke execute on function public.chi_phi_them(uuid, text, text, numeric, text) from public, anon;
revoke execute on function public.chi_phi_sua(uuid, text, text, numeric, text) from public, anon;
revoke execute on function public.chi_phi_xoa(uuid) from public, anon;
grant execute on function public.chi_phi_them(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.chi_phi_sua(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.chi_phi_xoa(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra: cả 2 dòng phải hiện da_bat_bao_mat = true
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables where schemaname = 'public' and tablename in ('repair_costs', 'repair_cost_logs');
