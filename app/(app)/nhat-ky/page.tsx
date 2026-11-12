"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/lib/role";

type Log = {
  id: string; seq: number; created_at: string; user_id: string | null; email: string | null; ten_hien_thi: string | null; vai_tro: string | null;
  hanh_dong: string; loai_doi_tuong: string; ma_doi_tuong: string | null; ten_doi_tuong: string | null; ma_phieu: number | null;
  truoc: Record<string, unknown> | null; sau: Record<string, unknown> | null; ly_do: string | null;
};
type Tk = { tk_id: string; tk_email: string; tk_ten: string | null };

// Mọi loại thao tác (chỉ để hiển thị / lọc; nhật ký tự ghi ở cơ sở dữ liệu)
const HANH_DONG: Record<string, string> = {
  them: "Thêm", sua: "Sửa", xoa: "Xóa",
  hoan_thanh: "Hoàn thành + thu tiền", huy_phieu: "Hủy phiếu", dao_phieu_da_huy: "Đảo bù phiếu đã hủy", xoa_phieu_nhap: "Xóa phiếu nháp",
  dao_khoan_thu: "Đảo khoản thu", huy_khoan_thu: "Hủy khoản thu", huy_chi_phi: "Hủy chi phí", huy_von: "Hủy khoản vốn",
  nhap_hang: "Nhập kho", xuat_phieu: "Xuất kho cho phiếu", them_khi_sua: "Xuất thêm khi sửa phiếu", xoa_khi_sua: "Hoàn kho khi sửa phiếu",
  khach_tra: "Khách trả hàng", khach_tra_hang: "Khách trả hàng", kiem_ke: "Kiểm kê điều chỉnh", huy_nhap_hang: "Hủy nhập hàng",
  doi_don_vi: "Đổi đơn vị", ton_dau: "Tồn đầu kỳ", sua_lan_nhap: "Sửa lần nhập", huy_lan_nhap: "Hủy lần nhập",
  sua_thong_tin_ev: "Sửa thông tin EV", khoi_tao: "Khởi tạo", thu_no_khach: "Thu nợ khách", ghi_chu_cong_no: "Ghi chú công nợ",
  thiet_lap_quy: "Nhập số dư đầu kỳ quỹ", phieu_thu: "Phiếu thu", phieu_chi: "Phiếu chi", chuyen_quy: "Chuyển quỹ", kiem_quy: "Kiểm quỹ", huy_giao_dich_quy: "Hủy giao dịch sổ quỹ", sua_giam_gia_vat: "Sửa giảm giá / VAT", sua_cai_dat_giam_gia_vat: "Sửa cài đặt giảm giá và VAT",
};
const hd = (k: string) => HANH_DONG[k] ?? k;
const VAI_TRO: Record<string, string> = { chu: "Chủ xưởng", nhan_vien: "Nhân viên" };
const KEY: Record<string, string> = {
  status: "Trạng thái", payment_method: "Hình thức thu", paid_at: "Ngày thu", stock_deducted: "Đã trừ kho", da_huy: "Đã hủy", huy_ly_do: "Lý do hủy",
  huy_boi_ten: "Hủy bởi", huy_luc: "Hủy lúc", so_tien: "Số tiền", amount: "Số tiền", amount_before: "Số tiền trước", amount_after: "Số tiền sau",
  ton: "Tồn", so_luong_thay_doi: "Số lượng thay đổi", don_vi: "Đơn vị", qty: "Số lượng", unit_price: "Đơn giá", name: "Tên", kind: "Loại", content: "Nội dung",
  loai: "Loại", hinh_thuc: "Hình thức", ngay_thu: "Ngày thu", ghi_chu: "Ghi chú", note: "Ghi chú", sale_price: "Giá bán", cost_price: "Giá nhập/vốn",
  tong_phieu: "Tổng phiếu", giam_kieu: "Kiểu giảm giá", giam_gia_tri: "Giá trị giảm giá", giam_ly_do: "Lý do giảm giá", vat_suat: "Thuế suất VAT", vat_che_do: "Cách tính VAT",
  giam_toi_da_nv: "Ngưỡng giảm giá nhân viên (%)", vat_suat_ds: "Các mức thuế suất", so_luong: "Số lượng", don_gia: "Đơn giá", loai_dong: "Loại dòng", code: "Mã", issue: "Lỗi báo", odometer: "Số km",
  soc_nhan: "SOC", soh_nhan: "SOH", pin_ghi_chu: "Ghi chú pin", nguyen_nhan: "Nguyên nhân", ten: "Tên", role: "Vai trò", is_hidden: "Ẩn",
  category: "Hạng mục", contributor: "Người góp", spent_on: "Ngày chi", contributed_on: "Ngày góp", month: "Tháng", start_date: "Ngày bắt đầu", paid_by: "Người chi",
  imported_on: "Ngày nhập", supplier: "Nhà cung cấp", item_count: "Số món", total: "Tổng", stock: "Tồn", min_stock: "Tồn tối thiểu", he_so: "Hệ số",
  don_vi_nhap: "Đơn vị nhập", don_vi_ban: "Đơn vị bán", payment: "Thu", so_khoan: "Số khoản", so_du_dau: "Số dư đầu kỳ", ngay_bat_dau: "Ngày bắt đầu", quy: "Quỹ", loai_chi: "Loại chi", tinh_vao_lai_lo: "Tính vào lãi lỗ", doi_tuong: "Đối tượng", danh_muc: "Danh mục", tu: "Từ quỹ", den: "Sang quỹ", so_du_so: "Số dư theo sổ", so_du_thuc_te: "Thực tế", chenh_lech: "Chênh lệch", so_dong_dao: "Số dòng đảo",
};
const AN = new Set(["id", "order_id", "vehicle_id", "customer_id", "part_id", "item_id", "import_id", "created_by", "huy_boi", "user_id", "seq", "ref_id", "tiep_nhan_boi", "created_by_name", "created_at", "received_at"]);

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (typeof v === "number") return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(v);
  if (typeof v === "string") {
    if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 18) return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(Number(v));
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("vi-VN");
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
    return v;
  }
  return JSON.stringify(v);
}
function lines(j: Record<string, unknown> | null): [string, string][] {
  if (!j) return [];
  return Object.entries(j).filter(([k]) => !AN.has(k)).map(([k, v]) => [KEY[k] ?? k, fmtVal(v)]);
}
const asText = (j: Record<string, unknown> | null) => lines(j).map(([k, v]) => `${k}: ${v}`).join("; ");
const doiTuong = (l: Log) => [l.loai_doi_tuong, l.ma_doi_tuong, l.ten_doi_tuong].filter(Boolean).join(" · ");
const PAGE = 50;
const today = () => new Date().toLocaleDateString("sv-SE");

export default function NhatKyPage() {
  const role = useRole();
  const [rows, setRows] = useState<Log[]>([]);
  const [tks, setTks] = useState<Tk[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const seqRef = useRef(0);

  // Dựng câu truy vấn theo bộ lọc (chỉ ĐỌC; trang này không có thao tác sửa/xóa nào)
  const build = useCallback(() => {
    let qy = supabase.from("nhat_ky_hoat_dong").select("*");
    if (from) qy = qy.gte("created_at", `${from}T00:00:00+07:00`);
    if (to) qy = qy.lte("created_at", `${to}T23:59:59.999+07:00`);
    if (user === "__he_thong") qy = qy.is("user_id", null); else if (user) qy = qy.eq("user_id", user);
    if (action) qy = qy.eq("hanh_dong", action);
    const t = q.trim().replace(/[,()%*]/g, " ").trim();
    if (t) {
      const pt = /^(?:pt)?0*(\d{1,9})$/i.exec(t);
      qy = pt ? qy.or(`ma_phieu.eq.${Number(pt[1])},ma_doi_tuong.ilike.%${t}%,ten_doi_tuong.ilike.%${t}%`) : qy.or(`ma_doi_tuong.ilike.%${t}%,ten_doi_tuong.ilike.%${t}%`);
    }
    return qy.order("seq", { ascending: false });
  }, [from, to, user, action, q]);

  const load = useCallback(async () => {
    const my = ++seqRef.current;
    setLoading(true);
    const r = await build().range(0, PAGE - 1);
    if (my !== seqRef.current) return;
    setLoading(false);
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-20.sql chưa?)");
    setError(""); setRows(r.data as Log[]); setMore((r.data?.length ?? 0) === PAGE);
  }, [build]);

  useEffect(() => { if (role === "chu") { const t = setTimeout(load, 250); return () => clearTimeout(t); } }, [load, role]);
  useEffect(() => {
    if (role !== "chu") return;
    supabase.rpc("ds_tai_khoan").then((r) => { if (r.data) setTks(r.data as Tk[]); });
  }, [role]);

  async function loadMore() {
    setLoading(true);
    const r = await build().range(rows.length, rows.length + PAGE - 1);
    setLoading(false);
    if (r.error) return setError(r.error.message);
    setRows([...rows, ...(r.data as Log[])]); setMore((r.data?.length ?? 0) === PAGE);
  }

  async function exportXlsx() {
    setExporting(true); setError("");
    const all: Log[] = [];
    for (let s = 0; s < 20000; s += 1000) {
      const r = await build().range(s, s + 999);
      if (r.error) { setError(r.error.message); setExporting(false); return; }
      all.push(...(r.data as Log[]));
      if ((r.data?.length ?? 0) < 1000) break;
    }
    const head = ["Thời gian", "Thao tác", "Tài khoản", "Email", "Vai trò", "Loại đối tượng", "Mã", "Tên", "Giá trị trước", "Giá trị sau", "Lý do"];
    const data = all.map((l) => [new Date(l.created_at).toLocaleString("vi-VN"), hd(l.hanh_dong), l.ten_hien_thi ?? "", l.email ?? "", VAI_TRO[l.vai_tro ?? ""] ?? l.vai_tro ?? "",
      l.loai_doi_tuong, l.ma_doi_tuong ?? "", l.ten_doi_tuong ?? "", asText(l.truoc), asText(l.sau), l.ly_do ?? ""]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
    ws["!cols"] = [{ wch: 20 }, { wch: 24 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 26 }, { wch: 44 }, { wch: 44 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, "Nhật ký");
    XLSX.writeFile(wb, `nhat-ky-hoat-dong-${today()}.xlsx`);
    setExporting(false);
  }

  if (role !== "chu") return <EmptyState icon={<Icon name="alert" />} text="Chỉ Chủ xưởng được xem Nhật ký hoạt động." />;
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="history" />} title="Nhật ký hoạt động" />
      <p className="text-sm text-slate-600">Máy chủ tự ghi mọi thay đổi về phiếu, khoản thu, chi phí, nhập xuất kho, vốn. Nhật ký chỉ xem, không ai sửa hoặc xóa được (kể cả Chủ xưởng).</p>

      <div className="card grid gap-2 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-slate-500">Từ ngày</span><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Đến ngày</span><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Tài khoản</span>
          <select className={input} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Tất cả tài khoản</option>
            {tks.map((t) => <option key={t.tk_id} value={t.tk_id}>{t.tk_ten ?? t.tk_email} ({t.tk_email})</option>)}
            <option value="__he_thong">Hệ thống / SQL Editor</option>
          </select></label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Loại thao tác</span>
          <select className={input} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Tất cả thao tác</option>
            {Object.entries(HANH_DONG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <input className={`${input} sm:col-span-2`} placeholder="Tìm theo mã phiếu (vd PT0012 hoặc 12) hoặc tên phụ tùng..." value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="sm:col-span-2 flex gap-2 flex-wrap">
          <button type="button" onClick={() => { setFrom(""); setTo(""); setUser(""); setAction(""); setQ(""); }} className="btn-secondary text-sm px-4">Xóa bộ lọc</button>
          <button type="button" disabled={exporting} onClick={exportXlsx} className="btn-primary text-sm px-4 disabled:opacity-50">{exporting ? "Đang xuất..." : "Xuất Excel"}</button>
        </div>
      </div>

      <Toast text={error} onClose={() => setError("")} />

      <ul className="space-y-2">
        {rows.map((l) => {
          const tr = lines(l.truoc), sa = lines(l.sau);
          return (
            <li key={l.id} className="card space-y-2 text-sm">
              <div className="flex justify-between gap-2 flex-wrap">
                <b className="text-navy-900">{hd(l.hanh_dong)}</b>
                <span className="text-slate-500">{new Date(l.created_at).toLocaleString("vi-VN")}</span>
              </div>
              <div><span className="text-slate-500">Tài khoản: </span><b>{l.ten_hien_thi ?? "Không rõ"}</b>{l.email ? <span className="text-slate-500"> ({l.email})</span> : null}{l.vai_tro ? <span className="text-slate-500"> · {VAI_TRO[l.vai_tro] ?? l.vai_tro}</span> : null}</div>
              <div><span className="text-slate-500">Đối tượng: </span>{doiTuong(l)}</div>
              {(tr.length > 0 || sa.length > 0) && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-red-50 p-2"><div className="text-xs text-red-700 font-medium">Trước</div>{tr.length ? tr.map(([k, v]) => <div key={k} className="break-words"><span className="text-slate-500">{k}: </span>{v}</div>) : <div className="text-slate-400">—</div>}</div>
                  <div className="rounded-lg bg-emerald-50 p-2"><div className="text-xs text-emerald-700 font-medium">Sau</div>{sa.length ? sa.map(([k, v]) => <div key={k} className="break-words"><span className="text-slate-500">{k}: </span>{v}</div>) : <div className="text-slate-400">—</div>}</div>
                </div>
              )}
              {l.ly_do && <div><span className="text-slate-500">Lý do: </span>{l.ly_do}</div>}
            </li>
          );
        })}
        {loading && <li><LoadingBlock rows={3} /></li>}
        {!loading && rows.length === 0 && !error && <li><EmptyState icon={<Icon name="history" />} text="Không có dòng nhật ký nào khớp bộ lọc." /></li>}
      </ul>
      {more && !loading && <button onClick={loadMore} className="btn-secondary w-full">Xem thêm</button>}
    </div>
  );
}
