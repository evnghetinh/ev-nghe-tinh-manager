# Quy tắc cố định cho dự án EV Nghệ Tĩnh Auto

Luôn tuân theo mọi lần làm việc.

## 1. Ngôn ngữ
- Giao diện và thông báo toàn bộ bằng tiếng Việt.
- Tên gara: **EV Nghệ Tĩnh Auto**.
- Trả lời người dùng ngắn gọn, tiếng Việt đơn giản (chủ gara không biết lập trình).

## 2. Điện thoại ngang máy tính
- Mọi giao diện mới hoặc sửa phải dùng tốt trên điện thoại (khoảng 360px) như trên máy tính.
- Không tràn ngang; nút cao tối thiểu 44px; chữ trong ô nhập tối thiểu 16px.
- Bảng dài: chuyển thành thẻ xếp dọc hoặc cuộn ngang trong khung.
- Không dùng hover làm chức năng bắt buộc.
- Chạy được trên Chrome Android và Safari iPhone.
- Sau mỗi thay đổi giao diện: kiểm tra bố cục ở 360px và 1280px; chạy kiểm tra kiểu (typecheck), lint, build.

## 3. Phân quyền bằng RLS (ở cơ sở dữ liệu)
- Nhân viên không được thấy giá nhập, giá vốn, chi phí, lợi nhuận, số dư quỹ — dù ở giao diện hay API.

## 4. Dữ liệu tài chính và kho
- Chỉ thêm dòng, không sửa hoặc xóa cứng.
- Hủy bằng dòng đảo, bắt buộc có lý do.
- Mọi thao tác ghi nhật ký hoạt động: người thực hiện + giờ máy chủ.
- Không đổi cách tính doanh thu, lợi nhuận, tồn kho, sổ quỹ nếu người dùng không yêu cầu.

## 5. SQL
- Viết để chạy lại an toàn; bật RLS.
- Lưu thành file `giai-doan-NN.sql`, NN là số tiếp theo (hiện đã có đến giai-doan-22, file kế tiếp là **23**).
- Mở file bằng Notepad cho người dùng dán vào Supabase.
- Không dùng drop table, drop column, truncate (trừ chốt chặn bảo vệ).

## 6. Phạm vi và git
- Không tự commit hay push trừ khi người dùng yêu cầu.
- Không sửa phần ngoài yêu cầu.

## 7. Báo cáo cuối mỗi lần làm việc
Luôn nêu rõ:
- Có file SQL cần chạy không (tên file).
- Cần kiểm tra gì trên điện thoại.
- Đã chạy kiểm tra kiểu, lint, build chưa.

## 8. Trang in báo giá
- Luôn khớp dữ liệu phiếu.
- Không in giá nhập, chi phí, lợi nhuận, số dư quỹ.
