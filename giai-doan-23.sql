-- GIAI ĐOẠN 23: Trang "Công nợ khách"
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run. Chạy lại nhiều lần vẫn an toàn.
-- Cần đã chạy giai-doan-20, 21, 22.
-- File này KHÔNG đổi cách tính doanh thu, lợi nhuận, tồn kho, sổ quỹ.
--  * Công nợ của phiếu = tổng dòng phiếu - tổng khoản thu chưa hủy. Chỉ tính phiếu đã hoàn thành và chưa hủy.
--  * Thu nợ dùng đúng hàm ghi_khoan_thu (tự vào sổ quỹ đúng quỹ và ghi nhật ký). Nhân viên được thu nợ.
--  * Ghi chú / ngày hẹn trả: chỉ thêm dòng (lưu lịch sử), không sửa, không xóa.
--  * Nhân viên chỉ thấy số liệu bán hàng (tổng phiếu, đã thu, còn nợ). Không có giá nhập, chi phí, lợi nhuận, số dư quỹ.

-- 1. Ghi chú + ngày hẹn trả của khách (lịch sử) -----------------------------------------------------
create table if not exists public.cong_no_ghi_chu (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  customer_id uuid not null references public.customers(id) on delete restrict,
  ngay_hen date,
  ghi_chu text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists cong_no_ghi_chu_kh_idx on public.cong_no_ghi_chu (customer_id, seq desc);

-- Người thực hiện + giờ do máy chủ đặt; chặn sửa / xóa / truncate
drop trigger if exists ep_nguoi_thuc_hien on public.cong_no_ghi_chu;
create trigger ep_nguoi_thuc_hien before insert on public.cong_no_ghi_chu
  for each row execute function public.ep_nguoi_thuc_hien();
drop trigger if exists chan_sua_xoa on public.cong_no_ghi_chu;
create trigger chan_sua_xoa before update or delete on public.cong_no_ghi_chu
  for each row execute function public.chan_sua_xoa_nhat_ky();
drop trigger if exists chan_truncate on public.cong_no_ghi_chu;
create trigger chan_truncate before truncate on public.cong_no_ghi_chu
  for each statement execute function public.chan_sua_xoa_nhat_ky();

alter table public.cong_no_ghi_chu enable row level security;
revoke all on public.cong_no_ghi_chu from anon;
revoke all on public.cong_no_ghi_chu from authenticated;
grant select on public.cong_no_ghi_chu to authenticated;
drop policy if exists cnqc_moi_vai_tro_xem on public.cong_no_ghi_chu;
create policy cnqc_moi_vai_tro_xem on public.cong_no_ghi_chu for select to authenticated using (public.vai_tro() is not null);

-- 2. Danh sách phiếu đang nợ (chỉ số liệu bán hàng) ----------------------------------------------
create or replace function public.cong_no_phieu()
returns table (order_id uuid, ma_phieu bigint, customer_id uuid, bien_so text, ngay_hoan_thanh date, tong numeric, da_thu numeric, con_no numeric)
language sql stable security definer set search_path = public as $$
  select o.id, o.code, o.customer_id, v.plate, o.paid_at, t.tong, coalesce(p.da_thu, 0), t.tong - coalesce(p.da_thu, 0)
  from public.repair_orders o
  join public.vehicles v on v.id = o.vehicle_id
  cross join lateral (select coalesce(sum(ri.qty * ri.unit_price), 0) as tong from public.repair_items ri where ri.order_id = o.id) t
  left join lateral (select sum(op.so_tien) as da_thu from public.order_payments op where op.order_id = o.id and not op.da_huy) p on true
  where public.vai_tro() is not null
    and o.stock_deducted and not o.da_huy
    and t.tong - coalesce(p.da_thu, 0) > 0.5
$$;
revoke execute on function public.cong_no_phieu() from public, anon;
grant execute on function public.cong_no_phieu() to authenticated;

-- 3. Tổng nợ (cho thẻ ở Tổng quan), tính độc lập theo từng phiếu -----------------------------------
create or replace function public.cong_no_tong()
returns table (tong numeric, so_khach bigint, so_phieu bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select o.customer_id,
           (select coalesce(sum(ri.qty * ri.unit_price), 0) from public.repair_items ri where ri.order_id = o.id)
         - (select coalesce(sum(op.so_tien), 0) from public.order_payments op where op.order_id = o.id and not op.da_huy) as no
    from public.repair_orders o
    where public.vai_tro() is not null and o.stock_deducted and not o.da_huy
  )
  select coalesce(sum(no), 0), count(distinct customer_id), count(*) from x where no > 0.5
$$;
revoke execute on function public.cong_no_tong() from public, anon;
grant execute on function public.cong_no_tong() to authenticated;

-- 4. Liệt kê chỗ lệch: phiếu thu thừa, phiếu đã hủy còn khoản thu chưa đảo -----------------------------
create or replace function public.cong_no_doi_chieu()
returns table (loai text, order_id uuid, ma_phieu bigint, ten_khach text, tong numeric, da_thu numeric, chenh numeric)
language sql stable security definer set search_path = public as $$
  select case when o.da_huy then 'Phiếu đã hủy nhưng còn khoản thu chưa đảo' else 'Đã thu nhiều hơn tổng phiếu' end,
         o.id, o.code, c.name, s.tong, s.da_thu, s.da_thu - s.tong
  from public.repair_orders o
  join public.customers c on c.id = o.customer_id
  cross join lateral (
    select (select coalesce(sum(ri.qty * ri.unit_price), 0) from public.repair_items ri where ri.order_id = o.id) as tong,
           (select coalesce(sum(op.so_tien), 0) from public.order_payments op where op.order_id = o.id and not op.da_huy) as da_thu
  ) s
  where public.vai_tro() is not null
    and ((o.da_huy and abs(s.da_thu) > 0.5) or (o.stock_deducted and not o.da_huy and s.da_thu - s.tong > 0.5))
  order by o.code
$$;
revoke execute on function public.cong_no_doi_chieu() from public, anon;
grant execute on function public.cong_no_doi_chieu() to authenticated;

-- 5. Thu nợ: phân bổ vào phiếu cũ nhất trước, mỗi phiếu dùng ghi_khoan_thu ------------------------------
-- p_phan_bo (chỉ Chủ): [{"order_id":"...","so_tien":123000}, ...] để chọn từng phiếu. Bỏ trống = cũ nhất trước.
create or replace function public.thu_no_khach(p_customer uuid, p_so_tien numeric, p_hinh_thuc text, p_ngay date, p_ghi_chu text, p_phan_bo jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; it jsonb; v_ten text; v_tien numeric; v_tong numeric; v_con numeric; v_thu numeric; v_n int := 0; v_sum numeric := 0;
  v_gc text := 'Thu nợ' || coalesce(': ' || nullif(btrim(coalesce(p_ghi_chu, '')), ''), '');
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_hinh_thuc not in ('Tiền mặt', 'Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if p_so_tien is null or p_so_tien <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  v_tien := round(p_so_tien);
  select name into v_ten from public.customers where id = p_customer;
  if not found then raise exception 'Không tìm thấy khách'; end if;
  -- khóa các phiếu của khách để hai người thu cùng lúc không thu trùng
  perform 1 from public.repair_orders where customer_id = p_customer order by id for update;
  select coalesce(sum(con_no), 0) into v_tong from public.cong_no_phieu() where customer_id = p_customer;
  if v_tien > v_tong + 0.5 then
    raise exception 'Số thu vượt tổng nợ: khách còn nợ % đ, bạn nhập % đ', round(v_tong), v_tien;
  end if;

  if p_phan_bo is null then
    v_sum := v_tien;
    for r in select order_id, con_no from public.cong_no_phieu() where customer_id = p_customer order by ngay_hoan_thanh, ma_phieu loop
      exit when v_sum <= 0;
      v_thu := least(v_sum, floor(r.con_no + 0.5));
      if v_thu <= 0 then continue; end if;
      perform public.ghi_khoan_thu(r.order_id, v_thu, p_hinh_thuc, p_ngay, v_gc);
      v_sum := v_sum - v_thu; v_n := v_n + 1;
    end loop;
    if v_sum > 0.5 then raise exception 'Không phân bổ hết số tiền (còn % đ)', v_sum; end if;
  else
    if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được chọn từng phiếu để thu'; end if;
    if jsonb_typeof(p_phan_bo) <> 'array' or jsonb_array_length(p_phan_bo) = 0 then raise exception 'Chưa chọn phiếu nào'; end if;
    for it in select * from jsonb_array_elements(p_phan_bo) loop
      v_thu := round((it->>'so_tien')::numeric);
      if v_thu is null or v_thu <= 0 then raise exception 'Số tiền từng phiếu phải lớn hơn 0'; end if;
      select con_no into v_con from public.cong_no_phieu() where order_id = (it->>'order_id')::uuid and customer_id = p_customer;
      if not found then raise exception 'Có phiếu không thuộc khách này hoặc đã hết nợ'; end if;
      v_sum := v_sum + v_thu;
    end loop;
    if abs(v_sum - v_tien) > 0.5 then raise exception 'Tổng tiền các phiếu (% đ) phải bằng số tiền thu (% đ)', v_sum, v_tien; end if;
    for it in select * from jsonb_array_elements(p_phan_bo) loop
      perform public.ghi_khoan_thu((it->>'order_id')::uuid, round((it->>'so_tien')::numeric), p_hinh_thuc, p_ngay, v_gc);
      v_n := v_n + 1;
    end loop;
  end if;

  perform public.ghi_nhat_ky('thu_no_khach', 'Công nợ khách', null, v_ten, null, 'order_payments', null,
    jsonb_build_object('tong_no_truoc', round(v_tong)),
    jsonb_build_object('so_tien', v_tien, 'so_phieu', v_n, 'hinh_thuc', p_hinh_thuc, 'tong_no_sau', round(v_tong - v_tien)),
    nullif(btrim(coalesce(p_ghi_chu, '')), ''));
  return jsonb_build_object('so_phieu', v_n, 'da_thu', v_tien, 'con_no', round(v_tong - v_tien));
end $$;
revoke execute on function public.thu_no_khach(uuid, numeric, text, date, text, jsonb) from public, anon;
grant execute on function public.thu_no_khach(uuid, numeric, text, date, text, jsonb) to authenticated;

-- 6. Ghi chú / ngày hẹn trả (thêm dòng mới, giữ lịch sử) ----------------------------------------------
create or replace function public.cong_no_ghi_chu_them(p_customer uuid, p_ngay_hen date, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ten text; v_id uuid; v_gc text := nullif(btrim(coalesce(p_ghi_chu, '')), '');
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if v_gc is null and p_ngay_hen is null then raise exception 'Hãy nhập ngày hẹn trả hoặc ghi chú'; end if;
  if char_length(coalesce(v_gc, '')) > 500 then raise exception 'Ghi chú quá dài (tối đa 500 ký tự)'; end if;
  select name into v_ten from public.customers where id = p_customer;
  if not found then raise exception 'Không tìm thấy khách'; end if;
  insert into public.cong_no_ghi_chu (customer_id, ngay_hen, ghi_chu) values (p_customer, p_ngay_hen, v_gc) returning id into v_id;
  perform public.ghi_nhat_ky('ghi_chu_cong_no', 'Công nợ khách', null, v_ten, null, 'cong_no_ghi_chu', v_id, null,
    jsonb_build_object('ngay_hen', p_ngay_hen, 'ghi_chu', v_gc), null);
  return v_id;
end $$;
revoke execute on function public.cong_no_ghi_chu_them(uuid, date, text) from public, anon;
grant execute on function public.cong_no_ghi_chu_them(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';

-- Kiểm tra (sau khi Run): cả hai phải bằng nhau; so_dong_lech = 0 là khớp
select
  (select coalesce(sum(con_no), 0) from public.cong_no_phieu()) as tong_no_theo_phieu,
  (select tong from public.cong_no_tong()) as tong_no_the_tong_quan,
  (select count(*) from public.cong_no_doi_chieu()) as so_dong_lech,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'cong_no_ghi_chu') as bat_bao_mat_phai_la_true;
