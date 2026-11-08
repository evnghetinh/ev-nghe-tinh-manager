-- GIAI ĐOẠN 22: Thanh toán nhiều lần cho phiếu sửa chữa, hoàn thành khi còn nợ
-- Cách dùng: Supabase -> SQL Editor -> dán toàn bộ -> Run. Chạy lại an toàn. Cần đã chạy giai-doan-20 và 21.
--  * Thu tiền nhiều lần, kể cả khi phiếu chưa hoàn thành; tổng thu không vượt tổng phiếu. Mọi vai trò được thu.
--  * Mỗi lần thu tự vào sổ quỹ (Tiền mặt -> quỹ Tiền mặt, Chuyển khoản -> quỹ Tài khoản) qua trigger giai đoạn 21.
--  * Hoàn thành không tự ghi thu đủ nữa: phần chưa thu = còn nợ (tổng phiếu - đã thu).
--  * Doanh thu / lợi nhuận vẫn tính từ dòng phiếu + ngày hoàn thành (paid_at) như cũ.
--  * Sửa phiếu đã hoàn thành không ghi dòng "điều chỉnh" tiền nữa (tránh coi chênh lệch là tiền thu). Dòng cũ giữ nguyên.

-- 1. Mọi vai trò xem được khoản thu
drop policy if exists tt_chi_chu_xem on public.order_payments;
drop policy if exists tt_moi_vai_tro_xem on public.order_payments;
create policy tt_moi_vai_tro_xem on public.order_payments for select to authenticated using (public.vai_tro() is not null);

-- 2. Ghi khoản thu: mọi vai trò, cả phiếu chưa hoàn thành
create or replace function public.ghi_khoan_thu(p_order uuid, p_so_tien numeric, p_hinh_thuc text, p_ngay date, p_ghi_chu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o record; v_total numeric; v_da numeric; v_id uuid;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_hinh_thuc not in ('Tiền mặt', 'Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if p_so_tien is null or p_so_tien <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  select coalesce(sum(qty * unit_price), 0) into v_total from public.repair_items where order_id = p_order;
  select coalesce(sum(so_tien), 0) into v_da from public.order_payments where order_id = p_order and not da_huy;
  if v_da + p_so_tien > v_total + 0.5 then
    raise exception 'Số thu vượt số còn nợ: tổng phiếu % đ, đã thu % đ, còn nợ % đ', round(v_total), round(v_da), round(v_total - v_da);
  end if;
  insert into public.order_payments (order_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu)
    values (p_order, 'thu', round(p_so_tien), p_hinh_thuc, coalesce(p_ngay, public.ngay_hom_nay()), nullif(btrim(coalesce(p_ghi_chu, '')), ''))
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.ghi_khoan_thu(uuid, numeric, text, date, text) from public, anon;
grant execute on function public.ghi_khoan_thu(uuid, numeric, text, date, text) to authenticated;

-- 3. Hoàn thành: trừ kho, chốt giá vốn, KHÔNG tự ghi thu đủ (phần chưa thu là nợ)
create or replace function public.hoan_thanh_phieu(p_order uuid, p_method text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare o record; r record;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  if p_method not in ('Tiền mặt', 'Chuyển khoản') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu đã hủy, không thể hoàn thành'; end if;
  if o.stock_deducted then raise exception 'Phiếu này đã hoàn thành rồi'; end if;
  if not exists (select 1 from public.repair_items where order_id = p_order) then raise exception 'Phiếu chưa có dòng nào'; end if;

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
end $$;
revoke execute on function public.hoan_thanh_phieu(uuid, text, date) from public, anon;
grant execute on function public.hoan_thanh_phieu(uuid, text, date) to authenticated;

-- 4. Phiếu chưa hoàn thành: không xóa dòng làm tổng phiếu thấp hơn số đã thu
create or replace function public.phieu_xoa_dong(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it record; o record; v_moi numeric; v_da numeric;
begin
  if public.vai_tro() is null then raise exception 'Bạn không có quyền thực hiện'; end if;
  select * into it from public.repair_items where id = p_item;
  if not found then raise exception 'Không tìm thấy dòng (có thể đã bị xóa)'; end if;
  select * into o from public.repair_orders where id = it.order_id for update;
  if o.da_huy then raise exception 'Phiếu đã hủy'; end if;
  if o.stock_deducted then raise exception 'Phiếu đã hoàn thành: Chủ xưởng dùng "Mở chỉnh sửa"'; end if;
  select coalesce(sum(qty * unit_price), 0) - it.qty * it.unit_price into v_moi from public.repair_items where order_id = it.order_id;
  select coalesce(sum(so_tien), 0) into v_da from public.order_payments where order_id = it.order_id and not da_huy;
  if v_da > v_moi + 0.5 then
    raise exception 'Đã thu % đ, xóa dòng này tổng phiếu chỉ còn % đ. Hãy hủy bớt khoản thu trước', round(v_da), round(v_moi);
  end if;
  delete from public.repair_items where id = p_item;
end $$;
revoke execute on function public.phieu_xoa_dong(uuid) from public, anon;
grant execute on function public.phieu_xoa_dong(uuid) to authenticated;

-- 5. Sửa phiếu đã hoàn thành: không ghi dòng điều chỉnh tiền nữa (nợ = tổng phiếu - đã thu)
create or replace function public.dong_phieu_dieu_chinh_thu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  return null;
end $$;
revoke execute on function public.dong_phieu_dieu_chinh_thu() from public, anon, authenticated;

-- 6. Hủy phiếu: đảo khoản thu cả khi phiếu chưa hoàn thành (kho chỉ hoàn nếu đã trừ)
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
  end if;

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
revoke execute on function public.huy_phieu(uuid, text) from public, anon;
grant execute on function public.huy_phieu(uuid, text) to authenticated;
