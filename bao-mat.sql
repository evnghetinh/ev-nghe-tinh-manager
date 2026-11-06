-- BẬT BẢO MẬT (Row Level Security) CHO TẤT CẢ BẢNG
-- Cách dùng: Supabase -> SQL Editor -> New query -> dán toàn bộ file này -> Run
-- Có thể chạy lại nhiều lần mà không lỗi. Bảng tạo thêm sau này: chạy lại file này.

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    -- 1. Bật RLS (bắt buộc kiểm tra quyền trước khi đọc/ghi)
    execute format('alter table public.%I enable row level security', t.tablename);

    -- 2. Xóa chính sách cũ cùng tên (để chạy lại không bị lỗi)
    execute format('drop policy if exists %I on public.%I', 'chi_nguoi_dang_nhap', t.tablename);

    -- 3. Chỉ người ĐÃ ĐĂNG NHẬP mới được xem, thêm, sửa, xóa
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      'chi_nguoi_dang_nhap', t.tablename
    );

    -- 4. Thu hồi mọi quyền của người CHƯA đăng nhập (anon)
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end $$;

-- Kiểm tra: cột rowsecurity phải là true ở mọi bảng
select tablename, rowsecurity as da_bat_bao_mat
from pg_tables
where schemaname = 'public'
order by tablename;
