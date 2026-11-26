# Tổng quan dự án EV Nghệ Tĩnh Auto (đọc trước khi sửa code)

Next.js (App Router) + Supabase (PostgreSQL, RLS) + Vercel. Quy tắc bắt buộc ở `CLAUDE.md`.

## 1. Thư mục chính
- `app/login/` trang đăng nhập; `app/(app)/shell.tsx` khung, menu, đọc vai trò; `app/(app)/page.tsx` Tổng quan (chỉ Chủ)
- `app/(app)/tiep-nhan/` danh sách phiếu (`danh-sach.tsx`) + `[id]/` chi tiết phiếu:
  `page.tsx` dòng báo giá, thu tiền, hoàn thành; `giam-vat.tsx` giảm giá/VAT; `costs.tsx` chi phí phiếu + lợi nhuận;
  `tach.tsx` tách công/phụ tùng; `ev.tsx` thông tin xe điện; `photos.tsx` ảnh; `part-picker.tsx`; `in/page.tsx` in báo giá
- `khach-hang/`, `xe/`, `phu-tung/` (+ `[id]` sổ kho), `nhap-hang/`, `cong-no/`, `so-quy/`, `von/`, `chia-tien/`, `nhat-ky/`, `cai-dat/`
- `components/` ui.tsx (Icon, Toast, PageTitle...), tim-kiem.tsx (ô tìm trên cùng), xe-chon.tsx
- `lib/` supabase.ts (client), role.tsx (Chủ/Nhân viên), format.ts (tiền, số lượng, đơn vị), gara.ts (thông tin in), photo.ts, tim.ts
- `giai-doan-NN.sql` các bước nâng cấp CSDL (chạy tay trong Supabase SQL Editor); `bao-mat.sql`; `supabase/schema.sql` (gốc)

## 2. Bảng quan trọng
- `customers`, `vehicles` khách và xe (hãng, dòng, năm, màu); `xe_hang`, `xe_dong` gợi ý hãng/dòng
- `repair_orders` phiếu sửa chữa (trạng thái, paid_at, stock_deducted = đã hoàn thành, da_huy, giảm giá/VAT cả phiếu)
- `repair_items` dòng phiếu: kind `part`/`labor`, qty, unit_price, giảm giá dòng
- `repair_item_costs` giá nhập chốt khi hoàn thành (chỉ Chủ); `part_costs` giá nhập hiện tại (chỉ Chủ)
- `repair_costs` chi phí phiếu: vat_tu / thue_ngoai / khac, trạng thái ghi quỹ; `repair_cost_logs`, `repair_edit_logs` nhật ký sửa
- `order_payments` khoản thu của phiếu (thu nhiều lần, hủy bằng dòng đảo)
- `parts` phụ tùng (tồn, giá bán, đơn vị nhập/bán, hệ số); `stock_ledger` sổ kho nhập xuất
- `stock_imports`, `stock_import_items`, `stock_import_logs` lần nhập hàng
- `so_quy` sổ quỹ chỉ thêm dòng (thu, chi, chuyển quỹ, kiểm quỹ, đảo); `quy_cai_dat` số dư đầu kỳ; `so_quy_dem` số phiếu
- `loai_phieu_chi`, `loai_phieu_thu` loại thu/chi (tinh_vao_lai_lo, dong_tien, nhom_chia)
- `von_gop`, `von_chi_phi_mo_xuong`, `von_chi_phi_van_hanh`, `von_loi_nhuan_cu`, `von_cai_dat` mục Vốn; `von_lien_ket_quy` nối Vốn với Sổ quỹ
- `chia_tien_ky`, `chia_tien_nguoi` kỳ chia tiền tháng; `du_phong_so` sổ quỹ dự phòng
- `user_roles` vai trò; `ev_ten_hien_thi` tên hiển thị; `ev_ky_thuat_vien`, `ev_phieu_ky_thuat_vien`, `ev_ma_loi`, `ev_kt_*`, `ev_nhat_ky` xe điện
- `order_photos` ảnh (kho `phieu-anh` riêng tư); `cong_no_ghi_chu`; `phieu_cai_dat`, `phieu_giam_vat_nhat_ky`
- `nhat_ky_hoat_dong` nhật ký hoạt động (chỉ thêm dòng)
- View: `so_quy_xem` (số dư sau từng dòng), `so_quy_phan_loai` (nhóm và dòng tiền của từng dòng quỹ)

## 3. Hàm quan trọng
- `vai_tro()`, `la_chu()` kiểm tra quyền; `ghi_nhat_ky(...)` ghi nhật ký; `ep_nguoi_thuc_hien()` trigger đặt người + giờ máy chủ
- `tinh_tong_tu_so` công thức tổng duy nhất (giảm dòng, giảm phiếu, VAT); `tinh_tong_phieu_noi_bo` tổng 1 phiếu;
  `tinh_tong_phieu` bản cho app; `tong_thanh_toan_phieu` chỉ tổng thanh toán; `tinh_tong_xem_truoc` xem trước khi gõ
- `hoan_thanh_phieu` hoàn thành phiếu, trừ kho, chốt giá nhập; `huy_phieu` hủy phiếu đảo đủ kho, thu, chi phí, quỹ
- `phieu_them_*`, `phieu_xoa_dong`, `sua_phieu_*`, `khach_tra_hang` sửa dòng phiếu; `phieu_dat_giam_vat` giảm giá/VAT
- `ghi_khoan_thu`, `thu_no_khach`, `huy_khoan_thu` thu tiền; `cong_no_phieu`, `cong_no_tong` công nợ
- `chi_phi_phieu_them/sua/ghi_quy`, `chi_phi_huy` chi phí phiếu
- `nhap_hang`, `huy_lan_nhap`, `kiem_ke`, `doi_ton`, `doi_don_vi` kho; `tong_gia_tri_ton` giá trị tồn
- `quy_thiet_lap`, `quy_so_du`, `tao_phieu_thu`, `tao_phieu_chi`, `kiem_quy`, `huy_giao_dich_quy`, `so_quy_phan_loai_lai`, `so_quy_tong_thang`
- `von_quy_ghi`, `von_huy` Vốn; `bao_cao_phieu` doanh thu, giá vốn, chi phí theo ngày/tháng (Tổng quan, Vốn)
- `tach_phieu`, `bao_cao_tach` tách công/phụ tùng; `chia_tien_xem_truoc_khoang`, `chia_tien_chot_khoang` (theo khoảng ngày, chặn trùng ngày), `chia_tien_huy`;
  `du_phong_dung`, `du_phong_huy`; `loai_nhom_chia_dat` đổi nhóm chia của loại thu/chi
- `ds_phieu_tiep_nhan` danh sách phiếu (lọc, phân trang ở máy chủ); `tim_kiem_tong` ô tìm; `khach_ho_so` hồ sơ khách
- Đối chiếu: `phieu_doi_chieu_tong`, `cong_no_doi_chieu`, `so_quy_doi_chieu`, `phieu_huy_doi_chieu`, `doi_chieu_ton`

## 4. File SQL theo thứ tự (chạy tay, mỗi file 1 lần, chạy lại an toàn)
`schema.sql` gốc · `bao-mat.sql` bật RLS (CẨN THẬN: chạy lại sẽ mở quyền bảng không có chính sách `vt_`)
- 2 phụ tùng + báo giá · 3 hoàn thành, trừ kho · 4 phân quyền Chủ/Nhân viên · 6 lịch sử xe · 7 ảnh
- 8 nhập hàng Excel · 9 sửa phiếu đã hoàn thành · 10 chi phí phiếu · 10b nhân viên xem giá bán · 11 Vốn
- 12 thông tin xe điện · 13 sổ kho · 14 tiếp nhận nhanh · 15 quản lý lần nhập · 16 đơn vị quy đổi
- 20 chống sửa/xóa tài chính + nhật ký · 21 Sổ quỹ · 22 thu nhiều lần · 23 công nợ · 24 giá trị tồn
- 25 hãng/dòng xe · 26 chi phí phiếu nối Sổ quỹ · 27 tìm kiếm · 28 hủy phiếu đảo đầy đủ · 29 danh sách phiếu dạng bảng
- 30 thu chi theo tháng · 31 giảm giá + VAT (hàm tính tổng duy nhất) · 32 tách dòng tiền + nối Vốn
- 33 tách công/phụ tùng + chia tiền + dự phòng (đã chạy 26/11/2026) · 34 chia tiền theo khoảng ngày, không trùng ngày
- Không có file 1, 5, 17, 18, 19. **File kế tiếp: giai-doan-35.sql**

## 5. Quy tắc ghi sổ tiền
- Dữ liệu tài chính và kho chỉ thêm dòng; hủy bằng dòng đảo, lý do bắt buộc; không xóa cứng; có người thực hiện + giờ máy chủ.
- Mỗi khoản tiền chỉ ghi MỘT nơi:
  - Chi riêng cho 1 xe → Chi phí phiếu (chọn Tiền mặt / Chuyển khoản / Chưa chi; tự ghi quỹ, cờ `da_tinh_qua_chi_phi`)
  - Chi chung gara (điện nước, lương cố định...) → Phiếu chi trong Sổ quỹ
  - Mua hàng nhập kho → Nhập hàng + phiếu chi "Nhập hàng trả ngay" (không tính lãi lỗ; giá vốn tính khi bán)
  - Trả tiền chia cuối tháng → phiếu chi "Chia tiền tháng" (không tính lãi lỗ, không trừ lại)
- Doanh thu = sau giảm giá, trước VAT, theo ngày hoàn thành (paid_at). Lợi nhuận phiếu = doanh thu − giá vốn − chi phí phiếu.
- Doanh thu, lợi nhuận, tiền quỹ, công nợ là các góc nhìn khác nhau; không cộng chéo. Sổ quỹ tính từ 01/11/2026.
- Khoản thu của phiếu tự sinh dòng quỹ (Tiền mặt → quỹ Tiền mặt, Chuyển khoản → quỹ Tài khoản). Khách nợ không vào quỹ.
- Tách công/phụ tùng: lợi nhuận phụ tùng của chủ (không chia). Phần công − chi phí phiếu − chi phí nuôi xưởng → trích dự phòng % → chia theo %.
- Nhân viên không thấy giá nhập, chi phí, lợi nhuận, số dư quỹ (RLS + kiểm tra trong hàm).

## 6. Chỗ dùng hàm tính tổng phiếu (không tự cộng tiền ở giao diện)
- Giao diện: `tiep-nhan/[id]/page.tsx` và `in/page.tsx` gọi `tinh_tong_phieu`; `giam-vat.tsx` gọi `tinh_tong_xem_truoc`;
  trang in lấy dòng qua `dong_bao_gia`
- Máy chủ dùng `tinh_tong_phieu_noi_bo`: `bao_cao_phieu`, `cong_no_phieu`, `ds_phieu_co_so` (danh sách phiếu), `khach_ho_so`,
  `phieu_dat_giam_vat`, `tach_phieu_noi_bo` (giai đoạn 33)
- Máy chủ dùng `tong_thanh_toan_phieu`: `ghi_khoan_thu` (không thu vượt), `cong_no_tong`, `cong_no_doi_chieu`, `khach_ho_so`,
  `phieu_xoa_dong`, `sua_phieu_them_cong`, `sua_phieu_them_phu_tung`, `sua_phieu_xoa_dong`, `khach_tra_hang`, `phieu_doi_chieu_tong`
- Sửa công thức tổng: chỉ sửa `tinh_tong_tu_so` (giai đoạn 31) rồi chạy `phieu_doi_chieu_tong()` phải ra 0 dòng.
