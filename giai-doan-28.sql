

-- GIAI ĐOẠN 28: Hủy phiếu đảo ĐẦY ĐỦ (kho + khoản thu + chi phí + sổ quỹ), công cụ sửa phiếu đã hủy còn sót, đối chiếu
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất dữ liệu, không ghi trùng). Cần đã chạy giai-doan-20, 21, 22 và 26.
-- Ở cuối file có 1 câu lệnh chỉ ĐỌC: liệt kê toàn bộ bản ghi của phiếu PT0023 (đổi số 23 để xem phiếu khác).
--
-- ===== NỘI DUNG =====
--  * "Hủy phiếu" (chỉ Chủ, lý do bắt buộc) giờ làm TRONG CÙNG MỘT GIAO DỊCH:
--      1) Hoàn kho qua sổ kho (dòng huy_phieu) theo đúng số đã trừ của phiếu.
--      2) Mọi khoản thu chưa hủy: đánh dấu hủy (lý do "Hủy phiếu PTxxxx: ...") -> hệ thống tự thêm dòng ĐẢO trong sổ quỹ.
--      3) Mọi chi phí phiếu chưa hủy: đánh dấu hủy (lý do "Hủy phiếu PTxxxx: ..."); chi phí đã ghi sổ quỹ thì thêm dòng ĐẢO
--         cho dòng quỹ liên kết; chi phí "Chưa chi" chỉ đánh dấu hủy.
--      4) Đánh dấu phiếu đã hủy -> loại khỏi doanh thu, lợi nhuận, công nợ (cách tính các số này KHÔNG đổi).
--    Mọi dòng đảo có lý do, người thực hiện, giờ máy chủ và được ghi nhật ký hoạt động. Không xóa, không sửa dòng cũ.
--  * Công cụ sửa một lần cho phiếu ĐÃ HỦY còn sót thu / chi / kho:
--      dao_phieu_da_huy_xem_truoc() = "Xem trước"; dao_phieu_da_huy('DAO PHIEU DA HUY') = thực hiện. Chỉ Chủ.
--  * Đối chiếu: phieu_huy_doi_chieu() liệt kê phiếu đã hủy mà tổng thu / tổng chi / tồn kho ròng khác 0.

-- 1. Hàm phụ (nội bộ, giao diện không gọi trực tiếp) ------------------------------------------------------------
create or replace function public.hp_ma(p_code bigint) returns text
language sql immutable as $$ select 'PT' || lpad(coalesce(p_code, 0)::text, 4, '0') $$;

-- 1a. Hoàn kho: mỗi phụ tùng có tồn ròng khác 0 trong sổ kho của phiếu thì cộng/trừ ngược lại cho về 0
create or replace function public.hp_dao_kho(p_order uuid, p_ma text, p_ly text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy phiếu'; end if;
  for r in select l.part_id, sum(l.so_luong) as net from public.stock_ledger l
           where l.order_id = p_order and l.part_id is not null
           group by l.part_id having sum(l.so_luong) <> 0 order by l.part_id loop
    if public.dv_da_doi_sau(r.part_id, p_order, null) then
      raise exception 'Có phụ tùng đã đổi đơn vị sau khi bán nên không tự hoàn kho được. Hãy dùng "Kiểm kê điều chỉnh" cho phụ tùng đó rồi hủy phiếu lại';
    end if;
    perform public.doi_ton(r.part_id, -r.net, 'huy_phieu', p_order, null, p_ly);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.hp_dao_kho(uuid, text, text) from public, anon, authenticated;

-- 1b. Khoản thu: đánh dấu hủy mọi khoản thu còn hiệu lực -> trigger giai đoạn 21 tự thêm dòng đảo trong sổ quỹ
-- (khoản thu đã có "dòng đảo" kiểu cũ của giai đoạn 22 thì bỏ qua, vì đã trừ nhau bằng 0)
create or replace function public.hp_dao_thu(p_order uuid, p_ly text) returns integer
language plpgsql security definer set search_path = public as $$
declare pm record; n int := 0; v_ten text;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy phiếu'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());
  perform set_config('app.huy_thu', '1', true);
  perform set_config('app.hanh_dong', 'dao_khoan_thu', true);
  perform set_config('app.ly_do', p_ly, true);
  for pm in select p.id from public.order_payments p
            where p.order_id = p_order and not p.da_huy and p.loai in ('thu', 'dieu_chinh') and p.so_tien <> 0
              and not exists (select 1 from public.order_payments d where d.ref_id = p.id and d.loai = 'dao' and not d.da_huy)
            order by p.seq loop
    update public.order_payments set da_huy = true, huy_ly_do = p_ly, huy_boi = auth.uid(), huy_boi_ten = v_ten, huy_luc = now()
      where id = pm.id;
    n := n + 1;
  end loop;
  perform set_config('app.huy_thu', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  return n;
end $$;
revoke execute on function public.hp_dao_thu(uuid, text) from public, anon, authenticated;

-- 1c. Chi phí phiếu: đảo dòng quỹ liên kết (nếu có) rồi đánh dấu hủy chi phí chưa hủy
create or replace function public.hp_dao_chi_phi(p_order uuid, p_ly text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_ten text; v_dao int := 0; v_huy int := 0; n int;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy phiếu'; end if;
  v_ten := public.ten_nguoi_dung(auth.uid());
  for c in select * from public.repair_costs where order_id = p_order order by created_at, id loop
    n := public.cp_dao(c.id, p_ly);   -- đảo dòng chi đang hiệu lực trong sổ quỹ (không có thì trả 0)
    v_dao := v_dao + n;
    if not c.da_huy then
      perform set_config('app.huy_cp', '1', true);
      perform set_config('app.hanh_dong', 'huy_chi_phi', true);
      perform set_config('app.ly_do', p_ly, true);
      update public.repair_costs set da_huy = true, huy_ly_do = p_ly, huy_boi = auth.uid(), huy_boi_ten = v_ten, huy_luc = now()
        where id = c.id;
      perform set_config('app.huy_cp', '', true);
      perform set_config('app.hanh_dong', '', true);
      perform set_config('app.ly_do', '', true);
      insert into public.repair_cost_logs (order_id, action, kind, content, amount_before, amount_after, note, detail, created_by_name)
        values (p_order, 'huy', c.kind, c.content, c.amount, null, c.note,
                'Hủy chi phí do hủy phiếu. Lý do: ' || p_ly || case when n > 0 then ' (đã đảo ' || n || ' dòng sổ quỹ)' else '' end, v_ten);
      v_huy := v_huy + 1;
    end if;
  end loop;
  return jsonb_build_object('huy_chi_phi', v_huy, 'dao_quy', v_dao);
end $$;
revoke execute on function public.hp_dao_chi_phi(uuid, text) from public, anon, authenticated;

-- 2. Hủy phiếu (thay bản của giai đoạn 22) ---------------------------------------------------------------------
create or replace function public.huy_phieu(p_order uuid, p_ly_do text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; v_ly text := btrim(coalesce(p_ly_do, '')); v_ten text; v_ma text; v_full text; v_kho int; v_thu int; v_cp jsonb;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được hủy phiếu'; end if;
  if v_ly = '' then raise exception 'Bắt buộc nhập lý do hủy phiếu'; end if;
  if char_length(v_ly) > 500 then raise exception 'Lý do quá dài (tối đa 500 ký tự)'; end if;
  perform pg_advisory_xact_lock(7210021);
  select * into o from public.repair_orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if o.da_huy then raise exception 'Phiếu này đã hủy rồi'; end if;
  v_ma := public.hp_ma(o.code);
  v_ten := public.ten_nguoi_dung(auth.uid());
  v_full := 'Hủy phiếu ' || v_ma || ': ' || v_ly;

  v_kho := public.hp_dao_kho(p_order, v_ma, v_full);
  v_thu := public.hp_dao_thu(p_order, v_full);
  v_cp := public.hp_dao_chi_phi(p_order, v_full);

  perform set_config('app.tai_chinh', '1', true);
  perform set_config('app.hanh_dong', 'huy_phieu', true);
  perform set_config('app.ly_do', v_ly, true);
  update public.repair_orders set status = 'Đã hủy', da_huy = true, huy_ly_do = v_ly, huy_boi = auth.uid(),
         huy_boi_ten = v_ten, huy_luc = now() where id = p_order;
  perform set_config('app.tai_chinh', '', true);
  perform set_config('app.hanh_dong', '', true);
  perform set_config('app.ly_do', '', true);
  return jsonb_build_object('hoan_kho', v_kho, 'dao_khoan_thu', v_thu) || v_cp;
end $$;
revoke execute on function public.huy_phieu(uuid, text) from public, anon;
grant execute on function public.huy_phieu(uuid, text) to authenticated;

-- 3. Đối chiếu phiếu đã hủy (chỉ Chủ): phiếu nào còn lệch thì liệt kê ----------------------------------------------
-- Phiếu hủy đúng: tổng thu = 0, tổng quỹ thu = 0, chi phí chưa hủy = 0, quỹ chi liên kết = 0, tồn kho ròng từng phụ tùng = 0
create or replace function public.phieu_huy_doi_chieu()
returns table (o_order uuid, o_ma_phieu text, o_khach text, o_huy_luc timestamptz, o_thu numeric, o_thu_quy numeric,
               o_chi_phi numeric, o_chi_quy numeric, o_kho_dong integer, o_kho_lech numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được đối chiếu'; end if;
  return query
    select q.a, q.b, q.c, q.d, q.e, q.f, q.g, q.h, q.i, q.j
    from (
      select o.id as a, public.hp_ma(o.code) as b, cu.name as c, o.huy_luc as d,
             coalesce((select sum(p.so_tien) from public.order_payments p where p.order_id = o.id and not p.da_huy), 0)::numeric as e,
             coalesce((select sum(s.so_tien) from public.so_quy s where s.order_id = o.id and s.payment_id is not null), 0)::numeric as f,
             coalesce((select sum(rc.amount) from public.repair_costs rc where rc.order_id = o.id and not rc.da_huy), 0)::numeric as g,
             coalesce((select -sum(s.so_tien) from public.so_quy s
                       where s.chi_phi_id in (select rc.id from public.repair_costs rc where rc.order_id = o.id)), 0)::numeric as h,
             (select count(*) from (select 1 from public.stock_ledger l where l.order_id = o.id and l.part_id is not null
                                    group by l.part_id having sum(l.so_luong) <> 0) k)::integer as i,
             coalesce((select sum(abs(t.n)) from (select sum(l.so_luong) as n from public.stock_ledger l
                                                  where l.order_id = o.id and l.part_id is not null group by l.part_id) t), 0)::numeric as j
      from public.repair_orders o left join public.customers cu on cu.id = o.customer_id
      where o.da_huy
    ) q
    where q.e <> 0 or q.f <> 0 or q.g <> 0 or q.h <> 0 or q.i <> 0
    order by q.b;
end $$;
revoke execute on function public.phieu_huy_doi_chieu() from public, anon;
grant execute on function public.phieu_huy_doi_chieu() to authenticated;

-- 4. Công cụ sửa một lần ---------------------------------------------------------------------------------------
-- 4a. Xem trước: từng phiếu, số tiền sẽ đảo, ảnh hưởng số dư từng quỹ. Chỉ ĐỌC, không ghi gì.
create or replace function public.dao_phieu_da_huy_xem_truoc()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_kq jsonb;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được xem'; end if;

  with ds as (select * from public.phieu_huy_doi_chieu()),
  thu as (   -- khoản thu sẽ hủy + dòng quỹ sẽ đảo
    select p.order_id, p.id as pid, p.so_tien, p.hinh_thuc,
           (select s.quy from public.so_quy s where s.payment_id = p.id and s.loai = 'thu'
              and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) limit 1) as quy,
           (select -s.so_tien from public.so_quy s where s.payment_id = p.id and s.loai = 'thu'
              and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) limit 1) as quy_doi,
           (select s.ngay from public.so_quy s where s.payment_id = p.id and s.loai = 'thu'
              and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) limit 1) as quy_ngay
    from public.order_payments p join ds on ds.o_order = p.order_id
    where not p.da_huy and p.loai in ('thu', 'dieu_chinh') and p.so_tien <> 0
      and not exists (select 1 from public.order_payments d where d.ref_id = p.id and d.loai = 'dao' and not d.da_huy)
  ),
  chi as (   -- chi phí sẽ hủy / dòng chi quỹ sẽ đảo
    select rc.order_id, rc.id as cid, rc.amount, rc.da_huy, rc.content,
           (select s.quy from public.so_quy s where s.chi_phi_id = rc.id and s.loai = 'chi'
              and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) limit 1) as quy,
           (select -s.so_tien from public.so_quy s where s.chi_phi_id = rc.id and s.loai = 'chi'
              and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) limit 1) as quy_doi,
           (select s.ngay from public.so_quy s where s.chi_phi_id = rc.id and s.loai = 'chi'
              and not exists (select 1 from public.so_quy d where d.dao_cua = s.id) limit 1) as quy_ngay
    from public.repair_costs rc join ds on ds.o_order = rc.order_id
  ),
  kho as (
    select l.order_id, l.part_id, max(l.part_name) as ten, -sum(l.so_luong) as hoan
    from public.stock_ledger l join ds on ds.o_order = l.order_id
    where l.part_id is not null group by l.order_id, l.part_id having sum(l.so_luong) <> 0
  ),
  dq as (    -- mọi dòng quỹ sẽ thêm (chỉ tính vào số dư nếu ngày >= ngày bắt đầu của quỹ)
    select t.quy, t.quy_doi, (t.quy_ngay >= c.ngay_bat_dau) as tinh from thu t left join public.quy_cai_dat c on c.quy = t.quy where t.quy is not null
    union all
    select t.quy, t.quy_doi, (t.quy_ngay >= c.ngay_bat_dau) from chi t left join public.quy_cai_dat c on c.quy = t.quy where t.quy is not null and t.quy_doi is not null
  )
  select jsonb_build_object('phieu',
    coalesce((select jsonb_agg(jsonb_build_object(
      'order_id', ds.o_order, 'ma_phieu', ds.o_ma_phieu, 'khach', ds.o_khach, 'huy_luc', ds.o_huy_luc,
      'thu_con', ds.o_thu, 'thu_quy_con', ds.o_thu_quy, 'chi_phi_con', ds.o_chi_phi, 'chi_quy_con', ds.o_chi_quy,
      'so_khoan_thu', (select count(*) from thu where thu.order_id = ds.o_order),
      'tien_thu', coalesce((select sum(thu.so_tien) from thu where thu.order_id = ds.o_order), 0),
      'so_chi_phi', (select count(*) from chi where chi.order_id = ds.o_order and not chi.da_huy),
      'tien_chi_phi', coalesce((select sum(chi.amount) from chi where chi.order_id = ds.o_order and not chi.da_huy), 0),
      'tien_chi_quy', coalesce((select sum(chi.quy_doi) from chi where chi.order_id = ds.o_order and chi.quy is not null), 0),
      'quy', coalesce((select jsonb_agg(x) from (
                select jsonb_build_object('quy', z.quy, 'thay_doi', sum(z.v)) as x
                from (select thu.quy, thu.quy_doi as v from thu where thu.order_id = ds.o_order and thu.quy is not null
                      union all select chi.quy, chi.quy_doi from chi where chi.order_id = ds.o_order and chi.quy is not null) z
                group by z.quy) y), '[]'::jsonb),
      'kho', coalesce((select jsonb_agg(jsonb_build_object('ten', kho.ten, 'so_luong', kho.hoan)) from kho where kho.order_id = ds.o_order), '[]'::jsonb)
    ) order by ds.o_ma_phieu) from ds), '[]'::jsonb),
    'quy',
    coalesce((select jsonb_agg(jsonb_build_object(
      'quy', c.quy, 'so_du_truoc', public.quy_so_du_noi_bo(c.quy),
      'thay_doi', coalesce((select sum(dq.quy_doi) from dq where dq.quy = c.quy and coalesce(dq.tinh, false)), 0),
      'so_du_sau', public.quy_so_du_noi_bo(c.quy) + coalesce((select sum(dq.quy_doi) from dq where dq.quy = c.quy and coalesce(dq.tinh, false)), 0)
    ) order by c.quy) from public.quy_cai_dat c), '[]'::jsonb))
  into v_kq;

  return v_kq;
end $$;
revoke execute on function public.dao_phieu_da_huy_xem_truoc() from public, anon;
grant execute on function public.dao_phieu_da_huy_xem_truoc() to authenticated;

-- 4b. Thực hiện: phải gõ đúng cụm DAO PHIEU DA HUY. Chỉ thêm dòng đảo / đánh dấu hủy, không xóa gì.
-- Mỗi phiếu làm trong 1 giao dịch con: phiếu nào lỗi (vd. phụ tùng đã đổi đơn vị) thì bỏ qua và báo lại, các phiếu khác vẫn đảo.
create or replace function public.dao_phieu_da_huy(p_xac_nhan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; o record; v_ma text; v_full text; v_ok int := 0; v_loi jsonb := '[]'::jsonb; v_kho int; v_thu int; v_cp jsonb;
begin
  if not public.la_chu() then raise exception 'Chỉ Chủ xưởng được dùng công cụ này'; end if;
  if btrim(coalesce(p_xac_nhan, '')) <> 'DAO PHIEU DA HUY' then raise exception 'Hãy gõ đúng cụm DAO PHIEU DA HUY để xác nhận'; end if;
  perform pg_advisory_xact_lock(7210021);
  for r in select d.o_order from public.phieu_huy_doi_chieu() d order by d.o_ma_phieu loop
    begin
      select * into o from public.repair_orders where id = r.o_order for update;
      v_ma := public.hp_ma(o.code);
      v_full := 'Hủy phiếu ' || v_ma || ' (đảo bù phần còn sót): ' || coalesce(o.huy_ly_do, '');
      v_kho := public.hp_dao_kho(o.id, v_ma, v_full);
      v_thu := public.hp_dao_thu(o.id, v_full);
      v_cp := public.hp_dao_chi_phi(o.id, v_full);
      perform public.ghi_nhat_ky('dao_phieu_da_huy', 'Phiếu sửa chữa', v_ma, null, o.code, 'repair_orders', o.id, null,
        jsonb_build_object('hoan_kho', v_kho, 'dao_khoan_thu', v_thu) || v_cp, v_full);
      v_ok := v_ok + 1;
    exception when others then
      v_loi := v_loi || jsonb_build_object('ma_phieu', public.hp_ma(o.code), 'loi', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('da_dao', v_ok, 'loi', v_loi);
end $$;
revoke execute on function public.dao_phieu_da_huy(text) from public, anon;
grant execute on function public.dao_phieu_da_huy(text) to authenticated;

notify pgrst, 'reload schema';

-- 5. CHỈ ĐỌC: toàn bộ bản ghi liên quan của 1 phiếu (đổi số 23 để xem phiếu khác) -----------------------------------
-- Cột trang_thai cho biết bản ghi đã đảo / đã hủy hay CHƯA.
select x.nhom, x.noi_dung, x.so_tien, x.trang_thai
from (
  select 1 as t, o.seq_ord, 'Phiếu' as nhom, public.hp_ma(o.code) || ' - ' || o.status as noi_dung, null::numeric as so_tien,
         case when o.da_huy then 'ĐÃ HỦY lúc ' || to_char(o.huy_luc at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') else 'chưa hủy' end as trang_thai
  from (select r.*, 0 as seq_ord from public.repair_orders r where r.code = 23) o
  union all
  select 2, 0, 'Dòng phiếu', i.name || ' x' || i.qty, i.qty * i.unit_price, 'còn trên phiếu'
  from public.repair_items i join public.repair_orders o on o.id = i.order_id where o.code = 23
  union all
  select 3, p.seq::int, 'Khoản thu', p.loai || ' · ' || p.hinh_thuc, p.so_tien,
         case when p.da_huy then 'ĐÃ HỦY'
              when p.loai = 'dao' then 'dòng đảo'
              when exists (select 1 from public.order_payments d where d.ref_id = p.id and d.loai = 'dao' and not d.da_huy) then 'ĐÃ ĐẢO (có dòng đảo)'
              else 'CHƯA ĐẢO' end
  from public.order_payments p join public.repair_orders o on o.id = p.order_id where o.code = 23
  union all
  select 4, 0, 'Chi phí phiếu', c.content || ' (' || c.trang_thai_quy || ')', c.amount,
         case when c.da_huy then 'ĐÃ HỦY' else 'CHƯA HỦY' end
  from public.repair_costs c join public.repair_orders o on o.id = c.order_id where o.code = 23
  union all
  select 5, s.seq::int, 'Sổ quỹ', s.loai || ' · ' || s.quy || coalesce(' · ' || s.so_phieu, ''), s.so_tien,
         case when s.dao_cua is not null then 'dòng đảo'
              when exists (select 1 from public.so_quy d where d.dao_cua = s.id) then 'ĐÃ ĐẢO'
              when s.loai in ('thu', 'chi') then 'CHƯA ĐẢO' else '' end
  from public.so_quy s join public.repair_orders o on o.id = s.order_id where o.code = 23
  union all
  select 6, l.seq::int, 'Sổ kho', coalesce(l.part_name, '?') || ' · ' || l.loai, l.so_luong, ''
  from public.stock_ledger l join public.repair_orders o on o.id = l.order_id where o.code = 23
  union all
  select 7, 0, 'Tồn kho ròng', n.ten, n.net, case when n.net = 0 then 'đã về 0' else 'CHƯA VỀ 0' end
  from (select max(l.part_name) as ten, sum(l.so_luong) as net from public.stock_ledger l
        join public.repair_orders o on o.id = l.order_id where o.code = 23 group by l.part_id) n
) x
order by x.t, x.noi_dung;
