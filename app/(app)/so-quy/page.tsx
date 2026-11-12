"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";
import { useRole } from "@/lib/role";

const QUY = ["Tiền mặt", "Tài khoản ngân hàng"] as const;
type Quy = (typeof QUY)[number];
type Dong = {
  id: string; seq: number; created_at: string; ngay: string; loai: string; quy: Quy; so_tien: number; so_phieu: string | null; nhom_id: string | null;
  doi_tuong: string | null; doi_tuong_ten: string | null; order_id: string | null; payment_id: string | null; import_id: string | null; danh_muc: string | null;
  tinh_vao_lai_lo: boolean | null; ghi_chu: string | null; dao_cua: string | null; ly_do: string | null; created_by_name: string | null;
  ma_phieu_sua: string | null; da_dao: boolean; so_du_sau: number | null; chi_phi_id: string | null; da_tinh_qua_chi_phi: boolean | null;
};
type CaiDat = { quy: Quy; so_du_dau: number; ngay_bat_dau: string };
type LoaiChi = { ten: string; tinh_vao_lai_lo: boolean; ghi_chu: string | null };
type Nhap = { id: string; imported_on: string; supplier: string | null; total: number; da_huy: boolean };
type Lech = { order_id: string; ma_phieu: string; tong_khoan_thu: number; tong_so_quy: number; chenh_lech: number };

type ChuaGhi = { o_cost: string; o_order: string; o_ma_phieu: string; o_khach: string | null; o_kind: string; o_noi_dung: string; o_so_tien: number; o_ngay_tao: string };
type TongCp = { so_chua_ghi: number; tien_chua_ghi: number; so_chua_chi: number; tien_chua_chi: number; tong_chi_phi_da_ghi: number; tong_so_quy: number };
type LechCp = { o_cost: string; o_order: string; o_ma_phieu: string; o_noi_dung: string; o_chi_phi: number; o_so_quy: number; o_lech: number };
type LechHuy = { o_order: string; o_ma_phieu: string; o_khach: string | null; o_huy_luc: string | null; o_thu: number; o_thu_quy: number; o_chi_phi: number; o_chi_quy: number; o_kho_dong: number; o_kho_lech: number };
type XemTruoc = {
  phieu: { order_id: string; ma_phieu: string; khach: string | null; so_khoan_thu: number; tien_thu: number; so_chi_phi: number; tien_chi_phi: number; tien_chi_quy: number; quy: { quy: string; thay_doi: number }[]; kho: { ten: string; so_luong: number }[] }[];
  quy: { quy: string; so_du_truoc: number; thay_doi: number; so_du_sau: number }[];
};
type QuyThang = { quy: Quy; dau: number; thu: number; chi: number; chuyen: number; kiem: number; cuoi: number };
type NhomTien = { nhom: string; tien_mat: number; tai_khoan: number; tong: number; tinh_vao_lai_lo?: boolean };
type TongThang = { co_du_lieu: boolean; bat_dau: string | null; quy?: QuyThang[]; thu?: NhomTien[]; chi?: NhomTien[] };
type Thang12 = { thang: number; co_du_lieu: boolean; thu: number; chi: number; vat: number; giam: number };
const NHOM_THU: Record<string, string> = { thu_phieu: "Từ phiếu sửa chữa", thu_no: "Thu nợ khách", thu_khac: "Phiếu thu khác" };
const KIND_CP: Record<string, string> = { vat_tu: "Vật tư tiêu hao", thue_ngoai: "Thuê ngoài", khac: "Khác" };

const LOAI: Record<string, string> = { thu: "Thu", chi: "Chi", chuyen_quy: "Chuyển quỹ", kiem_quy: "Kiểm quỹ", dao: "Đảo (hủy)" };
const DOI_TUONG: Record<string, string> = { khach: "Khách", nha_cung_cap: "Nhà cung cấp", tho: "Thợ", khac: "Khác" };
const MAU: Record<string, string> = { thu: "text-emerald-700", chi: "text-red-700", chuyen_quy: "text-sky-700", kiem_quy: "text-amber-700", dao: "text-slate-500" };
const PAGE = 100;
const today = () => new Date().toLocaleDateString("sv-SE");
const fmtDate = (d: string) => d.split("-").reverse().join("/");
const fmtTime = (s: string) => new Date(s).toLocaleString("vi-VN");
const signedIf = (n: number, co: boolean) => (co ? signed(n) : money(n));
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
const inp = "w-full border px-3 py-2 bg-white";
const pad2 = (n: number) => String(n).padStart(2, "0");
const rangeThang = (n: number, t: number) => ({ from: `${n}-${pad2(t)}-01`, to: `${n}-${pad2(t)}-${pad2(new Date(n, t, 0).getDate())}` });
const nowNT = () => { const d = new Date(); return { n: d.getFullYear(), t: d.getMonth() + 1 }; };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const lechQuy = (x?: QuyThang) => (x ? Number(x.dau) + Number(x.thu) - Number(x.chi) + Number(x.chuyen) + Number(x.kiem) - Number(x.cuoi) : 0);

function MoneyInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="block"><span className="field-label">{label}</span>
      <input inputMode="numeric" className={inp} placeholder="0" value={value ? new Intl.NumberFormat("vi-VN").format(Number(value)) : ""} onChange={(e) => onChange(digits(e.target.value))} />
    </label>
  );
}
function QuySelect({ value, onChange, label = "Quỹ", loai }: { value: string; onChange: (v: Quy) => void; label?: string; loai?: Quy[] }) {
  return (
    <label className="block"><span className="field-label">{label}</span>
      <select className={inp} value={value} onChange={(e) => onChange(e.target.value as Quy)}>{(loai ?? [...QUY]).map((q) => <option key={q}>{q}</option>)}</select>
    </label>
  );
}

export default function SoQuyPage() {
  const role = useRole();
  const [cai, setCai] = useState<CaiDat[]>([]);
  const [du, setDu] = useState<Partial<Record<Quy, number>>>({});
  const [capNhat, setCapNhat] = useState("");
  const [rows, setRows] = useState<Dong[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nam, setNam] = useState(() => nowNT().n);
  const [thang, setThang] = useState(() => nowNT().t);
  const [namBang, setNamBang] = useState(() => nowNT().n);
  const [from, setFrom] = useState(() => rangeThang(nowNT().n, nowNT().t).from);
  const [to, setTo] = useState(() => rangeThang(nowNT().n, nowNT().t).to);
  const [tongThang, setTongThang] = useState<TongThang | null>(null);
  const [bang12, setBang12] = useState<Thang12[] | null>(null);
  const [quy, setQuy] = useState("");
  const [loai, setLoai] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"" | "thu" | "chi" | "chuyen" | "kiem" | "dau">("");
  const [loaiChi, setLoaiChi] = useState<LoaiChi[]>([]);
  const [nhaps, setNhaps] = useState<Nhap[]>([]);
  const [lech, setLech] = useState<Lech[] | null>(null);
  const [tongCp, setTongCp] = useState<TongCp | null>(null);
  const [chuaGhi, setChuaGhi] = useState<ChuaGhi[] | null>(null);
  const [lechCp, setLechCp] = useState<LechCp[] | null>(null);
  const [lechHuy, setLechHuy] = useState<LechHuy[] | null>(null);
  const [tongHuy, setTongHuy] = useState(0);
  const [xemTruoc, setXemTruoc] = useState<XemTruoc | null>(null);
  const [cum, setCum] = useState("");
  const [f, setF] = useState({ quy: "Tiền mặt" as string, den: "Tài khoản ngân hàng" as string, tien: "", doiTuong: "khach", ten: "", phieu: "", danhMuc: "", ghiChu: "", loaiChi: "Chi phí vận hành", nhap: "", lyDo: "", ngay: today() });

  const chuaCai = QUY.filter((q) => !cai.some((c) => c.quy === q));

  const loadTop = useCallback(async () => {
    const [c, lc] = await Promise.all([
      supabase.from("quy_cai_dat").select("quy, so_du_dau, ngay_bat_dau"),
      supabase.from("loai_phieu_chi").select("ten, tinh_vao_lai_lo, ghi_chu").order("thu_tu"),
    ]);
    if (c.error) return setError(c.error.message + " (đã chạy giai-doan-21.sql chưa?)");
    setCai(c.data as CaiDat[]);
    if (lc.data) setLoaiChi(lc.data as LoaiChi[]);
    const d: Partial<Record<Quy, number>> = {};
    for (const x of c.data as CaiDat[]) {
      const r = await supabase.rpc("quy_so_du", { p_quy: x.quy });
      if (!r.error) d[x.quy] = Number(r.data);
    }
    setDu(d);
    const t = await supabase.rpc("chi_phi_quy_tong");
    if (!t.error && t.data) setTongCp((Array.isArray(t.data) ? t.data[0] : t.data) as TongCp);
    setCapNhat(new Date().toLocaleString("vi-VN"));
  }, []);

  const loadTong = useCallback(async () => {
    const r = await supabase.rpc("so_quy_tong_thang", { p_nam: nam, p_thang: thang });
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-30.sql chưa?)");
    setTongThang(r.data as TongThang);
  }, [nam, thang]);

  const loadBang12 = useCallback(async () => {
    const r = await supabase.rpc("so_quy_12_thang", { p_nam: namBang });
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-30.sql chưa?)");
    // VAT thu hộ và giảm giá theo tháng hoàn thành phiếu (cùng hàm tính tổng phiếu của giai đoạn 31)
    const bc = await supabase.rpc("bao_cao_phieu", { p_tu: `${namBang}-01-01`, p_den: `${namBang}-12-31`, p_nhom: "thang" });
    const vg = new Map<number, { vat: number; giam: number }>();
    if (!bc.error) for (const x of (bc.data ?? []) as { ky: string; vat: number; giam_gia: number }[]) vg.set(Number(x.ky.slice(5, 7)), { vat: Number(x.vat), giam: Number(x.giam_gia) });
    setBang12((r.data as Thang12[]).map((x) => ({ ...x, thu: Number(x.thu), chi: Number(x.chi), vat: vg.get(x.thang)?.vat ?? 0, giam: vg.get(x.thang)?.giam ?? 0 })));
  }, [namBang]);

  function chonThang(n: number, t: number) {
    setNam(n); setThang(t); setNamBang(n);
    const r = rangeThang(n, t); setFrom(r.from); setTo(r.to);
  }
  function lui(d: number) {
    const x = new Date(nam, thang - 1 + d, 1);
    chonThang(x.getFullYear(), x.getMonth() + 1);
  }

  const build = useCallback(() => {
    let q = supabase.from("so_quy_xem").select("*");
    if (from) q = q.gte("ngay", from);
    if (to) q = q.lte("ngay", to);
    if (quy) q = q.eq("quy", quy);
    if (loai) q = q.eq("loai", loai);
    return q.order("seq", { ascending: false });
  }, [from, to, quy, loai]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const r = await build().range(0, PAGE - 1);
    setLoading(false);
    if (r.error) return setError(r.error.message);
    setRows(r.data as Dong[]); setMore((r.data?.length ?? 0) === PAGE);
  }, [build]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (role === "chu") loadTop(); }, [role, loadTop]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (role === "chu") loadRows(); }, [role, loadRows]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (role === "chu") loadTong(); }, [role, loadTong]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (role === "chu") loadBang12(); }, [role, loadBang12]);

  function loadSoLieu() { loadTop(); loadRows(); loadTong(); loadBang12(); }

  async function loadMore() {
    setLoading(true);
    const r = await build().range(rows.length, rows.length + PAGE - 1);
    setLoading(false);
    if (r.error) return setError(r.error.message);
    setRows([...rows, ...(r.data as Dong[])]); setMore((r.data?.length ?? 0) === PAGE);
  }

  function mo(k: typeof form) {
    setError(""); setForm(form === k ? "" : k);
    if (k === "chi" && nhaps.length === 0) {
      supabase.from("stock_imports").select("id, imported_on, supplier, total, da_huy").order("imported_on", { ascending: false }).limit(60)
        .then((r) => { if (r.data) setNhaps((r.data as Nhap[]).filter((x) => !x.da_huy)); });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const tien = Number(f.tien || 0);
    let r;
    let ok = "";
    if (form === "dau") { r = await supabase.rpc("quy_thiet_lap", { p_quy: f.quy, p_so_du: tien, p_ngay: f.ngay }); ok = `Đã nhập số dư đầu kỳ quỹ ${f.quy}.`; }
    else if (form === "thu") { r = await supabase.rpc("tao_phieu_thu", { p_quy: f.quy, p_so_tien: tien, p_doi_tuong: f.doiTuong, p_ten: f.ten, p_ma_phieu: f.phieu, p_danh_muc: f.danhMuc, p_ghi_chu: f.ghiChu }); ok = `Đã ghi phiếu thu ${r.data ?? ""}.`; }
    else if (form === "chi") { r = await supabase.rpc("tao_phieu_chi", { p_quy: f.quy, p_so_tien: tien, p_loai_chi: f.loaiChi, p_doi_tuong: f.doiTuong, p_ten: f.ten, p_ma_phieu: f.phieu, p_import: f.nhap || null, p_ghi_chu: f.ghiChu }); ok = `Đã ghi phiếu chi ${r.data ?? ""}.`; }
    else if (form === "chuyen") { r = await supabase.rpc("chuyen_quy", { p_tu: f.quy, p_den: f.den, p_so_tien: tien, p_ghi_chu: f.ghiChu }); ok = "Đã chuyển quỹ."; }
    else if (form === "kiem") { r = await supabase.rpc("kiem_quy", { p_quy: "Tiền mặt", p_thuc_te: tien, p_ly_do: f.lyDo }); ok = `Đã ghi điều chỉnh kiểm quỹ (chênh lệch ${signed(Number(r.data ?? 0))}).`; }
    setBusy(false);
    if (!r || r.error) return setError(r?.error?.message ?? "Có lỗi");
    setNotice(ok); setForm("");
    setF({ ...f, tien: "", ten: "", phieu: "", danhMuc: "", ghiChu: "", nhap: "", lyDo: "" });
    loadSoLieu();
  }

  async function huy(d: Dong) {
    const ly = window.prompt(`Hủy giao dịch ${d.so_phieu ?? LOAI[d.loai]} ${signed(d.so_tien)} (${d.quy}). Dòng cũ được giữ nguyên, hệ thống thêm dòng đảo.\n\nLý do hủy (bắt buộc):`);
    if (ly === null) return;
    if (!ly.trim()) return setError("Bắt buộc nhập lý do hủy.");
    setBusy(true);
    const r = await supabase.rpc("huy_giao_dich_quy", { p_id: d.id, p_ly_do: ly.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice("Đã hủy giao dịch (thêm dòng đảo)."); loadSoLieu();
  }

  async function doiChieu() {
    setError(""); setBusy(true);
    const r = await supabase.rpc("so_quy_doi_chieu");
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setLech(r.data as Lech[]);
  }

  async function xemChuaGhi() {
    if (chuaGhi) return setChuaGhi(null);
    setError(""); setBusy(true);
    const r = await supabase.rpc("chi_phi_chua_ghi_quy");
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setChuaGhi((r.data as ChuaGhi[]).map((x) => ({ ...x, o_so_tien: Number(x.o_so_tien) })));
  }

  async function doiChieuCp() {
    setError(""); setBusy(true);
    const r = await supabase.rpc("chi_phi_quy_doi_chieu");
    setBusy(false);
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-26.sql chưa?)");
    setLechCp((r.data as LechCp[]).map((x) => ({ ...x, o_chi_phi: Number(x.o_chi_phi), o_so_quy: Number(x.o_so_quy), o_lech: Number(x.o_lech) })));
    loadTop();
  }

  async function doiChieuHuy() {
    setError(""); setBusy(true); setXemTruoc(null); setCum("");
    const r = await supabase.rpc("phieu_huy_doi_chieu");
    const c = await supabase.from("repair_orders").select("id", { count: "exact", head: true }).eq("da_huy", true);
    setBusy(false);
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-28.sql chưa?)");
    setTongHuy(c.count ?? 0);
    setLechHuy((r.data as LechHuy[]).map((x) => ({ ...x, o_thu: Number(x.o_thu), o_thu_quy: Number(x.o_thu_quy), o_chi_phi: Number(x.o_chi_phi), o_chi_quy: Number(x.o_chi_quy), o_kho_dong: Number(x.o_kho_dong), o_kho_lech: Number(x.o_kho_lech) })));
  }

  async function xemTruocDao() {
    setError(""); setBusy(true); setCum("");
    const r = await supabase.rpc("dao_phieu_da_huy_xem_truoc");
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setXemTruoc(r.data as XemTruoc);
  }

  async function thucHienDao() {
    if (cum.trim() !== "DAO PHIEU DA HUY") return setError("Hãy gõ đúng cụm DAO PHIEU DA HUY.");
    setError(""); setBusy(true);
    const r = await supabase.rpc("dao_phieu_da_huy", { p_xac_nhan: cum.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    const d = r.data as { da_dao: number; loi: { ma_phieu: string; loi: string }[] };
    if (d.loi.length) setError(`Đã sửa ${d.da_dao} phiếu. Còn ${d.loi.length} phiếu chưa sửa được: ` + d.loi.map((x) => `${x.ma_phieu} (${x.loi})`).join("; "));
    else setNotice(`Đã đảo xong ${d.da_dao} phiếu đã hủy và ghi nhật ký.`);
    setXemTruoc(null); setCum(""); loadSoLieu(); doiChieuHuy();
  }

  async function exportXlsx() {
    setBusy(true); setError("");
    const kyHan = rangeThang(nam, thang);
    const all: Dong[] = [];
    for (let st = 0; st < 50000; st += 1000) {
      const r = await supabase.from("so_quy_xem").select("*").gte("ngay", kyHan.from).lte("ngay", kyHan.to).order("seq", { ascending: false }).range(st, st + 999);
      if (r.error) { setError(r.error.message); setBusy(false); return; }
      all.push(...(r.data as Dong[]));
      if ((r.data?.length ?? 0) < 1000) break;
    }
    const head = ["Ngày", "Giờ ghi", "Quỹ", "Loại", "Số phiếu", "Thu (+)", "Chi (−)", "Số dư sau", "Đối tượng", "Tên", "Phiếu sửa chữa", "Danh mục", "Tính vào lãi lỗ", "Ghi chú", "Lý do", "Người thực hiện", "Đã hủy"];
    const data = all.map((d) => [fmtDate(d.ngay), fmtTime(d.created_at), d.quy, LOAI[d.loai] ?? d.loai, d.so_phieu ?? "", d.so_tien > 0 ? Number(d.so_tien) : "", d.so_tien < 0 ? -Number(d.so_tien) : "",
      d.so_du_sau ?? "", d.doi_tuong ? DOI_TUONG[d.doi_tuong] : "", d.doi_tuong_ten ?? "", d.ma_phieu_sua ?? "", d.danh_muc ?? "",
      d.tinh_vao_lai_lo === null ? "" : d.tinh_vao_lai_lo ? "Có" : "Không", d.ghi_chu ?? "", d.ly_do ?? "", d.created_by_name ?? "", d.da_dao ? "Có" : ""]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
    ws["!cols"] = [{ wch: 11 }, { wch: 19 }, { wch: 19 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 40 }, { wch: 30 }, { wch: 16 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    const tq: (string | number)[][] = [[`Tổng quát thu chi tháng ${pad2(thang)}/${nam}`], []];
    const T = tongThang;
    if (!T || !T.co_du_lieu) tq.push(["Chưa có dữ liệu sổ quỹ cho tháng này"]);
    else {
      const qs = T.quy ?? [];
      const g = (k: "dau" | "thu" | "chi" | "chuyen" | "kiem" | "cuoi") => sum(qs.map((x) => Number(x[k])));
      const q = (n: Quy, k: "dau" | "thu" | "chi" | "chuyen" | "kiem" | "cuoi") => Number(qs.find((x) => x.quy === n)?.[k] ?? 0);
      tq.push(["Chỉ tiêu", "Tiền mặt", "Tài khoản ngân hàng", "Tổng"]);
      tq.push(["Tổng đã thu", q("Tiền mặt", "thu"), q("Tài khoản ngân hàng", "thu"), g("thu")]);
      tq.push(["Tổng đã chi", q("Tiền mặt", "chi"), q("Tài khoản ngân hàng", "chi"), g("chi")]);
      tq.push(["Chênh lệch (thu trừ chi)", q("Tiền mặt", "thu") - q("Tiền mặt", "chi"), q("Tài khoản ngân hàng", "thu") - q("Tài khoản ngân hàng", "chi"), g("thu") - g("chi")]);
      tq.push(["Số dư đầu tháng", q("Tiền mặt", "dau"), q("Tài khoản ngân hàng", "dau"), g("dau")]);
      tq.push(["Chuyển quỹ (±)", q("Tiền mặt", "chuyen"), q("Tài khoản ngân hàng", "chuyen"), g("chuyen")]);
      tq.push(["Điều chỉnh kiểm quỹ (±)", q("Tiền mặt", "kiem"), q("Tài khoản ngân hàng", "kiem"), g("kiem")]);
      tq.push(["Số dư cuối tháng", q("Tiền mặt", "cuoi"), q("Tài khoản ngân hàng", "cuoi"), g("cuoi")]);
      tq.push(["Kiểm tra lệch (0 = khớp)", lechQuy(qs.find((x) => x.quy === "Tiền mặt")), lechQuy(qs.find((x) => x.quy === "Tài khoản ngân hàng")), sum(qs.map(lechQuy))]);
      tq.push([], ["Thu theo loại", "Tiền mặt", "Tài khoản ngân hàng", "Tổng"]);
      for (const x of T.thu ?? []) tq.push([NHOM_THU[x.nhom] ?? x.nhom, Number(x.tien_mat), Number(x.tai_khoan), Number(x.tong)]);
      tq.push([], ["Chi theo loại", "Tiền mặt", "Tài khoản ngân hàng", "Tổng", "Lãi lỗ"]);
      for (const x of T.chi ?? []) tq.push([x.nhom, Number(x.tien_mat), Number(x.tai_khoan), Number(x.tong), x.tinh_vao_lai_lo ? "Tính vào lãi lỗ" : "Không tính vào lãi lỗ"]);
    }
    const ws1 = XLSX.utils.aoa_to_sheet(tq);
    ws1["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Tổng quát");
    XLSX.utils.book_append_sheet(wb, ws, "Giao dịch");
    XLSX.writeFile(wb, `so-quy-${nam}-${pad2(thang)}.xlsx`);
    setBusy(false);
  }

  const nam2 = useMemo(() => {
    const y0 = tongThang?.bat_dau ? Number(tongThang.bat_dau.slice(0, 4)) : nowNT().n - 3;
    const ds: number[] = [];
    for (let y = Math.min(y0, nowNT().n - 1); y <= nowNT().n + 1; y++) ds.push(y);
    if (!ds.includes(nam)) ds.push(nam);
    if (!ds.includes(namBang)) ds.push(namBang);
    return ds.sort((a, b) => a - b);
  }, [tongThang, nam, namBang]);
  const tong = useMemo(() => (Object.values(du).length ? Object.values(du).reduce((a, b) => a + (b ?? 0), 0) : null), [du]);
  const loaiDangChon = loaiChi.find((l) => l.ten === f.loaiChi);

  if (role !== "chu") return <EmptyState icon={<Icon name="alert" />} text="Chỉ Chủ xưởng được xem Sổ quỹ." />;

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="money" />} title="Sổ quỹ">
        <button className="btn-secondary min-h-11" disabled={busy} onClick={exportXlsx}>Xuất Excel</button>
      </PageTitle>
      <Toast text={error} onClose={() => setError("")} />
      <Toast text={notice} kind="ok" onClose={() => setNotice("")} />

      <p className="text-sm text-slate-600">Sổ quỹ chỉ ghi nhận dòng tiền vào/ra, <b>không đổi</b> cách tính doanh thu, lợi nhuận, thu hồi vốn. Khách còn nợ chưa trả thì chưa vào quỹ. Dòng đã ghi không sửa, không xóa; muốn hủy thì thêm dòng đảo có lý do.</p>

      <div className="card space-y-3">
        <div className="flex items-end gap-2">
          <button className="btn-secondary min-h-11 min-w-11" aria-label="Tháng trước" onClick={() => lui(-1)}>‹</button>
          <label className="block flex-1 min-w-0"><span className="field-label">Tháng</span>
            <select className={inp} value={thang} onChange={(e) => chonThang(nam, Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}</select></label>
          <label className="block flex-1 min-w-0"><span className="field-label">Năm</span>
            <select className={inp} value={nam} onChange={(e) => chonThang(Number(e.target.value), thang)}>{nam2.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          <button className="btn-secondary min-h-11 min-w-11" aria-label="Tháng sau" onClick={() => lui(1)}>›</button>
        </div>
        {!tongThang ? <LoadingBlock rows={2} /> : !tongThang.co_du_lieu ? (
          <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">Tháng {thang}/{nam}: chưa có dữ liệu sổ quỹ{tongThang.bat_dau ? ` (sổ quỹ bắt đầu từ ${fmtDate(tongThang.bat_dau)})` : ""}.</div>
        ) : (() => {
          const qs = tongThang.quy ?? [];
          const qv = (n: Quy) => qs.find((x) => x.quy === n);
          const tThu = sum(qs.map((x) => Number(x.thu))), tChi = sum(qs.map((x) => Number(x.chi)));
          const tLech = sum(qs.map(lechQuy));
          const the = (ten: string, tong: number, tm: number, tk: number, mau: string, coDau: boolean) => (
            <div className="card">
              <div className="text-sm text-slate-500">{ten}</div>
              <div className={`text-xl font-bold ${mau}`}>{signedIf(tong, coDau)}</div>
              <div className="text-xs text-slate-500">Tiền mặt: {signedIf(tm, coDau)}</div>
              <div className="text-xs text-slate-500">Tài khoản: {signedIf(tk, coDau)}</div>
            </div>
          );
          const cl = (n: Quy) => Number(qv(n)?.thu ?? 0) - Number(qv(n)?.chi ?? 0);
          const tong3 = { quy: "Tổng hai quỹ", dau: sum(qs.map((y) => Number(y.dau))), thu: tThu, chi: tChi, chuyen: sum(qs.map((y) => Number(y.chuyen))), kiem: sum(qs.map((y) => Number(y.kiem))), cuoi: sum(qs.map((y) => Number(y.cuoi))) };
          return (
            <>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                {the("Tổng đã thu", tThu, Number(qv("Tiền mặt")?.thu ?? 0), Number(qv("Tài khoản ngân hàng")?.thu ?? 0), "text-emerald-700", false)}
                {the("Tổng đã chi", tChi, Number(qv("Tiền mặt")?.chi ?? 0), Number(qv("Tài khoản ngân hàng")?.chi ?? 0), "text-red-700", false)}
                {the("Chênh lệch (thu trừ chi)", tThu - tChi, cl("Tiền mặt"), cl("Tài khoản ngân hàng"), tThu - tChi < 0 ? "text-red-700" : "text-navy-900", true)}
              </div>
              <p className="text-xs text-slate-500">Chuyển quỹ không tính vào thu hay chi. Kiểm quỹ điều chỉnh hiện riêng. Giao dịch hủy (dòng đảo) tính vào tháng ghi dòng đảo và làm số ròng.</p>

              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                {[...qs.map((x) => ({ k: x, l: lechQuy(x), tong: false })), { k: tong3, l: tLech, tong: true }].map(({ k, l, tong: la }) => (
                  <div key={k.quy} className={`rounded-lg border p-3 text-sm space-y-1 ${la ? "border-2 border-navy-900" : ""}`}>
                    <div className="font-semibold">{k.quy}</div>
                    <div className="flex justify-between gap-2"><span>Số dư đầu tháng</span><b>{money(Number(k.dau))}</b></div>
                    <div className="flex justify-between gap-2"><span>+ Thu</span><span className="text-emerald-700">{money(Number(k.thu))}</span></div>
                    <div className="flex justify-between gap-2"><span>− Chi</span><span className="text-red-700">{money(Number(k.chi))}</span></div>
                    <div className="flex justify-between gap-2"><span>± Chuyển quỹ</span><span>{signed(Number(k.chuyen))}</span></div>
                    <div className="flex justify-between gap-2"><span>± Điều chỉnh kiểm quỹ</span><span>{signed(Number(k.kiem))}</span></div>
                    <div className="flex justify-between gap-2 border-t pt-1"><span>Số dư cuối tháng</span><b>{money(Number(k.cuoi))}</b></div>
                    {Math.abs(l) > 0.5
                      ? <div className="rounded bg-red-50 text-red-700 p-2 font-medium">CẢNH BÁO: số liệu lệch {signed(l)}</div>
                      : <div className="text-xs text-emerald-700">Khớp: đầu + thu − chi ± chuyển ± điều chỉnh = cuối</div>}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="font-semibold">Thu theo loại</div>
                  {(tongThang.thu ?? []).map((x) => (
                    <div key={x.nhom} className="flex justify-between gap-3 text-sm">
                      <div className="min-w-0"><div>{NHOM_THU[x.nhom] ?? x.nhom}</div><div className="text-xs text-slate-500">Tiền mặt {money(Number(x.tien_mat))} · TK {money(Number(x.tai_khoan))}</div></div>
                      <b className="shrink-0">{money(Number(x.tong))}</b>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 border-t pt-1 font-semibold"><span>Cộng</span><span>{money(tThu)}</span></div>
                </div>
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="font-semibold">Chi theo loại</div>
                  {(tongThang.chi ?? []).map((x) => (
                    <div key={x.nhom} className="flex justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div>{x.nhom} <span className={`badge ${x.tinh_vao_lai_lo ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{x.tinh_vao_lai_lo ? "tính vào lãi lỗ" : "không tính vào lãi lỗ"}</span></div>
                        <div className="text-xs text-slate-500">Tiền mặt {money(Number(x.tien_mat))} · TK {money(Number(x.tai_khoan))}</div>
                      </div>
                      <b className="shrink-0">{money(Number(x.tong))}</b>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 border-t pt-1 font-semibold"><span>Cộng</span><span>{money(tChi)}</span></div>
                </div>
              </div>
            </>
          );
        })()}

        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div className="font-semibold">Thu chi 12 tháng năm {namBang}</div>
            <label className="block w-28"><span className="field-label">Năm</span>
              <select className={inp} value={namBang} onChange={(e) => setNamBang(Number(e.target.value))}>{nam2.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          </div>
          {!bang12 ? <LoadingBlock rows={2} /> : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="bg-slate-50 text-left"><th className="p-2">Tháng</th><th className="p-2 text-right">Thu</th><th className="p-2 text-right">Chi</th><th className="p-2 text-right">Chênh lệch</th><th className="p-2 text-right">VAT thu hộ</th><th className="p-2 text-right">Giảm giá</th></tr></thead>
                <tbody>
                  {bang12.map((m) => (
                    <tr key={m.thang} className={`border-t ${namBang === nam && m.thang === thang ? "bg-brand-50 font-semibold" : ""}`}>
                      <td className="p-0"><button className="bare w-full text-left px-2 min-h-11 text-brand-700 underline" onClick={() => chonThang(namBang, m.thang)}>Tháng {m.thang}</button></td>
                      {m.co_du_lieu
                        ? <><td className="p-2 text-right">{money(m.thu)}</td><td className="p-2 text-right">{money(m.chi)}</td><td className={`p-2 text-right ${m.thu - m.chi < 0 ? "text-red-700" : ""}`}>{signed(m.thu - m.chi)}</td><td className="p-2 text-right">{money(m.vat)}</td><td className="p-2 text-right">{money(m.giam)}</td></>
                        : <><td colSpan={3} className="p-2 text-right text-slate-500">chưa có dữ liệu sổ quỹ</td><td className="p-2 text-right">{money(m.vat)}</td><td className="p-2 text-right">{money(m.giam)}</td></>}
                    </tr>
                  ))}
                  <tr className="border-t-2 font-bold bg-slate-50"><td className="p-2">Cả năm</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.thu)))}</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.chi)))}</td><td className="p-2 text-right">{signed(sum(bang12.map((m) => m.thu - m.chi)))}</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.vat)))}</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.giam)))}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {QUY.map((q) => (
          <div key={q} className="card">
            <div className="text-sm text-slate-500">{q}</div>
            <div className="text-xl font-bold text-navy-900">{du[q] === undefined ? (cai.length ? "…" : "Chưa thiết lập") : money(du[q]!)}</div>
            {cai.find((c) => c.quy === q) && <div className="text-xs text-slate-500">Đầu kỳ {money(Number(cai.find((c) => c.quy === q)!.so_du_dau))} từ {fmtDate(cai.find((c) => c.quy === q)!.ngay_bat_dau)}</div>}
          </div>
        ))}
        <div className="card border-2 border-navy-900">
          <div className="text-sm text-slate-500">Tổng hai quỹ</div>
          <div className="text-xl font-bold text-navy-900">{tong === null ? (cai.length ? "…" : "Chưa thiết lập") : money(tong)}</div>
          {capNhat && <div className="text-xs text-slate-500">Cập nhật {capNhat}</div>}
        </div>
      </div>

      {chuaCai.length > 0 && (
        <div className="card border border-amber-300 bg-amber-50 space-y-2">
          <div className="font-semibold">Nhập số dư đầu kỳ (chỉ một lần cho mỗi quỹ, không sửa lại được)</div>
          <p className="text-sm text-slate-600">Chưa thiết lập: {chuaCai.join(", ")}. Chưa thiết lập thì chưa tạo được phiếu thu/chi, chuyển quỹ, kiểm quỹ. Số dư chỉ tính các dòng từ ngày bắt đầu trở đi.</p>
          <button className="btn-primary min-h-11" onClick={() => { setF({ ...f, quy: chuaCai[0] }); mo("dau"); }}>Nhập số dư đầu kỳ</button>
        </div>
      )}

      {tongCp && tongCp.so_chua_ghi > 0 && (
        <div className="card border border-amber-300 bg-amber-50 space-y-2">
          <div className="text-sm">Có <b>{tongCp.so_chua_ghi}</b> khoản chi phí phiếu chưa ghi vào quỹ, tổng <b>{money(Number(tongCp.tien_chua_ghi))}</b>.</div>
          <button className="btn-secondary min-h-11" disabled={busy} onClick={xemChuaGhi}>{chuaGhi ? "Ẩn danh sách" : "Xem danh sách"}</button>
          {chuaGhi && (
            <ul className="space-y-2">
              {chuaGhi.map((x) => (
                <li key={x.o_cost} className="bg-white rounded-lg border p-3 text-sm flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium break-words">{x.o_noi_dung} <span className="text-xs text-slate-500">({KIND_CP[x.o_kind] ?? x.o_kind})</span></div>
                    <div className="text-slate-600 break-words">{x.o_khach ?? "Không rõ khách"} · {fmtTime(x.o_ngay_tao)}</div>
                    <Link href={`/tiep-nhan/${x.o_order}`} className="inline-flex items-center min-h-11 text-brand-700 underline">Mở phiếu {x.o_ma_phieu} để ghi vào quỹ</Link>
                  </div>
                  <div className="font-bold shrink-0">{money(x.o_so_tien)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button className="btn-primary min-h-11" onClick={() => { setF({ ...f, doiTuong: "khach" }); mo("thu"); }}>+ Phiếu thu</button>
        <button className="btn-primary min-h-11" onClick={() => { setF({ ...f, doiTuong: "nha_cung_cap" }); mo("chi"); }}>+ Phiếu chi</button>
        <button className="btn-secondary min-h-11" onClick={() => mo("chuyen")}>Chuyển quỹ</button>
        <button className="btn-secondary min-h-11" onClick={() => mo("kiem")}>Kiểm quỹ</button>
      </div>

      {form && (
        <form onSubmit={submit} className="card space-y-3">
          <h2 className="font-bold">
            {{ dau: "Số dư đầu kỳ", thu: "Phiếu thu khác (THU...)", chi: "Phiếu chi (CHI...)", chuyen: "Chuyển quỹ", kiem: "Kiểm quỹ tiền mặt" }[form]}
          </h2>
          {form === "dau" && <>
            <div className="grid sm:grid-cols-3 gap-3">
              <QuySelect value={f.quy} onChange={(v) => setF({ ...f, quy: v })} loai={chuaCai} />
              <MoneyInput label="Số dư đầu kỳ (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
              <label className="block"><span className="field-label">Ngày bắt đầu</span><input type="date" className={inp} value={f.ngay} onChange={(e) => setF({ ...f, ngay: e.target.value })} /></label>
            </div>
            <p className="text-xs text-slate-500">Số tiền đang có trong quỹ vào đầu ngày bắt đầu. Chỉ các giao dịch từ ngày này trở đi được cộng vào số dư. Không sửa lại được sau khi lưu.</p>
          </>}
          {form === "thu" && <>
            <p className="text-xs text-slate-500">Dùng cho khoản thu KHÔNG phải tiền khách trả phiếu sửa chữa (tiền phiếu sửa chữa tự vào sổ quỹ khi thu trong phiếu, đừng nhập lại ở đây).</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <QuySelect value={f.quy} onChange={(v) => setF({ ...f, quy: v })} />
              <MoneyInput label="Số tiền thu (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
              <label className="block"><span className="field-label">Đối tượng</span><select className={inp} value={f.doiTuong} onChange={(e) => setF({ ...f, doiTuong: e.target.value })}>{Object.entries(DOI_TUONG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="block"><span className="field-label">Tên người nộp</span><input className={inp} value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value })} maxLength={200} /></label>
              <label className="block"><span className="field-label">Danh mục</span><input className={inp} placeholder="Thu khác" value={f.danhMuc} onChange={(e) => setF({ ...f, danhMuc: e.target.value })} maxLength={100} /></label>
              <label className="block"><span className="field-label">Liên kết phiếu sửa chữa (không bắt buộc)</span><input className={inp} placeholder="PT0012" value={f.phieu} onChange={(e) => setF({ ...f, phieu: e.target.value })} /></label>
            </div>
          </>}
          {form === "chi" && <>
            <div className="grid sm:grid-cols-2 gap-3">
              <QuySelect value={f.quy} onChange={(v) => setF({ ...f, quy: v })} label="Chi từ quỹ" />
              <MoneyInput label="Số tiền chi (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
              <label className="block"><span className="field-label">Loại chi</span><select className={inp} value={f.loaiChi} onChange={(e) => setF({ ...f, loaiChi: e.target.value })}>{loaiChi.map((l) => <option key={l.ten}>{l.ten}</option>)}</select></label>
              <label className="block"><span className="field-label">Đối tượng nhận</span><select className={inp} value={f.doiTuong} onChange={(e) => setF({ ...f, doiTuong: e.target.value })}>{Object.entries(DOI_TUONG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="block"><span className="field-label">Tên người nhận</span><input className={inp} value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value })} maxLength={200} /></label>
              <label className="block"><span className="field-label">Liên kết phiếu sửa chữa (không bắt buộc)</span><input className={inp} placeholder="PT0012" value={f.phieu} onChange={(e) => setF({ ...f, phieu: e.target.value })} /></label>
              <label className="block sm:col-span-2"><span className="field-label">Liên kết lần nhập hàng (không bắt buộc)</span>
                <select className={inp} value={f.nhap} onChange={(e) => setF({ ...f, nhap: e.target.value })}>
                  <option value="">— Không liên kết —</option>
                  {nhaps.map((n) => <option key={n.id} value={n.id}>{fmtDate(n.imported_on)} · {n.supplier || "Không rõ NCC"} · {money(Number(n.total))}</option>)}
                </select></label>
            </div>
            {loaiDangChon && (
              <p className={`text-sm rounded-lg p-2 ${loaiDangChon.tinh_vao_lai_lo ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>
                Tính vào lãi lỗ: <b>{loaiDangChon.tinh_vao_lai_lo ? "CÓ" : "KHÔNG"}</b>. {loaiDangChon.ghi_chu}
              </p>
            )}
          </>}
          {form === "chuyen" && <>
            <div className="grid sm:grid-cols-3 gap-3">
              <QuySelect value={f.quy} onChange={(v) => setF({ ...f, quy: v, den: QUY.find((x) => x !== v)! })} label="Từ quỹ" />
              <QuySelect value={f.quy === "Tiền mặt" ? "Tài khoản ngân hàng" : "Tiền mặt"} onChange={() => {}} label="Sang quỹ" loai={[f.quy === "Tiền mặt" ? "Tài khoản ngân hàng" : "Tiền mặt"]} />
              <MoneyInput label="Số tiền (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
            </div>
            <p className="text-xs text-slate-500">Tiền mặt → Tài khoản = nộp tiền vào ngân hàng. Tài khoản → Tiền mặt = rút tiền. Không phải thu hay chi nên không tính vào lãi lỗ.</p>
          </>}
          {form === "kiem" && <>
            <MoneyInput label="Số tiền mặt đếm thực tế (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
            {f.tien !== "" && du["Tiền mặt"] !== undefined && (
              <p className="text-sm rounded-lg p-2 bg-slate-100">Sổ đang ghi {money(du["Tiền mặt"]!)} · Chênh lệch: <b className={Number(f.tien) - du["Tiền mặt"]! === 0 ? "" : "text-red-700"}>{signed(Number(f.tien) - du["Tiền mặt"]!)}</b></p>
            )}
            <label className="block"><span className="field-label">Lý do chênh lệch (bắt buộc)</span><input className={inp} value={f.lyDo} onChange={(e) => setF({ ...f, lyDo: e.target.value })} maxLength={500} /></label>
          </>}
          {(form === "thu" || form === "chi" || form === "chuyen") && (
            <label className="block"><span className="field-label">Ghi chú</span><input className={inp} value={f.ghiChu} onChange={(e) => setF({ ...f, ghiChu: e.target.value })} maxLength={500} /></label>
          )}
          <div className="flex gap-2">
            <button disabled={busy || !f.tien} className="btn-primary min-h-11 disabled:opacity-50">Ghi sổ</button>
            <button type="button" className="btn-secondary min-h-11" onClick={() => setForm("")}>Đóng</button>
          </div>
        </form>
      )}

      <div className="card space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="block"><span className="field-label">Từ ngày</span><input type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="block"><span className="field-label">Đến ngày</span><input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="block"><span className="field-label">Quỹ</span><select className={inp} value={quy} onChange={(e) => setQuy(e.target.value)}><option value="">Tất cả</option>{QUY.map((q) => <option key={q}>{q}</option>)}</select></label>
          <label className="block"><span className="field-label">Loại</span><select className={inp} value={loai} onChange={(e) => setLoai(e.target.value)}><option value="">Tất cả</option>{Object.entries(LOAI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary min-h-11" disabled={busy} onClick={doiChieu}>Đối chiếu khoản thu với phiếu</button>
          <button className="btn-secondary min-h-11" disabled={busy} onClick={doiChieuCp}>Đối chiếu chi phí phiếu với quỹ</button>
          <button className="btn-secondary min-h-11" disabled={busy} onClick={doiChieuHuy}>Đối chiếu phiếu đã hủy</button>
          {(from !== rangeThang(nam, thang).from || to !== rangeThang(nam, thang).to || quy || loai) && <button className="bare text-sm text-brand-700 min-h-11" onClick={() => { const r = rangeThang(nam, thang); setFrom(r.from); setTo(r.to); setQuy(""); setLoai(""); }}>Về tháng {thang}/{nam}</button>}
        </div>
        {lech && (
          <div className={`rounded-lg p-3 text-sm ${lech.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
            {lech.length === 0 ? "Khớp: tổng khoản thu của mọi phiếu bằng tổng dòng thu liên kết trong sổ quỹ." : (
              <>
                <div className="font-semibold mb-1">{lech.length} phiếu lệch:</div>
                <ul className="space-y-1">{lech.map((l) => <li key={l.order_id}>{l.ma_phieu}: khoản thu {money(Number(l.tong_khoan_thu))} · sổ quỹ {money(Number(l.tong_so_quy))} · lệch {signed(Number(l.chenh_lech))}</li>)}</ul>
              </>
            )}
          </div>
        )}
        {lechCp && (
          <div className={`rounded-lg p-3 text-sm ${lechCp.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
            {lechCp.length === 0 ? `Khớp: tổng chi phí phiếu đã ghi quỹ${tongCp ? ` (${money(Number(tongCp.tong_chi_phi_da_ghi))})` : ""} bằng tổng các dòng quỹ liên kết${tongCp ? ` (${money(Number(tongCp.tong_so_quy))})` : ""}.` : (
              <>
                <div className="font-semibold mb-1">{lechCp.length} khoản chi phí lệch:</div>
                <ul className="space-y-1">{lechCp.map((l) => <li key={l.o_cost}><Link href={`/tiep-nhan/${l.o_order}`} className="underline">{l.o_ma_phieu}</Link>: {l.o_noi_dung} · chi phí {money(l.o_chi_phi)} · sổ quỹ {money(l.o_so_quy)} · lệch {signed(l.o_lech)}</li>)}</ul>
              </>
            )}
          </div>
        )}
        {lechHuy && (
          <div className={`rounded-lg p-3 text-sm space-y-3 ${lechHuy.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
            {lechHuy.length === 0 ? `Khớp: cả ${tongHuy} phiếu đã hủy đều có tổng thu = 0, tổng chi = 0, tồn kho ròng = 0.` : (
              <>
                <div className="font-semibold">{lechHuy.length} / {tongHuy} phiếu đã hủy còn lệch:</div>
                <ul className="space-y-2">
                  {lechHuy.map((l) => (
                    <li key={l.o_order} className="bg-white/70 rounded-lg p-2 break-words">
                      <Link href={`/tiep-nhan/${l.o_order}`} className="underline font-medium inline-flex items-center min-h-11">{l.o_ma_phieu}</Link>{l.o_khach ? ` · ${l.o_khach}` : ""}
                      <div>Còn thu {money(l.o_thu)} (sổ quỹ {money(l.o_thu_quy)}) · còn chi phí {money(l.o_chi_phi)} (sổ quỹ {money(l.o_chi_quy)}) · kho lệch {l.o_kho_dong} phụ tùng</div>
                    </li>
                  ))}
                </ul>
                <button className="btn-primary min-h-11" disabled={busy} onClick={xemTruocDao}>Xem trước việc sửa phiếu đã hủy</button>
              </>
            )}
          </div>
        )}
        {xemTruoc && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-3">
            <div className="font-semibold">Xem trước: chưa ghi gì. Chỉ thêm dòng đảo / đánh dấu hủy, không xóa gì.</div>
            <ul className="space-y-2">
              {xemTruoc.phieu.map((p) => (
                <li key={p.order_id} className="bg-white rounded-lg p-2 break-words">
                  <b>{p.ma_phieu}</b>{p.khach ? ` · ${p.khach}` : ""}
                  <div>Hủy {p.so_khoan_thu} khoản thu = {money(Number(p.tien_thu))} · hủy {p.so_chi_phi} chi phí = {money(Number(p.tien_chi_phi))}</div>
                  {p.quy.map((q) => <div key={q.quy}>Quỹ {q.quy}: {signed(Number(q.thay_doi))}</div>)}
                  {p.kho.length > 0 && <div>Hoàn kho: {p.kho.map((k) => `${k.ten} ${Number(k.so_luong) > 0 ? "+" : ""}${Number(k.so_luong)}`).join(", ")}</div>}
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              <div className="font-semibold">Ảnh hưởng số dư quỹ:</div>
              {xemTruoc.quy.map((q) => <div key={q.quy}>{q.quy}: {money(Number(q.so_du_truoc))} → {money(Number(q.so_du_sau))} ({signed(Number(q.thay_doi))})</div>)}
            </div>
            <label className="block"><span className="field-label">Gõ cụm DAO PHIEU DA HUY để xác nhận</span>
              <input className={inp} autoCapitalize="characters" autoComplete="off" value={cum} onChange={(e) => setCum(e.target.value)} placeholder="DAO PHIEU DA HUY" />
            </label>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary min-h-11 disabled:opacity-50" disabled={busy || cum.trim() !== "DAO PHIEU DA HUY"} onClick={thucHienDao}>Đảo phiếu đã hủy</button>
              <button className="btn-secondary min-h-11" onClick={() => { setXemTruoc(null); setCum(""); }}>Đóng</button>
            </div>
          </div>
        )}
      </div>

      {loading && rows.length === 0 ? <LoadingBlock rows={4} /> : rows.length === 0 ? <EmptyState text="Chưa có giao dịch nào." /> : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id} className={`card !p-3 ${d.da_dao || d.loai === "dao" ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">{fmtDate(d.ngay)} · {fmtTime(d.created_at)} · {d.quy}</div>
                  <div className="font-medium">
                    <span className={MAU[d.loai]}>{LOAI[d.loai] ?? d.loai}</span>
                    {d.so_phieu && <span className="ml-2 badge bg-slate-100 text-slate-700">{d.so_phieu}</span>}
                    {d.ma_phieu_sua && (d.order_id
                      ? <Link href={`/tiep-nhan/${d.order_id}`} className="ml-2 text-sm text-brand-700 underline inline-flex items-center min-h-11">{d.ma_phieu_sua}</Link>
                      : <span className="ml-2 text-sm text-brand-700">{d.ma_phieu_sua}</span>)}
                    {d.da_dao && <span className="ml-2 badge bg-red-100 text-red-700">Đã hủy</span>}
                  </div>
                  <div className="text-sm text-slate-600 break-words">
                    {[d.danh_muc, d.doi_tuong && DOI_TUONG[d.doi_tuong], d.doi_tuong_ten].filter(Boolean).join(" · ")}
                    {d.da_tinh_qua_chi_phi
                      ? <span className="ml-1 text-xs">(đã tính vào lãi lỗ qua chi phí phiếu)</span>
                      : d.tinh_vao_lai_lo !== null && <span className="ml-1 text-xs">({d.tinh_vao_lai_lo ? "tính vào lãi lỗ" : "không tính lãi lỗ"})</span>}
                  </div>
                  {d.ghi_chu && <div className="text-sm text-slate-500 break-words">{d.ghi_chu}</div>}
                  {d.ly_do && <div className="text-sm text-slate-500 break-words">Lý do: {d.ly_do}</div>}
                  <div className="text-xs text-slate-400">Người thực hiện: {d.created_by_name ?? "Không rõ"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-bold ${d.so_tien > 0 ? "text-emerald-700" : "text-red-700"}`}>{signed(Number(d.so_tien))}</div>
                  <div className="text-xs text-slate-500">Dư: {d.so_du_sau === null ? "—" : money(Number(d.so_du_sau))}</div>
                  {!d.da_dao && d.loai !== "dao" && !d.payment_id && !d.chi_phi_id && <button disabled={busy} onClick={() => huy(d)} className="bare text-red-600 text-sm min-h-11">Hủy</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {more && <button className="btn-secondary min-h-11 w-full" disabled={loading} onClick={loadMore}>Xem thêm</button>}
    </div>
  );
}
