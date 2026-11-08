-- GIAI ĐOẠN 25: Hãng xe, dòng xe, năm sản xuất, màu xe
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu). Cần đã chạy giai-doan-4, 14 và 20.
--  * vehicles thêm 4 cột (không bắt buộc): hang_xe, dong_xe, nam_san_xuat, mau_xe. Xe cũ để trống vẫn chạy bình thường.
--  * Bảng gợi ý xe_hang, xe_dong: mọi tài khoản xem và thêm được (khi nhập tay hãng/dòng mới); chỉ Chủ sửa, xóa.
--  * Không đụng tới tiền, kho, sổ quỹ, phân quyền giá nhập/lợi nhuận.

alter table public.vehicles add column if not exists hang_xe text;
alter table public.vehicles add column if not exists dong_xe text;
alter table public.vehicles add column if not exists nam_san_xuat integer;
alter table public.vehicles add column if not exists mau_xe text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_nam_sx_hop_le') then
    alter table public.vehicles add constraint vehicles_nam_sx_hop_le
      check (nam_san_xuat is null or nam_san_xuat between 1950 and 2100) not valid;
  end if;
end $$;

create table if not exists public.xe_hang (
  id uuid primary key default gen_random_uuid(),
  ten text not null check (btrim(ten) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists xe_hang_ten_uq on public.xe_hang (lower(btrim(ten)));

create table if not exists public.xe_dong (
  id uuid primary key default gen_random_uuid(),
  hang_id uuid not null references public.xe_hang(id) on delete cascade,
  ten text not null check (btrim(ten) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists xe_dong_ten_uq on public.xe_dong (hang_id, lower(btrim(ten)));

-- Bảo mật (RLS)
alter table public.xe_hang enable row level security;
alter table public.xe_dong enable row level security;
grant select, insert, update, delete on public.xe_hang, public.xe_dong to authenticated;
do $$
declare t text;
begin
  foreach t in array array['xe_hang', 'xe_dong'] loop
    execute format('drop policy if exists vt_xem on public.%I', t);
    execute format('drop policy if exists vt_them on public.%I', t);
    execute format('drop policy if exists vt_sua on public.%I', t);
    execute format('drop policy if exists vt_xoa on public.%I', t);
    execute format('create policy vt_xem on public.%I for select to authenticated using (public.vai_tro() is not null)', t);
    execute format('create policy vt_them on public.%I for insert to authenticated with check (public.vai_tro() is not null)', t);
    execute format('create policy vt_sua on public.%I for update to authenticated using (public.la_chu()) with check (public.la_chu())', t);
    execute format('create policy vt_xoa on public.%I for delete to authenticated using (public.la_chu())', t);
  end loop;
end $$;

-- Danh sách gợi ý ban đầu (chỉ thêm cái chưa có)
do $$
declare
  d jsonb := '{
    "VinFast": ["VF3","VF5","VF e34","VF6","VF7","VF8","VF9","Minio Green","Herio Green","Nerio Green","Limo Green","EC Van","Evo200","Evo Grand","Feliz","Klara","Vento","Theon","Motio","Vero"],
    "Wuling": ["Hongguang Mini EV","Bingo"],
    "BYD": ["Atto 3","Dolphin","Seagull","Seal"],
    "Hyundai": ["Ioniq 5","Ioniq 6"],
    "Kia": ["EV6"],
    "MG": ["MG4","MG ZS EV"],
    "Tesla": ["Model 3","Model Y"]
  }'::jsonb;
  h text; m text; hid uuid;
begin
  for h in select jsonb_object_keys(d) loop
    insert into public.xe_hang(ten) values (h) on conflict do nothing;
    select id into hid from public.xe_hang where lower(btrim(ten)) = lower(h);
    for m in select jsonb_array_elements_text(d->h) loop
      insert into public.xe_dong(hang_id, ten) values (hid, m) on conflict do nothing;
    end loop;
  end loop;
end $$;

-- Thêm hãng/dòng vào danh sách gợi ý nếu chưa có (dùng khi nhập tay)
create or replace function public.xe_them_goi_y(p_hang text, p_dong text) returns void
language plpgsql security invoker set search_path = public as $$
declare v_h text := btrim(coalesce(p_hang, '')); v_d text := btrim(coalesce(p_dong, '')); hid uuid;
begin
  if public.vai_tro() is null or v_h = '' then return; end if;
  select id into hid from public.xe_hang where lower(btrim(ten)) = lower(v_h);
  if hid is null then
    insert into public.xe_hang(ten) values (v_h) on conflict do nothing;
    select id into hid from public.xe_hang where lower(btrim(ten)) = lower(v_h);
  end if;
  if v_d <> '' and hid is not null then
    insert into public.xe_dong(hang_id, ten) values (hid, v_d) on conflict do nothing;
  end if;
end $$;
revoke execute on function public.xe_them_goi_y(text, text) from public, anon;
grant execute on function public.xe_them_goi_y(text, text) to authenticated;

-- Tạo khách + xe trong một bước: thêm hãng, dòng, năm, màu (thay bản cũ của giai-doan-14)
drop function if exists public.tao_khach_xe(text, text, text, text, text, text, uuid);
create or replace function public.tao_khach_xe(
  p_bien_so text, p_loai_xe text, p_vin text, p_ten text, p_sdt text, p_dia_chi text, p_khach_id uuid default null,
  p_hang text default null, p_dong text default null, p_nam integer default null, p_mau text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_bs text := upper(btrim(coalesce(p_bien_so, '')));
  v_xe record;
  v_khach uuid := p_khach_id;
  v_hang text := nullif(btrim(coalesce(p_hang, '')), '');
  v_dong text := nullif(btrim(coalesce(p_dong, '')), '');
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if public.chuan_bien_so(v_bs) = '' then raise exception 'Hãy nhập biển số'; end if;
  if p_nam is not null and p_nam not between 1950 and 2100 then raise exception 'Năm sản xuất không hợp lệ'; end if;

  select id, customer_id into v_xe from public.vehicles where public.chuan_bien_so(plate) = public.chuan_bien_so(v_bs) limit 1;
  if found then
    return jsonb_build_object('xe_id', v_xe.id, 'khach_id', v_xe.customer_id, 'xe_co_san', true);
  end if;

  if v_khach is null then
    if btrim(coalesce(p_ten, '')) = '' then raise exception 'Hãy nhập tên khách'; end if;
    if btrim(coalesce(p_sdt, '')) = '' then raise exception 'Hãy nhập số điện thoại'; end if;
    insert into public.customers(name, phone, address)
      values (btrim(p_ten), btrim(p_sdt), nullif(btrim(coalesce(p_dia_chi, '')), ''))
      returning id into v_khach;
  elsif not exists (select 1 from public.customers where id = v_khach) then
    raise exception 'Không tìm thấy khách đã chọn';
  end if;

  insert into public.vehicles(customer_id, plate, vin, vehicle_type, hang_xe, dong_xe, nam_san_xuat, mau_xe)
    values (v_khach, v_bs, nullif(btrim(coalesce(p_vin, '')), ''), coalesce(nullif(btrim(coalesce(p_loai_xe, '')), ''), 'Xe máy điện'),
            v_hang, v_dong, p_nam, nullif(btrim(coalesce(p_mau, '')), ''))
    returning id into v_xe;
  perform public.xe_them_goi_y(v_hang, v_dong);
  return jsonb_build_object('xe_id', v_xe.id, 'khach_id', v_khach, 'xe_co_san', false);
end $$;
revoke execute on function public.tao_khach_xe(text, text, text, text, text, text, uuid, text, text, integer, text) from public, anon;
grant execute on function public.tao_khach_xe(text, text, text, text, text, text, uuid, text, text, integer, text) to authenticated;

-- Ghi nhật ký khi Chủ thêm/sửa/xóa hãng, dòng xe (gắn sau khi thêm danh sách ban đầu)
do $$
declare t text;
begin
  foreach t in array array['xe_hang', 'xe_dong'] loop
    execute format('drop trigger if exists nhat_ky_tu_dong on public.%I', t);
    execute format('create trigger nhat_ky_tu_dong after insert or update or delete on public.%I for each row execute function public.nhat_ky_tu_dong()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
