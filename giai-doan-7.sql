-- GIAI ĐOẠN 7: Hình ảnh bằng chứng cho phiếu tiếp nhận
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Chạy lại nhiều lần vẫn an toàn (không mất ảnh, không đổi dữ liệu cũ).
--
--  * Kho ảnh "phieu-anh": RIÊNG TƯ, chỉ người đã đăng nhập (có vai trò) xem được.
--  * Ai có vai trò đều thêm ảnh được; CHỈ Chủ xưởng được xóa. Không ai sửa được ảnh đã tải.
--  * Tối đa 12 ảnh mỗi phiếu (chốt ở cơ sở dữ liệu), mỗi file tối đa 1MB, chỉ nhận JPG/PNG/WebP.
--  * Cần đã chạy giai-doan-4.sql (có hàm vai_tro, la_chu).

-- 1. Bảng ảnh ---------------------------------------------------------------
create table if not exists public.order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id) on delete cascade,
  path text not null unique,
  label text not null default 'Lúc nhận xe' check (label in ('Lúc nhận xe','Đang sửa','Lúc giao xe')),
  note text check (note is null or char_length(note) <= 200),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists order_photos_order_idx on public.order_photos(order_id, created_at);

-- Tự ghi người tải (client không giả mạo được) + giới hạn 12 ảnh / phiếu
create or replace function public.order_photos_truoc_khi_them() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := auth.uid();
  new.created_at := now();
  new.uploaded_by_name := coalesce((select email from auth.users where id = auth.uid()), 'Không rõ');
  perform 1 from public.repair_orders where id = new.order_id for update;  -- tránh tải song song vượt 12
  if (select count(*) from public.order_photos where order_id = new.order_id) >= 12 then
    raise exception 'Mỗi phiếu chỉ được tối đa 12 ảnh.';
  end if;
  return new;
end $$;
drop trigger if exists order_photos_truoc_khi_them on public.order_photos;
create trigger order_photos_truoc_khi_them before insert on public.order_photos
  for each row execute function public.order_photos_truoc_khi_them();

-- 2. RLS bảng ảnh -------------------------------------------------------------
alter table public.order_photos enable row level security;
drop policy if exists order_photos_xem on public.order_photos;
drop policy if exists order_photos_them on public.order_photos;
drop policy if exists order_photos_xoa on public.order_photos;
create policy order_photos_xem on public.order_photos for select to authenticated using (public.vai_tro() is not null);
create policy order_photos_them on public.order_photos for insert to authenticated with check (public.vai_tro() is not null);
create policy order_photos_xoa on public.order_photos for delete to authenticated using (public.la_chu());
-- Không có chính sách update => không ai sửa được nhãn/ghi chú sau khi tải (giữ nguyên bằng chứng)
revoke all on public.order_photos from anon;
grant select, insert, delete on public.order_photos to authenticated;

-- 3. Kho ảnh riêng tư ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('phieu-anh', 'phieu-anh', false, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists phieu_anh_xem on storage.objects;
drop policy if exists phieu_anh_them on storage.objects;
drop policy if exists phieu_anh_xoa on storage.objects;
create policy phieu_anh_xem on storage.objects for select to authenticated
  using (bucket_id = 'phieu-anh' and public.vai_tro() is not null);
create policy phieu_anh_them on storage.objects for insert to authenticated
  with check (bucket_id = 'phieu-anh' and public.vai_tro() is not null);
create policy phieu_anh_xoa on storage.objects for delete to authenticated
  using (bucket_id = 'phieu-anh' and public.la_chu());

notify pgrst, 'reload schema';
