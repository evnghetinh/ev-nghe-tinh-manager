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
type LoaiChi = { ten: string; tinh_vao_lai_lo: boolean; ghi_chu: string | null; dong_tien?: string; lien_ket?: string | null };
type LoaiThu = { ten: string; tinh_vao_lai_lo: boolean; ghi_chu: string | null; dong_tien: string; lien_ket: string | null };
type VonTrung = { von_id: string; ten: string; so_tien: number; ngay: string; ghi_chu: string | null; cung_ten: boolean };
type GoiY = {
  cap: { kieu: "gop" | "mo_xuong"; von_id: string; ten_von: string; so_quy_id: string; so_phieu: string | null; quy: string; ten_quy: string | null; so_tien: number; ngay: string; loai_quy: string; cung_ten: boolean }[];
  quy_chua_co_von: { kieu: "gop" | "mo_xuong"; so_quy_id: string; so_phieu: string | null; quy: string; ten: string | null; so_tien: number; ngay: string }[];
  von_chua_ghi_quy: { so_von_gop: number; so_mo_xuong: number };
};
type XemPL = { da_ghi: boolean; so_dong_phan_loai: number; so_dong_se_ghi_them: number; thay_doi_so_du: number;
  dong: { id: string; ngay: string; quy: string; loai: string; so_tien: number; so_phieu: string | null; ten: string | null; loai_cu: string; loai_moi: string; dong_tien_cu: string; dong_tien_moi: string; loi: string | null }[] };
const DT = "dau_tu_tai_chinh";
const HANG_MUC = ["Thiết bị", "Sửa mặt bằng", "Đặt cọc", "Biển hiệu", "Khác"];
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
type QuyThang = { quy: Quy; dau: number; thu: number; chi: number; thu_dt?: number; chi_dt?: number; chuyen: number; kiem: number; cuoi: number };
type NhomTien = { nhom: string; tien_mat: number; tai_khoan: number; tong: number; tinh_vao_lai_lo?: boolean; dong_tien?: string };
type TongThang = { co_du_lieu: boolean; bat_dau: string | null; quy?: QuyThang[]; thu?: NhomTien[]; chi?: NhomTien[] };
type Thang12 = { thang: number; co_du_lieu: boolean; thu_hd: number; chi_hd: number; thu_dt: number; chi_dt: number; vat: number; giam: number };
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

function TaoVon({ x, busy, onTao }: { x: GoiY["quy_chua_co_von"][number]; busy: boolean; onTao: (x: GoiY["quy_chua_co_von"][number], hangMuc: string) => void }) {
  const [hm, setHm] = useState("Thiết bị");
  return (
    <li className="rounded-lg border p-3 text-sm space-y-2">
      <div className="break-words"><b>{x.kieu === "gop" ? "Vốn góp" : "Đầu tư mở xưởng"}</b> · {money(Number(x.so_tien))} · {fmtDate(x.ngay)} · {x.so_phieu ?? ""} · {x.quy} · {x.ten || "không có tên"}</div>
      {x.kieu === "mo_xuong" && (
        <label className="block"><span className="field-label">Hạng mục</span>
          <select className={inp} value={hm} onChange={(e) => setHm(e.target.value)}>{HANG_MUC.map((h) => <option key={h}>{h}</option>)}</select></label>
      )}
      <button className="btn-secondary min-h-11" disabled={busy} onClick={() => onTao(x, hm)}>Tạo khoản tương ứng trong mục Vốn</button>
    </li>
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
  const [loaiThu, setLoaiThu] = useState<LoaiThu[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [goiY, setGoiY] = useState<GoiY | null>(null);
  const [tool, setTool] = useState<"" | "phanloai" | "lienket">("");
  const [trung, setTrung] = useState<VonTrung[]>([]);
  const [chonPL, setChonPL] = useState<string[]>([]);
  const [plMoi, setPlMoi] = useState("");
  const [plLyDo, setPlLyDo] = useState("");
  const [plXem, setPlXem] = useState<XemPL | null>(null);
  const [nhaps, setNhaps] = useState<Nhap[]>([]);
  const [lech, setLech] = useState<Lech[] | null>(null);
  const [tongCp, setTongCp] = useState<TongCp | null>(null);
  const [chuaGhi, setChuaGhi] = useState<ChuaGhi[] | null>(null);
  const [lechCp, setLechCp] = useState<LechCp[] | null>(null);
  const [lechHuy, setLechHuy] = useState<LechHuy[] | null>(null);
  const [tongHuy, setTongHuy] = useState(0);
  const [xemTruoc, setXemTruoc] = useState<XemTruoc | null>(null);
  const [cum, setCum] = useState("");
  const [f, setF] = useState({ quy: "Tiền mặt" as string, den: "Tài khoản ngân hàng" as string, tien: "", doiTuong: "khach", ten: "", phieu: "", danhMuc: "", ghiChu: "", loaiChi: "Chi phí vận hành", nhap: "", lyDo: "", ngay: today(), loaiThu: "Thu khác", hangMuc: "Thiết bị", vonChon: "" });

  const chuaCai = QUY.filter((q) => !cai.some((c) => c.quy === q));
  // Loại đang chọn trong form có liên kết với mục Vốn không ("gop" = Vốn góp, "mo_xuong" = Đầu tư mở xưởng)
  const lk: "gop" | "mo_xuong" | null = form === "thu" ? ((loaiThu.find((l) => l.ten === f.loaiThu)?.lien_ket as "gop" | null | undefined) ?? null)
    : form === "chi" ? ((loaiChi.find((l) => l.ten === f.loaiChi)?.lien_ket as "mo_xuong" | null | undefined) ?? null) : null;
  const tienForm = Number(f.tien || 0);
  const trungHienTai = lk && tienForm > 0 ? trung : [];

  const loadTop = useCallback(async () => {
    const [c, lc, lt, lk, gy] = await Promise.all([
      supabase.from("quy_cai_dat").select("quy, so_du_dau, ngay_bat_dau"),
      supabase.from("loai_phieu_chi").select("ten, tinh_vao_lai_lo, ghi_chu, dong_tien, lien_ket").order("thu_tu"),
      supabase.from("loai_phieu_thu").select("ten, tinh_vao_lai_lo, ghi_chu, dong_tien, lien_ket").order("thu_tu"),
      supabase.from("von_lien_ket_quy").select("so_quy_id"),
      supabase.rpc("von_quy_goi_y"),
    ]);
    if (c.error) return setError(c.error.message + " (đã chạy giai-doan-21.sql chưa?)");
    setCai(c.data as CaiDat[]);
    if (lc.data) setLoaiChi(lc.data as LoaiChi[]);
    else if (lc.error) {
      const l2 = await supabase.from("loai_phieu_chi").select("ten, tinh_vao_lai_lo, ghi_chu").order("thu_tu");
      if (l2.data) setLoaiChi(l2.data as LoaiChi[]);
    }
    if (lt.data) setLoaiThu(lt.data as LoaiThu[]);
    if (lk.data) setLinked(new Set((lk.data as { so_quy_id: string }[]).map((x) => x.so_quy_id)));
    if (!gy.error && gy.data) setGoiY(gy.data as GoiY);
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
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-32.sql chưa?)");
    setTongThang(r.data as TongThang);
  }, [nam, thang]);

  const loadBang12 = useCallback(async () => {
    const r = await supabase.rpc("so_quy_12_thang_dt", { p_nam: namBang });
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-32.sql chưa?)");
    // VAT thu hộ và giảm giá theo tháng hoàn thành phiếu (cùng hàm tính tổng phiếu của giai đoạn 31)
    const bc = await supabase.rpc("bao_cao_phieu", { p_tu: `${namBang}-01-01`, p_den: `${namBang}-12-31`, p_nhom: "thang" });
    const vg = new Map<number, { vat: number; giam: number }>();
    if (!bc.error) for (const x of (bc.data ?? []) as { ky: string; vat: number; giam_gia: number }[]) vg.set(Number(x.ky.slice(5, 7)), { vat: Number(x.vat), giam: Number(x.giam_gia) });
    setBang12((r.data as Thang12[]).map((x) => ({ ...x, thu_hd: Number(x.thu_hd), chi_hd: Number(x.chi_hd), thu_dt: Number(x.thu_dt), chi_dt: Number(x.chi_dt), vat: vg.get(x.thang)?.vat ?? 0, giam: vg.get(x.thang)?.giam ?? 0 })));
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

  // Phát hiện nhập trùng: khoản vốn cùng ngày, cùng số tiền, chưa gắn với dòng quỹ nào
  useEffect(() => {
    if (!lk || tienForm <= 0 || !f.ngay || role !== "chu") return;
    let bo = false;
    supabase.rpc("von_tim_trung_von", { p_kieu: lk, p_ten: f.ten, p_so_tien: tienForm, p_ngay: f.ngay }).then((r) => {
      if (!bo) setTrung(r.error ? [] : ((r.data ?? []) as VonTrung[]).map((x) => ({ ...x, so_tien: Number(x.so_tien) })));
    });
    return () => { bo = true; };
  }, [lk, tienForm, f.ngay, f.ten, role]);

  function loadSoLieu() { loadTop(); loadRows(); loadTong(); loadBang12(); }

  const dongTienCua = (d: Dong) => [...loaiThu, ...loaiChi].find((l) => l.ten === d.danh_muc)?.dong_tien === DT;

  // ----- Phân loại lại -----
  const duocPL = (d: Dong) => (d.loai === "thu" || d.loai === "chi") && !d.da_dao && !d.payment_id && !d.chi_phi_id && !linked.has(d.id);
  const dongPL = rows.filter(duocPL);
  const loaiChonPL = rows.find((d) => chonPL.includes(d.id))?.loai;
  const dsLoaiMoi = loaiChonPL === "thu" ? ["Thu khác", ...loaiThu.map((l) => l.ten)] : loaiChonPL === "chi" ? loaiChi.map((l) => l.ten) : [];
  function chonDong(d: Dong) {
    setPlXem(null);
    if (chonPL.includes(d.id)) {
      const con = chonPL.filter((x) => x !== d.id);
      setChonPL(con);
      if (con.length === 0) setPlMoi("");
    } else setChonPL([...chonPL, d.id]);
  }
  async function phanLoaiLai(thucHien: boolean) {
    if (chonPL.length === 0) return setError("Hãy chọn ít nhất một dòng.");
    if (!plMoi) return setError("Hãy chọn loại mới.");
    if (thucHien && !plLyDo.trim()) return setError("Bắt buộc nhập lý do phân loại lại.");
    setError(""); setBusy(true);
    const r = await supabase.rpc("so_quy_phan_loai_lai", { p_ids: chonPL, p_loai_moi: plMoi, p_ly_do: plLyDo.trim(), p_thuc_hien: thucHien });
    setBusy(false);
    if (r.error) return setError(r.error.message + " (đã chạy giai-doan-32.sql chưa?)");
    const x = r.data as XemPL;
    if (!thucHien) return setPlXem({ ...x, dong: x.dong.map((y) => ({ ...y, so_tien: Number(y.so_tien) })) });
    setNotice(`Đã phân loại lại ${x.so_dong_phan_loai} dòng (ghi dòng đảo và dòng mới, số dư các quỹ không đổi).`);
    setPlXem(null); setChonPL([]); setPlMoi(""); setPlLyDo(""); loadSoLieu();
  }

  // ----- Liên kết với mục Vốn -----
  async function ganCap(c: GoiY["cap"][number]) {
    const dung = c.loai_quy === (c.kieu === "gop" ? "Vốn góp" : "Đầu tư mở xưởng");
    if (!window.confirm(`Xác nhận khoản trong mục Vốn và dòng ${c.so_phieu ?? "sổ quỹ"} (${money(c.so_tien)}, ${fmtDate(c.ngay)}) là MỘT khoản? Không ghi thêm tiền, chỉ gắn hai bên.${dung ? "" : "\nDòng sổ quỹ sẽ được phân loại lại đúng loại (ghi dòng đảo và dòng mới)."}`)) return;
    setError(""); setBusy(true);
    const r = await supabase.rpc("von_quy_ghi", { p_kieu: c.kieu, p_von_id: c.von_id, p_so_quy_id: c.so_quy_id, p_quy: null, p_so_tien: null, p_ngay: null, p_ten: null, p_hang_muc: null, p_ghi_chu: null });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice("Đã gắn hai khoản là một."); loadSoLieu();
  }
  async function taoVonTuDong(x: GoiY["quy_chua_co_von"][number], hangMuc: string) {
    let ten = x.ten ?? "";
    if (x.kieu === "gop" && !ten.trim()) {
      const hoi = window.prompt("Dòng này chưa có tên người góp. Nhập tên người góp:");
      if (!hoi || !hoi.trim()) return;
      ten = hoi.trim();
    }
    setError(""); setBusy(true);
    const r = await supabase.rpc("von_quy_ghi", { p_kieu: x.kieu, p_von_id: null, p_so_quy_id: x.so_quy_id, p_quy: null, p_so_tien: null, p_ngay: null, p_ten: ten, p_hang_muc: hangMuc, p_ghi_chu: null });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice("Đã thêm khoản tương ứng vào mục Vốn."); loadSoLieu();
  }

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
    else if (form === "thu" && lk) {
      if (!f.ten.trim()) { setBusy(false); return setError("Vốn góp phải có tên người góp."); }
      if (trungHienTai.length > 0 && !f.vonChon) { setBusy(false); return setError("Hãy chọn: dùng khoản đã có trong mục Vốn hay là khoản mới."); }
      r = await supabase.rpc("von_quy_ghi", { p_kieu: lk, p_von_id: f.vonChon && f.vonChon !== "moi" ? f.vonChon : null, p_so_quy_id: null, p_quy: f.quy, p_so_tien: tien, p_ngay: f.ngay, p_ten: f.ten, p_hang_muc: null, p_ghi_chu: f.ghiChu });
      ok = "Đã ghi phiếu thu Vốn góp và gắn với mục Vốn.";
    }
    else if (form === "chi" && lk) {
      if (trungHienTai.length > 0 && !f.vonChon) { setBusy(false); return setError("Hãy chọn: dùng khoản đã có trong Chi phí mở xưởng hay là khoản mới."); }
      r = await supabase.rpc("von_quy_ghi", { p_kieu: lk, p_von_id: f.vonChon && f.vonChon !== "moi" ? f.vonChon : null, p_so_quy_id: null, p_quy: f.quy, p_so_tien: tien, p_ngay: f.ngay, p_ten: f.ten, p_hang_muc: f.hangMuc, p_ghi_chu: f.ghiChu });
      ok = "Đã ghi phiếu chi Đầu tư mở xưởng và gắn với Chi phí mở xưởng.";
    }
    else if (form === "thu") { r = await supabase.rpc("tao_phieu_thu", { p_quy: f.quy, p_so_tien: tien, p_doi_tuong: f.doiTuong, p_ten: f.ten, p_ma_phieu: f.phieu, p_danh_muc: f.loaiThu === "Thu khác" ? f.danhMuc : f.loaiThu, p_ghi_chu: f.ghiChu }); ok = `Đã ghi phiếu thu ${r.data ?? ""}.`; }
    else if (form === "chi") { r = await supabase.rpc("tao_phieu_chi", { p_quy: f.quy, p_so_tien: tien, p_loai_chi: f.loaiChi, p_doi_tuong: f.doiTuong, p_ten: f.ten, p_ma_phieu: f.phieu, p_import: f.nhap || null, p_ghi_chu: f.ghiChu }); ok = `Đã ghi phiếu chi ${r.data ?? ""}.`; }
    else if (form === "chuyen") { r = await supabase.rpc("chuyen_quy", { p_tu: f.quy, p_den: f.den, p_so_tien: tien, p_ghi_chu: f.ghiChu }); ok = "Đã chuyển quỹ."; }
    else if (form === "kiem") { r = await supabase.rpc("kiem_quy", { p_quy: "Tiền mặt", p_thuc_te: tien, p_ly_do: f.lyDo }); ok = `Đã ghi điều chỉnh kiểm quỹ (chênh lệch ${signed(Number(r.data ?? 0))}).`; }
    setBusy(false);
    if (!r || r.error) return setError(r?.error?.message ?? "Có lỗi");
    setNotice(ok); setForm("");
    setF({ ...f, tien: "", ten: "", phieu: "", danhMuc: "", ghiChu: "", nhap: "", lyDo: "", vonChon: "" });
    loadSoLieu();
  }

  async function huy(d: Dong) {
    const ly = window.prompt(`Hủy giao dịch ${d.so_phieu ?? LOAI[d.loai]} ${signed(d.so_tien)} (${d.quy}). Dòng cũ được giữ nguyên, hệ thống thêm dòng đảo.${linked.has(d.id) ? "\nDòng này đã gắn với mục Vốn: khoản trong mục Vốn cũng bị hủy." : ""}\n\nLý do hủy (bắt buộc):`);
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
      const dtq = (n: Quy, k: "thu_dt" | "chi_dt") => Number(qs.find((x) => x.quy === n)?.[k] ?? 0);
      const hdq = (n: Quy, k: "thu" | "chi") => q(n, k) - dtq(n, k === "thu" ? "thu_dt" : "chi_dt");
      const M = "Tiền mặt", K = "Tài khoản ngân hàng";
      tq.push(["DÒNG TIỀN HOẠT ĐỘNG"]);
      tq.push(["Tổng đã thu", hdq(M, "thu"), hdq(K, "thu"), hdq(M, "thu") + hdq(K, "thu")]);
      tq.push(["Tổng đã chi", hdq(M, "chi"), hdq(K, "chi"), hdq(M, "chi") + hdq(K, "chi")]);
      tq.push(["Chênh lệch (thu trừ chi)", hdq(M, "thu") - hdq(M, "chi"), hdq(K, "thu") - hdq(K, "chi"), hdq(M, "thu") + hdq(K, "thu") - hdq(M, "chi") - hdq(K, "chi")]);
      tq.push(["ĐẦU TƯ VÀ TÀI CHÍNH (không tính vào lãi lỗ)"]);
      tq.push(["Thu vào (vốn góp, thu tài chính)", dtq(M, "thu_dt"), dtq(K, "thu_dt"), dtq(M, "thu_dt") + dtq(K, "thu_dt")]);
      tq.push(["Chi ra (đầu tư mở xưởng, rút vốn, chia lợi nhuận)", dtq(M, "chi_dt"), dtq(K, "chi_dt"), dtq(M, "chi_dt") + dtq(K, "chi_dt")]);
      tq.push(["Chênh lệch (vào trừ ra)", dtq(M, "thu_dt") - dtq(M, "chi_dt"), dtq(K, "thu_dt") - dtq(K, "chi_dt"), dtq(M, "thu_dt") + dtq(K, "thu_dt") - dtq(M, "chi_dt") - dtq(K, "chi_dt")]);
      tq.push(["CỘNG HAI KHỐI"]);
      tq.push(["Tổng thu", q(M, "thu"), q(K, "thu"), g("thu")]);
      tq.push(["Tổng chi", q(M, "chi"), q(K, "chi"), g("chi")]);
      tq.push(["Chênh lệch (thu trừ chi)", q(M, "thu") - q(M, "chi"), q(K, "thu") - q(K, "chi"), g("thu") - g("chi")]);
      tq.push(["Số dư đầu tháng", q("Tiền mặt", "dau"), q("Tài khoản ngân hàng", "dau"), g("dau")]);
      tq.push(["Chuyển quỹ (±)", q("Tiền mặt", "chuyen"), q("Tài khoản ngân hàng", "chuyen"), g("chuyen")]);
      tq.push(["Điều chỉnh kiểm quỹ (±)", q("Tiền mặt", "kiem"), q("Tài khoản ngân hàng", "kiem"), g("kiem")]);
      tq.push(["Số dư cuối tháng", q("Tiền mặt", "cuoi"), q("Tài khoản ngân hàng", "cuoi"), g("cuoi")]);
      tq.push(["Kiểm tra lệch (0 = khớp)", lechQuy(qs.find((x) => x.quy === "Tiền mặt")), lechQuy(qs.find((x) => x.quy === "Tài khoản ngân hàng")), sum(qs.map(lechQuy))]);
      tq.push([], ["Thu theo loại", "Tiền mặt", "Tài khoản ngân hàng", "Tổng", "Dòng tiền"]);
      for (const x of T.thu ?? []) tq.push([NHOM_THU[x.nhom] ?? x.nhom, Number(x.tien_mat), Number(x.tai_khoan), Number(x.tong), x.dong_tien === DT ? "Đầu tư và tài chính" : "Hoạt động"]);
      tq.push([], ["Chi theo loại", "Tiền mặt", "Tài khoản ngân hàng", "Tổng", "Lãi lỗ", "Dòng tiền"]);
      for (const x of T.chi ?? []) tq.push([x.nhom, Number(x.tien_mat), Number(x.tai_khoan), Number(x.tong), x.tinh_vao_lai_lo ? "Tính vào lãi lỗ" : "Không tính vào lãi lỗ", x.dong_tien === DT ? "Đầu tư và tài chính" : "Hoạt động"]);
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
  // Cảnh báo có thể nhập trùng + bắt Chủ xác nhận từng khoản (không tự gộp)
  const hopTrung = (ten: string) => trungHienTai.length === 0 ? null : (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 space-y-2 text-sm">
      <div className="font-semibold text-amber-900">Cảnh báo: có thể bạn đã nhập khoản này ở {ten} (cùng ngày, cùng số tiền)</div>
      <ul className="space-y-1">
        {trungHienTai.map((x) => <li key={x.von_id} className="break-words">{x.ten} · {money(x.so_tien)} · {fmtDate(x.ngay)}{x.ghi_chu ? ` · ${x.ghi_chu}` : ""} {x.cung_ten && <span className="badge bg-emerald-100 text-emerald-800">cùng tên</span>}</li>)}
      </ul>
      <label className="block"><span className="field-label">Bạn chọn (bắt buộc)</span>
        <select className={inp} value={f.vonChon} onChange={(e) => setF({ ...f, vonChon: e.target.value })}>
          <option value="">— Chọn —</option>
          {trungHienTai.map((x) => <option key={x.von_id} value={x.von_id}>Là CÙNG khoản: {x.ten} · {money(x.so_tien)} · {fmtDate(x.ngay)} (chỉ ghi tiền vào quỹ và gắn lại)</option>)}
          <option value="moi">Là khoản KHÁC (thêm mới cả hai nơi)</option>
        </select></label>
    </div>
  );

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
          const tong3 = { quy: "Tổng hai quỹ", dau: sum(qs.map((y) => Number(y.dau))), thu: tThu, chi: tChi, chuyen: sum(qs.map((y) => Number(y.chuyen))), kiem: sum(qs.map((y) => Number(y.kiem))), cuoi: sum(qs.map((y) => Number(y.cuoi))) };
          const thuL = tongThang.thu ?? [], chiL = tongThang.chi ?? [];
          const tThuDt = sum(qs.map((x) => Number(x.thu_dt ?? 0))), tChiDt = sum(qs.map((x) => Number(x.chi_dt ?? 0)));
          const tThuHd = tThu - tThuDt, tChiHd = tChi - tChiDt;
          const hd = (n: Quy, k: "thu" | "chi") => Number(qv(n)?.[k] ?? 0) - Number(qv(n)?.[k === "thu" ? "thu_dt" : "chi_dt"] ?? 0);
          const laDt = (x: NhomTien) => x.dong_tien === DT;
          const theNhom = (ten: string, x: NhomTien | undefined, mau: string) => the(ten, Number(x?.tong ?? 0), Number(x?.tien_mat ?? 0), Number(x?.tai_khoan ?? 0), mau, false);
          const dsLoai = (tieuDe: string, ds: NhomTien[], cong: number, laChi: boolean) => (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="font-semibold">{tieuDe}</div>
              {ds.map((x) => (
                <div key={x.nhom} className="flex justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="break-words">{NHOM_THU[x.nhom] ?? x.nhom}{laChi && <> <span className={`badge ${x.tinh_vao_lai_lo ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{x.tinh_vao_lai_lo ? "tính vào lãi lỗ" : "không tính vào lãi lỗ"}</span></>}</div>
                    <div className="text-xs text-slate-500">Tiền mặt {money(Number(x.tien_mat))} · TK {money(Number(x.tai_khoan))}</div>
                  </div>
                  <b className="shrink-0">{money(Number(x.tong))}</b>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t pt-1 font-semibold"><span>Cộng</span><span>{money(cong)}</span></div>
            </div>
          );
          return (
            <>
              <div className="rounded-lg border-2 border-emerald-200 p-3 space-y-3">
                <div className="font-bold text-navy-900">Dòng tiền hoạt động</div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  {the("Tổng đã thu", tThuHd, hd("Tiền mặt", "thu"), hd("Tài khoản ngân hàng", "thu"), "text-emerald-700", false)}
                  {the("Tổng đã chi", tChiHd, hd("Tiền mặt", "chi"), hd("Tài khoản ngân hàng", "chi"), "text-red-700", false)}
                  {the("Chênh lệch (thu trừ chi)", tThuHd - tChiHd, hd("Tiền mặt", "thu") - hd("Tiền mặt", "chi"), hd("Tài khoản ngân hàng", "thu") - hd("Tài khoản ngân hàng", "chi"), tThuHd - tChiHd < 0 ? "text-red-700" : "text-navy-900", true)}
                </div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                  {dsLoai("Thu theo loại (hoạt động)", thuL.filter((x) => !laDt(x)), tThuHd, false)}
                  {dsLoai("Chi theo loại (hoạt động)", chiL.filter((x) => !laDt(x)), tChiHd, true)}
                </div>
              </div>

              <div className="rounded-lg border-2 border-sky-200 p-3 space-y-3">
                <div className="font-bold text-navy-900">Đầu tư và tài chính</div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  {theNhom("Vốn góp vào", thuL.find((x) => x.nhom === "Vốn góp"), "text-emerald-700")}
                  {theNhom("Chi đầu tư mở xưởng", chiL.find((x) => x.nhom === "Đầu tư mở xưởng"), "text-red-700")}
                  {theNhom("Rút vốn hoặc chia lợi nhuận", chiL.find((x) => x.nhom === "Rút vốn hoặc chia lợi nhuận"), "text-red-700")}
                </div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                  {dsLoai("Thu đầu tư và tài chính", thuL.filter(laDt), tThuDt, false)}
                  {dsLoai("Chi đầu tư và tài chính", chiL.filter(laDt), tChiDt, true)}
                </div>
                <div className="flex justify-between gap-3 border-t pt-2 text-sm font-semibold"><span>Chênh lệch đầu tư và tài chính (vào trừ ra)</span><span className={tThuDt - tChiDt < 0 ? "text-red-700" : ""}>{signed(tThuDt - tChiDt)}</span></div>
              </div>

              <div className="rounded-lg border-2 border-navy-900 p-3 space-y-1 text-sm">
                <div className="font-bold text-navy-900">Cộng hai khối = tổng thu chi của quỹ</div>
                <div className="flex justify-between gap-3"><span>Tổng thu (hoạt động + đầu tư tài chính)</span><b className="text-emerald-700">{money(tThuHd)} + {money(tThuDt)} = {money(tThu)}</b></div>
                <div className="flex justify-between gap-3"><span>Tổng chi (hoạt động + đầu tư tài chính)</span><b className="text-red-700">{money(tChiHd)} + {money(tChiDt)} = {money(tChi)}</b></div>
                <div className="flex justify-between gap-3 border-t pt-1"><span>Chênh lệch cả hai khối</span><b className={tThu - tChi < 0 ? "text-red-700" : ""}>{signed(tThu - tChi)}</b></div>
              </div>
              <p className="text-xs text-slate-500">Chuyển quỹ không tính vào thu hay chi. Kiểm quỹ điều chỉnh hiện riêng. Giao dịch hủy (dòng đảo) tính vào tháng ghi dòng đảo và làm số ròng. Khối đầu tư và tài chính không tính vào lãi lỗ.</p>

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
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="bg-slate-50 text-center text-xs text-slate-600">
                    <th className="p-1" rowSpan={2}>Tháng</th>
                    <th className="p-1 bg-emerald-50" colSpan={3}>Dòng tiền hoạt động</th>
                    <th className="p-1 bg-sky-50" colSpan={3}>Đầu tư và tài chính</th>
                    <th className="p-1" rowSpan={2}>Chênh lệch cả hai khối</th>
                    <th className="p-1" rowSpan={2}>VAT thu hộ</th>
                    <th className="p-1" rowSpan={2}>Giảm giá</th>
                  </tr>
                  <tr className="bg-slate-50 text-right">
                    <th className="p-2 bg-emerald-50">Thu</th><th className="p-2 bg-emerald-50">Chi</th><th className="p-2 bg-emerald-50">Chênh lệch</th>
                    <th className="p-2 bg-sky-50">Thu vào</th><th className="p-2 bg-sky-50">Chi ra</th><th className="p-2 bg-sky-50">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {bang12.map((m) => (
                    <tr key={m.thang} className={`border-t ${namBang === nam && m.thang === thang ? "bg-brand-50 font-semibold" : ""}`}>
                      <td className="p-0"><button className="bare w-full text-left px-2 min-h-11 text-brand-700 underline" onClick={() => chonThang(namBang, m.thang)}>Tháng {m.thang}</button></td>
                      {m.co_du_lieu
                        ? <>
                          <td className="p-2 text-right">{money(m.thu_hd)}</td><td className="p-2 text-right">{money(m.chi_hd)}</td><td className={`p-2 text-right ${m.thu_hd - m.chi_hd < 0 ? "text-red-700" : ""}`}>{signed(m.thu_hd - m.chi_hd)}</td>
                          <td className="p-2 text-right">{money(m.thu_dt)}</td><td className="p-2 text-right">{money(m.chi_dt)}</td><td className={`p-2 text-right ${m.thu_dt - m.chi_dt < 0 ? "text-red-700" : ""}`}>{signed(m.thu_dt - m.chi_dt)}</td>
                          <td className={`p-2 text-right ${m.thu_hd + m.thu_dt - m.chi_hd - m.chi_dt < 0 ? "text-red-700" : ""}`}>{signed(m.thu_hd + m.thu_dt - m.chi_hd - m.chi_dt)}</td>
                        </>
                        : <td colSpan={7} className="p-2 text-right text-slate-500">chưa có dữ liệu sổ quỹ</td>}
                      <td className="p-2 text-right">{money(m.vat)}</td><td className="p-2 text-right">{money(m.giam)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-bold bg-slate-50">
                    <td className="p-2">Cả năm</td>
                    <td className="p-2 text-right">{money(sum(bang12.map((m) => m.thu_hd)))}</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.chi_hd)))}</td><td className="p-2 text-right">{signed(sum(bang12.map((m) => m.thu_hd - m.chi_hd)))}</td>
                    <td className="p-2 text-right">{money(sum(bang12.map((m) => m.thu_dt)))}</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.chi_dt)))}</td><td className="p-2 text-right">{signed(sum(bang12.map((m) => m.thu_dt - m.chi_dt)))}</td>
                    <td className="p-2 text-right">{signed(sum(bang12.map((m) => m.thu_hd + m.thu_dt - m.chi_hd - m.chi_dt)))}</td>
                    <td className="p-2 text-right">{money(sum(bang12.map((m) => m.vat)))}</td><td className="p-2 text-right">{money(sum(bang12.map((m) => m.giam)))}</td>
                  </tr>
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
        <button className="btn-secondary min-h-11 col-span-1 sm:col-span-2" onClick={() => setTool(tool === "phanloai" ? "" : "phanloai")}>Phân loại lại</button>
        <button className="btn-secondary min-h-11 col-span-1 sm:col-span-2" onClick={() => setTool(tool === "lienket" ? "" : "lienket")}>Kiểm tra trùng và liên kết Vốn</button>
      </div>

      {goiY && (goiY.cap.length > 0 || goiY.quy_chua_co_von.length > 0) && tool !== "lienket" && (
        <div className="card border border-amber-300 bg-amber-50 space-y-2">
          <div className="text-sm">Có <b>{goiY.cap.length}</b> cặp khoản có thể bị nhập hai nơi (Sổ quỹ và mục Vốn){goiY.quy_chua_co_von.length > 0 ? <> và <b>{goiY.quy_chua_co_von.length}</b> dòng quỹ loại Vốn góp / Đầu tư mở xưởng chưa có khoản trong mục Vốn</> : null}. Hệ thống không tự gộp, Chủ xác nhận từng cặp.</div>
          <button className="btn-secondary min-h-11" onClick={() => setTool("lienket")}>Xem và xác nhận</button>
        </div>
      )}

      {tool === "lienket" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">Kiểm tra trùng và liên kết với mục Vốn</h2>
            <button className="btn-secondary min-h-11" onClick={() => setTool("")}>Đóng</button>
          </div>
          {!goiY ? <p className="text-sm text-slate-500">Chưa tải được dữ liệu (đã chạy giai-doan-32.sql chưa?).</p> : <>
            <div className="space-y-2">
              <div className="font-semibold text-sm">Cặp có thể là MỘT khoản (cùng ngày, cùng số tiền)</div>
              {goiY.cap.length === 0 ? <p className="text-sm text-emerald-700">Không có cặp nào nghi trùng.</p> : (
                <ul className="space-y-2">
                  {goiY.cap.map((c) => (
                    <li key={c.von_id + c.so_quy_id} className="rounded-lg border p-3 text-sm space-y-1">
                      <div className="font-medium">{c.kieu === "gop" ? "Vốn góp" : "Chi phí mở xưởng"} · {money(Number(c.so_tien))} · {fmtDate(c.ngay)} {c.cung_ten ? <span className="badge bg-emerald-100 text-emerald-800">cùng tên</span> : <span className="badge bg-slate-100 text-slate-700">tên khác hoặc chưa rõ</span>}</div>
                      <div className="break-words">Mục Vốn: {c.ten_von || "—"}</div>
                      <div className="break-words">Sổ quỹ: {c.so_phieu ?? "—"} · {c.quy} · {c.ten_quy || "không có tên"} · loại hiện tại: {c.loai_quy}</div>
                      <button className="btn-primary min-h-11" disabled={busy} onClick={() => ganCap(c)}>Là một khoản: gắn lại</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {goiY.quy_chua_co_von.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-sm">Dòng quỹ đã chọn loại Vốn góp / Đầu tư mở xưởng nhưng chưa có khoản trong mục Vốn</div>
                <ul className="space-y-2">
                  {goiY.quy_chua_co_von.map((x) => <TaoVon key={x.so_quy_id} x={x} busy={busy} onTao={taoVonTuDong} />)}
                </ul>
              </div>
            )}
            <p className="text-xs text-slate-500">Mục Vốn hiện có {goiY.von_chua_ghi_quy.so_von_gop} khoản vốn góp và {goiY.von_chua_ghi_quy.so_mo_xuong} khoản chi phí mở xưởng chưa gắn với dòng sổ quỹ nào (có thể là khoản trả từ trước khi dùng sổ quỹ, không sao). Muốn ghi vào sổ quỹ, vào Vốn rồi bật &quot;Ghi vào Sổ quỹ&quot;.</p>
          </>}
        </div>
      )}

      {tool === "phanloai" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">Phân loại lại dòng thu / chi</h2>
            <button className="btn-secondary min-h-11" onClick={() => { setTool(""); setChonPL([]); setPlXem(null); }}>Đóng</button>
          </div>
          <p className="text-xs text-slate-500">Chọn các dòng (cùng thu hoặc cùng chi) trong danh sách theo bộ lọc Từ ngày / Đến ngày / Quỹ / Loại ở dưới. Dòng cũ giữ nguyên; hệ thống ghi một dòng đảo và một dòng mới đúng loại, cùng ngày, cùng quỹ, cùng số tiền nên <b>số dư các quỹ không đổi</b>. Không phân loại lại được: khoản thu/chi phí của phiếu sửa chữa, dòng đã hủy, dòng đã gắn mục Vốn.</p>
          {dongPL.length === 0 ? <p className="text-sm text-slate-500">Không có dòng nào phân loại lại được trong bộ lọc hiện tại.</p> : (
            <ul className="space-y-1 max-h-96 overflow-y-auto">
              {dongPL.map((d) => {
                const chon = chonPL.includes(d.id);
                const khacLoai = !!loaiChonPL && loaiChonPL !== d.loai;
                return (
                  <li key={d.id}>
                    <label className={`flex items-start gap-3 rounded-lg border p-2 min-h-11 ${chon ? "border-brand-700 bg-brand-50" : ""} ${khacLoai ? "opacity-40" : ""}`}>
                      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={chon} disabled={khacLoai} onChange={() => chonDong(d)} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block text-xs text-slate-500">{fmtDate(d.ngay)} · {d.quy} · {d.so_phieu ?? ""}</span>
                        <span className="block break-words">{[d.danh_muc ?? (d.loai === "thu" ? "Thu khác" : "Chi khác"), d.doi_tuong_ten].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className={`shrink-0 font-bold ${d.so_tien > 0 ? "text-emerald-700" : "text-red-700"}`}>{signed(Number(d.so_tien))}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {chonPL.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm">Đã chọn <b>{chonPL.length}</b> dòng {loaiChonPL === "thu" ? "thu" : "chi"}.</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="field-label">Loại mới</span>
                  <select className={inp} value={plMoi} onChange={(e) => { setPlMoi(e.target.value); setPlXem(null); }}>
                    <option value="">— Chọn loại mới —</option>
                    {dsLoaiMoi.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select></label>
                <label className="block"><span className="field-label">Lý do (bắt buộc)</span><input className={inp} value={plLyDo} onChange={(e) => setPlLyDo(e.target.value)} maxLength={500} /></label>
              </div>
              {[...loaiThu, ...loaiChi].find((l) => l.ten === plMoi)?.lien_ket && <p className="text-sm rounded-lg p-2 bg-amber-50 text-amber-800">Loại này gắn với mục Vốn. Sau khi phân loại, vào &quot;Kiểm tra trùng và liên kết Vốn&quot; để gắn với khoản có sẵn hoặc tạo khoản tương ứng.</p>}
              <button className="btn-secondary min-h-11" disabled={busy || !plMoi} onClick={() => phanLoaiLai(false)}>Xem trước</button>
            </div>
          )}
          {plXem && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-3">
              <div className="font-semibold">Xem trước: chưa ghi gì. Sẽ ghi thêm {plXem.so_dong_se_ghi_them} dòng (đảo + mới). Số dư các quỹ thay đổi: {money(plXem.thay_doi_so_du)}.</div>
              <ul className="space-y-1">
                {plXem.dong.map((x) => (
                  <li key={x.id} className="bg-white rounded-lg p-2 break-words">
                    {fmtDate(x.ngay)} · {x.quy} · {x.so_phieu ?? ""} · <b>{money(Math.abs(Number(x.so_tien)))}</b>
                    <div>{x.loai_cu} ({x.dong_tien_cu === DT ? "đầu tư và tài chính" : "hoạt động"}) → <b>{x.loai_moi}</b> ({x.dong_tien_moi === DT ? "đầu tư và tài chính" : "hoạt động"})</div>
                    {x.loi && <div className="text-red-700 font-medium">Không làm được: {x.loi}</div>}
                  </li>
                ))}
              </ul>
              <button className="btn-primary min-h-11 disabled:opacity-50" disabled={busy || !plLyDo.trim() || plXem.dong.some((x) => x.loi)} onClick={() => phanLoaiLai(true)}>Xác nhận phân loại lại</button>
              {plXem.dong.some((x) => x.loi) && <div className="text-red-700">Hãy bỏ chọn các dòng không làm được rồi xem trước lại.</div>}
            </div>
          )}
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="card space-y-3">
          <h2 className="font-bold">
            {{ dau: "Số dư đầu kỳ", thu: "Phiếu thu (THU...)", chi: "Phiếu chi (CHI...)", chuyen: "Chuyển quỹ", kiem: "Kiểm quỹ tiền mặt" }[form]}
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
              <label className="block"><span className="field-label">Loại thu</span>
                <select className={inp} value={f.loaiThu} onChange={(e) => setF({ ...f, loaiThu: e.target.value, vonChon: "" })}>
                  <option value="Thu khác">Thu khác (hoạt động)</option>
                  {loaiThu.map((l) => <option key={l.ten} value={l.ten}>{l.ten} (đầu tư và tài chính)</option>)}
                </select></label>
              <QuySelect value={f.quy} onChange={(v) => setF({ ...f, quy: v })} />
              <MoneyInput label="Số tiền thu (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
              {lk ? <>
                <label className="block"><span className="field-label">Ngày góp</span><input type="date" className={inp} value={f.ngay} max={today()} onChange={(e) => setF({ ...f, ngay: e.target.value, vonChon: "" })} /></label>
                <label className="block sm:col-span-2"><span className="field-label">Tên người góp vốn (bắt buộc)</span><input className={inp} value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value, vonChon: "" })} maxLength={200} /></label>
              </> : <>
                <label className="block"><span className="field-label">Đối tượng</span><select className={inp} value={f.doiTuong} onChange={(e) => setF({ ...f, doiTuong: e.target.value })}>{Object.entries(DOI_TUONG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="block"><span className="field-label">Tên người nộp</span><input className={inp} value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value })} maxLength={200} /></label>
                {f.loaiThu === "Thu khác" && <label className="block"><span className="field-label">Danh mục</span><input className={inp} placeholder="Thu khác" value={f.danhMuc} onChange={(e) => setF({ ...f, danhMuc: e.target.value })} maxLength={100} /></label>}
                <label className="block"><span className="field-label">Liên kết phiếu sửa chữa (không bắt buộc)</span><input className={inp} placeholder="PT0012" value={f.phieu} onChange={(e) => setF({ ...f, phieu: e.target.value })} /></label>
              </>}
            </div>
            {lk && <p className="text-sm rounded-lg p-2 bg-sky-50 text-sky-800">Phiếu này tự thêm khoản góp của người này vào mục <b>Vốn → Vốn góp</b>, không cần nhập lại bên đó. Không tính vào lãi lỗ.</p>}
            {hopTrung("mục Vốn góp")}
          </>}
          {form === "chi" && <>
            <div className="grid sm:grid-cols-2 gap-3">
              <QuySelect value={f.quy} onChange={(v) => setF({ ...f, quy: v })} label="Chi từ quỹ" />
              <MoneyInput label="Số tiền chi (đ)" value={f.tien} onChange={(v) => setF({ ...f, tien: v })} />
              <label className="block"><span className="field-label">Loại chi</span><select className={inp} value={f.loaiChi} onChange={(e) => setF({ ...f, loaiChi: e.target.value, vonChon: "" })}>{loaiChi.map((l) => <option key={l.ten}>{l.ten}</option>)}</select></label>
              {lk ? <>
                <label className="block"><span className="field-label">Hạng mục</span><select className={inp} value={f.hangMuc} onChange={(e) => setF({ ...f, hangMuc: e.target.value })}>{HANG_MUC.map((h) => <option key={h}>{h}</option>)}</select></label>
                <label className="block"><span className="field-label">Ngày chi</span><input type="date" className={inp} value={f.ngay} max={today()} onChange={(e) => setF({ ...f, ngay: e.target.value, vonChon: "" })} /></label>
                <label className="block"><span className="field-label">Người chi / bên nhận tiền</span><input className={inp} value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value, vonChon: "" })} maxLength={200} /></label>
              </> : <>
                <label className="block"><span className="field-label">Đối tượng nhận</span><select className={inp} value={f.doiTuong} onChange={(e) => setF({ ...f, doiTuong: e.target.value })}>{Object.entries(DOI_TUONG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="block"><span className="field-label">Tên người nhận</span><input className={inp} value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value })} maxLength={200} /></label>
                <label className="block"><span className="field-label">Liên kết phiếu sửa chữa (không bắt buộc)</span><input className={inp} placeholder="PT0012" value={f.phieu} onChange={(e) => setF({ ...f, phieu: e.target.value })} /></label>
                <label className="block sm:col-span-2"><span className="field-label">Liên kết lần nhập hàng (không bắt buộc)</span>
                  <select className={inp} value={f.nhap} onChange={(e) => setF({ ...f, nhap: e.target.value })}>
                    <option value="">— Không liên kết —</option>
                    {nhaps.map((n) => <option key={n.id} value={n.id}>{fmtDate(n.imported_on)} · {n.supplier || "Không rõ NCC"} · {money(Number(n.total))}</option>)}
                  </select></label>
              </>}
            </div>
            {lk && <p className="text-sm rounded-lg p-2 bg-sky-50 text-sky-800">Phiếu này tự thêm khoản vào mục <b>Vốn → Chi phí mở xưởng</b>, không cần nhập lại bên đó.</p>}
            {hopTrung("Chi phí mở xưởng")}
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
            <button disabled={busy || !f.tien || (trungHienTai.length > 0 && !f.vonChon)} className="btn-primary min-h-11 disabled:opacity-50">Ghi sổ</button>
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
                    {dongTienCua(d) && <span className="ml-2 badge bg-sky-100 text-sky-800">Đầu tư và tài chính</span>}
                    {linked.has(d.id) && <span className="ml-2 badge bg-emerald-100 text-emerald-800">Gắn mục Vốn</span>}
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
