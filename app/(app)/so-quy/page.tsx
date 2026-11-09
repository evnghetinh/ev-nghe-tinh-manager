"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
  ma_phieu_sua: string | null; da_dao: boolean; so_du_sau: number | null;
};
type CaiDat = { quy: Quy; so_du_dau: number; ngay_bat_dau: string };
type LoaiChi = { ten: string; tinh_vao_lai_lo: boolean; ghi_chu: string | null };
type Nhap = { id: string; imported_on: string; supplier: string | null; total: number; da_huy: boolean };
type Lech = { order_id: string; ma_phieu: string; tong_khoan_thu: number; tong_so_quy: number; chenh_lech: number };

const LOAI: Record<string, string> = { thu: "Thu", chi: "Chi", chuyen_quy: "Chuyển quỹ", kiem_quy: "Kiểm quỹ", dao: "Đảo (hủy)" };
const DOI_TUONG: Record<string, string> = { khach: "Khách", nha_cung_cap: "Nhà cung cấp", tho: "Thợ", khac: "Khác" };
const MAU: Record<string, string> = { thu: "text-emerald-700", chi: "text-red-700", chuyen_quy: "text-sky-700", kiem_quy: "text-amber-700", dao: "text-slate-500" };
const PAGE = 100;
const today = () => new Date().toLocaleDateString("sv-SE");
const fmtDate = (d: string) => d.split("-").reverse().join("/");
const fmtTime = (s: string) => new Date(s).toLocaleString("vi-VN");
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
const inp = "w-full border px-3 py-2 bg-white";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quy, setQuy] = useState("");
  const [loai, setLoai] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"" | "thu" | "chi" | "chuyen" | "kiem" | "dau">("");
  const [loaiChi, setLoaiChi] = useState<LoaiChi[]>([]);
  const [nhaps, setNhaps] = useState<Nhap[]>([]);
  const [lech, setLech] = useState<Lech[] | null>(null);
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
    setCapNhat(new Date().toLocaleString("vi-VN"));
  }, []);

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
    loadTop(); loadRows();
  }

  async function huy(d: Dong) {
    const ly = window.prompt(`Hủy giao dịch ${d.so_phieu ?? LOAI[d.loai]} ${signed(d.so_tien)} (${d.quy}). Dòng cũ được giữ nguyên, hệ thống thêm dòng đảo.\n\nLý do hủy (bắt buộc):`);
    if (ly === null) return;
    if (!ly.trim()) return setError("Bắt buộc nhập lý do hủy.");
    setBusy(true);
    const r = await supabase.rpc("huy_giao_dich_quy", { p_id: d.id, p_ly_do: ly.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice("Đã hủy giao dịch (thêm dòng đảo)."); loadTop(); loadRows();
  }

  async function doiChieu() {
    setError(""); setBusy(true);
    const r = await supabase.rpc("so_quy_doi_chieu");
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setLech(r.data as Lech[]);
  }

  async function exportXlsx() {
    setBusy(true); setError("");
    const all: Dong[] = [];
    for (let s = 0; s < 50000; s += 1000) {
      const r = await build().range(s, s + 999);
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
    XLSX.utils.book_append_sheet(wb, ws, "Sổ quỹ");
    XLSX.writeFile(wb, `so-quy-${today()}.xlsx`);
    setBusy(false);
  }

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
          {(from || to || quy || loai) && <button className="bare text-sm text-brand-700 min-h-11" onClick={() => { setFrom(""); setTo(""); setQuy(""); setLoai(""); }}>Xóa lọc</button>}
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
                    {d.ma_phieu_sua && <span className="ml-2 text-sm text-brand-700">{d.ma_phieu_sua}</span>}
                    {d.da_dao && <span className="ml-2 badge bg-red-100 text-red-700">Đã hủy</span>}
                  </div>
                  <div className="text-sm text-slate-600 break-words">
                    {[d.danh_muc, d.doi_tuong && DOI_TUONG[d.doi_tuong], d.doi_tuong_ten].filter(Boolean).join(" · ")}
                    {d.tinh_vao_lai_lo !== null && <span className="ml-1 text-xs">({d.tinh_vao_lai_lo ? "tính vào lãi lỗ" : "không tính lãi lỗ"})</span>}
                  </div>
                  {d.ghi_chu && <div className="text-sm text-slate-500 break-words">{d.ghi_chu}</div>}
                  {d.ly_do && <div className="text-sm text-slate-500 break-words">Lý do: {d.ly_do}</div>}
                  <div className="text-xs text-slate-400">Người thực hiện: {d.created_by_name ?? "Không rõ"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-bold ${d.so_tien > 0 ? "text-emerald-700" : "text-red-700"}`}>{signed(Number(d.so_tien))}</div>
                  <div className="text-xs text-slate-500">Dư: {d.so_du_sau === null ? "—" : money(Number(d.so_du_sau))}</div>
                  {!d.da_dao && d.loai !== "dao" && !d.payment_id && <button disabled={busy} onClick={() => huy(d)} className="bare text-red-600 text-sm min-h-11">Hủy</button>}
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
