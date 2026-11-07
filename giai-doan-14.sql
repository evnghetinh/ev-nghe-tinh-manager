-- GIAI ĐOẠN 14: Tiếp nhận xe mới trong một bước (tự tạo khách + xe)
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu). Cần đã chạy giai-doan-4 (có vai_tro()).
--  * Hàm tao_khach_xe(): tạo khách + xe trong 1 giao dịch (lỗi giữa chừng thì không để lại dữ liệu nửa vời).
--    Chạy với quyền của người gọi nên vẫn theo RLS: Chủ và Nhân viên đều dùng được, người lạ thì không.
--  * Chống trùng biển số kể cả khi gõ khác kiểu (51F-123.45 = 51f12345): thêm chỉ mục duy nhất
--    (chỉ tạo nếu dữ liệu hiện tại chưa có biển số trùng kiểu đó).

create or replace function public.chuan_bien_so(s text) returns text
language sql immutable parallel safe set search_path = public as $$
  select upper(regexp_replace(coalesce(s, ''), '[^[:alnum:]]', '', 'g'))
$$;

do $$
begin
  if exists (select 1 from public.vehicles group by public.chuan_bien_so(plate) having count(*) > 1) then
    raise notice 'Đã có biển số trùng kiểu (khác dấu cách/chấm/gạch) - bỏ qua chỉ mục duy nhất. Ứng dụng vẫn tự chặn trùng khi tạo mới.';
  else
    create unique index if not exists vehicles_bien_so_chuan_uq on public.vehicles (public.chuan_bien_so(plate));
  end if;
end $$;

create or replace function public.tao_khach_xe(
  p_bien_so text, p_loai_xe text, p_vin text, p_ten text, p_sdt text, p_dia_chi text, p_khach_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_bs text := upper(btrim(coalesce(p_bien_so, '')));
  v_xe record;
  v_khach uuid := p_khach_id;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if public.chuan_bien_so(v_bs) = '' then raise exception 'Hãy nhập biển số'; end if;

  -- Biển số đã có xe: trả về xe đó, không tạo trùng
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

  insert into public.vehicles(customer_id, plate, vin, vehicle_type)
    values (v_khach, v_bs, nullif(btrim(coalesce(p_vin, '')), ''), coalesce(nullif(btrim(coalesce(p_loai_xe, '')), ''), 'Xe máy điện'))
    returning id into v_xe;
  return jsonb_build_object('xe_id', v_xe.id, 'khach_id', v_khach, 'xe_co_san', false);
end $$;

revoke execute on function public.tao_khach_xe(text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.tao_khach_xe(text, text, text, text, text, text, uuid) to authenticated;
