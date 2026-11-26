"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { money, digits, decimalInput, toNum } from "@/lib/format";
import { useRole } from "@/lib/role";
import { Icon, PageTitle, EmptyState, Toast } from "@/components/ui";

// Chia tiền cuối tháng (giai đoạn 33). Chỉ Chủ xưởng.
//   Phần công còn lại = doanh thu công - chi phí phiếu - chi phí nuôi xưởng + thu nhóm công +/- khoản khác
//   Quỹ dự phòng     = phần công còn lại x % (phần công âm thì không trích, không chia)
//   Phần chia        = phần công còn lại - dự phòng, chia theo % từng người (tổng 100%)
//   Lợi nhuận phụ tùng: 100% của chủ, không chia.
// Mọi con số khi CHỐT do máy chủ tính lại (hàm chia_tien_chot), giao diện chỉ xem trước.

type Nhom = "cong" | "phu_tung" | "khong";
type ChiTiet = { loai: "thu" | "chi"; danh_muc: string; nhom_chia: Nhom; so_tien: number };
type Thieu = { order_id: string; ma_phieu: number; so_dong: number };
type Ky = {
  id: string; nam: number; thang: number; tu: string; den: string; so_phieu: number; doanh_thu: number; dt_cong: number; chi_phi_phieu: number; chi_xuong: number;
  thu_cong: number; khoan_khac: number; khoan_khac_ghi_chu: string | null; phan_cong: number; du_phong_pt: number; du_phong: number;
  phan_chia: number; dt_pt: number; gia_von_pt: number; chi_pt: number; thu_pt: number; ln_pt_chu: number; ghi_chu: string | null;
  created_at: string; created_by_name: string | null; da_huy: boolean; huy_ly_do: string | null; huy_boi_ten: string | null; huy_luc: string | null;
};
type NguoiChot = { thu_tu: number; ten: string; phan_tram: number; so_tien: number };
type XemTruoc = {
  tu: string; den: string; hom_nay: string; so_phieu: number; doanh_thu: number; dt_cong: number; chi_phi_phieu: number; chi_xuong: number; thu_cong: number;
  dt_pt: number; gia_von_pt: number; chi_pt: number; thu_pt: number; chi_tiet: ChiTiet[]; pt_thieu_gia: Thieu[];
  ky_da_chot: Ky | null; nguoi_da_chot: NguoiChot[]; du_phong_so_du: number;
  ky_trung: { id: string; tu: string; den: string }[]; goi_y_tu: string | null;
};
type Loai = { bang: "thu" | "chi"; ten: string; nhom_chia: Nhom | null; ghi_chu: string | null };
type DpDong = { id: string; seq: number; ngay: string; loai: "trich" | "dung" | "dao"; so_tien: number; so_phieu_chi: string | null; ly_do: string | null; dao_cua: string | null; created_by_name: string | null };
type Nguoi = { ten: string; pt: string };

const NHOM: { v: Nhom; label: string }[] = [
  { v: "cong", label: "Phần công (trừ / cộng trước khi chia)" },
  { v: "phu_tung", label: "Phần phụ tùng (trừ / cộng vào lãi của chủ)" },
  { v: "khong", label: "Không tính khi chia" },
];
const N = (x: unknown) => Number(x ?? 0);
const fmtDate = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
// Ngày theo giờ máy (yyyy-mm-dd), không lệch múi giờ
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dauThang = (y: number, m: number) => iso(new Date(y, m, 1));
const cuoiThang = (y: number, m: number) => iso(new Date(y, m + 1, 0));
const ngaySau = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return iso(new Date(y, m - 1, dd + 1)); };
const ngayTruoc = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return iso(new Date(y, m - 1, dd - 1)); };
const inp = "w-full border rounded-lg px-3 py-2 min-h-11 text-base bg-white";
const lbl = "block text-sm font-semibold text-slate-700 mb-1";

function Dong({ label, value, sign = "", bold = false, red = false, sub }: { label: string; value: number; sign?: "" | "+" | "−"; bold?: boolean; red?: boolean; sub?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${bold ? "font-bold text-base border-t pt-2" : "text-sm"} ${red ? "text-red-700" : ""}`}>
      <span>{label}{sub && <span className="block text-xs font-normal text-slate-500">{sub}</span>}</span>
      <span className="shrink-0 tabular-nums">{sign}{sign ? " " : ""}{money(sign ? Math.abs(value) : value)}</span>
    </div>
  );
}

export default function ChiaTien() {
  const role = useRole();
  const now = new Date();
  // Mặc định: tháng trước; đã có kỳ chốt thì từ ngày sau kỳ gần nhất đến hôm nay (đặt trong macDinh)
  const [tu, setTu] = useState(dauThang(now.getFullYear(), now.getMonth() - 1));
  const [den, setDen] = useState(cuoiThang(now.getFullYear(), now.getMonth() - 1));
  const [xt, setXt] = useState<XemTruoc | null>(null);
  const [loais, setLoais] = useState<Loai[]>([]);
  const [dp, setDp] = useState<DpDong[]>([]);
  const [kys, setKys] = useState<Ky[]>([]);
  const [nguoi, setNguoi] = useState<Nguoi[]>([]);
  const [dpPt, setDpPt] = useState("0");
  const [kkDau, setKkDau] = useState<"+" | "-">("+");
  const [kkTien, setKkTien] = useState("");
  const [kkGc, setKkGc] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [xacNhan, setXacNhan] = useState(false);
  const [huyLy, setHuyLy] = useState<string | null>(null);
  const [dung, setDung] = useState<{ tien: string; ngay: string; ly: string; phieu: string } | null>(null);
  const [huyDp, setHuyDp] = useState<{ id: string; ly: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [macDinhXong, setMacDinhXong] = useState(false);

  const loadThang = useCallback(async () => {
    if (!tu || !den) { setXt(null); return; }
    if (tu > den) { setError("Từ ngày phải trước hoặc bằng đến ngày."); setXt(null); return; }
    const r = await supabase.rpc("chia_tien_xem_truoc_khoang", { p_tu: tu, p_den: den });
    if (r.error) { setError(r.error.message + " (đã chạy giai-doan-33.sql chưa?)"); setXt(null); return; }
    const d = r.data as Record<string, unknown>;
    const k = d.ky_da_chot as Record<string, unknown> | null;
    setXt({
      tu: String(d.tu), den: String(d.den), hom_nay: String(d.hom_nay), so_phieu: N(d.so_phieu), doanh_thu: N(d.doanh_thu), dt_cong: N(d.dt_cong),
      chi_phi_phieu: N(d.chi_phi_phieu), chi_xuong: N(d.chi_xuong), thu_cong: N(d.thu_cong), dt_pt: N(d.dt_pt), gia_von_pt: N(d.gia_von_pt),
      chi_pt: N(d.chi_pt), thu_pt: N(d.thu_pt),
      chi_tiet: ((d.chi_tiet ?? []) as ChiTiet[]).map((c) => ({ ...c, so_tien: N(c.so_tien) })),
      pt_thieu_gia: (d.pt_thieu_gia ?? []) as Thieu[],
      ky_da_chot: k ? (Object.fromEntries(Object.entries(k).map(([a, b]) => [a, typeof b === "string" && /^-?\d+(\.\d+)?$/.test(b) ? Number(b) : b])) as unknown as Ky) : null,
      nguoi_da_chot: ((d.nguoi_da_chot ?? []) as NguoiChot[]).map((n) => ({ ...n, phan_tram: N(n.phan_tram), so_tien: N(n.so_tien) })),
      du_phong_so_du: N(d.du_phong_so_du),
      ky_trung: (d.ky_trung ?? []) as { id: string; tu: string; den: string }[],
      goi_y_tu: (d.goi_y_tu as string | null) ?? null,
    });
  }, [tu, den]);

  const loadChung = useCallback(async () => {
    const [lc, lt, d, k] = await Promise.all([
      supabase.from("loai_phieu_chi").select("ten, nhom_chia, ghi_chu").order("thu_tu"),
      supabase.from("loai_phieu_thu").select("ten, nhom_chia, ghi_chu").order("thu_tu"),
      supabase.from("du_phong_so").select("id, seq, ngay, loai, so_tien, so_phieu_chi, ly_do, dao_cua, created_by_name").order("seq", { ascending: false }).limit(100),
      supabase.from("chia_tien_ky").select("*").order("tu", { ascending: false }).order("created_at", { ascending: false }).limit(36),
    ]);
    const e = lc.error ?? lt.error ?? d.error ?? k.error;
    if (e) { setError(e.message + " (đã chạy giai-doan-33.sql chưa?)"); return; }
    setLoais([
      ...((lc.data ?? []) as Omit<Loai, "bang">[]).map((x) => ({ ...x, bang: "chi" as const })),
      ...((lt.data ?? []) as Omit<Loai, "bang">[]).map((x) => ({ ...x, bang: "thu" as const })),
    ]);
    setDp(((d.data ?? []) as DpDong[]).map((x) => ({ ...x, so_tien: N(x.so_tien) })));
    const ds = (k.data ?? []) as Ky[];
    setKys(ds);
    return ds;
  }, []);

  // Lần đầu: lấy danh sách người + % dự phòng của kỳ gần nhất; chưa có kỳ nào thì lấy kỹ thuật viên đang làm + Chủ xưởng
  const macDinh = useCallback(async (ds: Ky[] | undefined) => {
    const cuoi = (ds ?? []).find((x) => !x.da_huy);
    const dens = (ds ?? []).filter((x) => !x.da_huy).map((x) => x.den).sort();
    if (dens.length) {
      const goiY = ngaySau(dens[dens.length - 1]);
      const homNay = iso(new Date());
      if (goiY <= homNay) { setTu(goiY); setDen(homNay); }
    }
    if (cuoi) {
      const n = await supabase.from("chia_tien_nguoi").select("thu_tu, ten, phan_tram").eq("ky_id", cuoi.id).order("thu_tu");
      setNguoi(((n.data ?? []) as NguoiChot[]).map((x) => ({ ten: x.ten, pt: String(N(x.phan_tram)).replace(".", ",") })));
      setDpPt(String(N(cuoi.du_phong_pt)).replace(".", ","));
    } else {
      const t = await supabase.from("ev_ky_thuat_vien").select("ten").eq("dang_lam", true).order("ten");
      setNguoi([...((t.data ?? []) as { ten: string }[]).map((x) => ({ ten: x.ten, pt: "" })), { ten: "Chủ xưởng", pt: "" }]);
    }
    setMacDinhXong(true);
  }, [setTu, setDen]);

  useEffect(() => {
    if (role !== "chu") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChung().then((ds) => { if (!macDinhXong) macDinh(ds); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, loadChung, macDinh]);

  useEffect(() => {
    if (role !== "chu") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadThang();
    setXacNhan(false); setHuyLy(null);
  }, [role, loadThang]);

  // Xem trước (cùng công thức với máy chủ)
  const kk = (kkDau === "-" ? -1 : 1) * Number(digits(kkTien) || 0);
  const pctDp = Math.min(100, Math.max(0, toNum(dpPt || "0") || 0));
  const tinh = useMemo(() => {
    if (!xt) return null;
    const phanCong = xt.dt_cong - xt.chi_phi_phieu - xt.chi_xuong + xt.thu_cong + kk;
    const du = phanCong > 0 ? Math.round((phanCong * pctDp) / 100) : 0;
    const chia = phanCong > 0 ? phanCong - du : 0;
    const lnPt = xt.dt_pt - xt.gia_von_pt - xt.chi_pt + xt.thu_pt;
    const pts = nguoi.map((n) => toNum(n.pt || "0") || 0);
    const tongPt = Math.round(pts.reduce((a, b) => a + b, 0) * 100) / 100;
    let da = 0;
    const tien = pts.map((p, i) => { const t = i === pts.length - 1 ? chia - da : Math.round((chia * p) / 100); da += t; return t; });
    return { phanCong, du, chia, lnPt, tongPt, tien };
  }, [xt, kk, pctDp, nguoi]);

  if (role !== "chu") return <EmptyState text="Bạn không có quyền xem trang này." />;

  const chot = xt?.ky_da_chot ?? null;
  const chuaHetThang = xt ? xt.hom_nay <= xt.den : false;
  const thangTuongLai = xt ? xt.hom_nay < xt.tu : false;
  const trung = !chot && xt ? xt.ky_trung : [];
  const tenKy = `${fmtDate(tu)} – ${fmtDate(den)}`;
  const chonThang = (lui: number) => { const d = new Date(now.getFullYear(), now.getMonth() - lui, 1); setTu(dauThang(d.getFullYear(), d.getMonth())); setDen(cuoiThang(d.getFullYear(), d.getMonth())); };
  const cong = xt?.chi_tiet.filter((c) => c.nhom_chia === "cong") ?? [];
  const pt = xt?.chi_tiet.filter((c) => c.nhom_chia === "phu_tung") ?? [];
  const khong = xt?.chi_tiet.filter((c) => c.nhom_chia === "khong") ?? [];
  const dpSoDu = dp.reduce((a, x) => a + x.so_tien, 0);
  const daDao = new Set(dp.filter((x) => x.dao_cua).map((x) => x.dao_cua));
  const lechSauChot = chot && xt && (chot.dt_cong !== xt.dt_cong || chot.chi_phi_phieu !== xt.chi_phi_phieu || chot.chi_xuong !== xt.chi_xuong
    || chot.thu_cong !== xt.thu_cong || chot.dt_pt !== xt.dt_pt || chot.gia_von_pt !== xt.gia_von_pt);

  async function chotKy() {
    if (!tinh || !xt) return;
    setError(""); setNotice("");
    if (nguoi.length === 0) return setError("Hãy thêm ít nhất một người nhận.");
    if (nguoi.some((n) => !n.ten.trim())) return setError("Mỗi dòng phải có tên người nhận.");
    if (Math.abs(tinh.tongPt - 100) > 0.001) return setError(`Tổng phần trăm phải đúng 100% (đang là ${String(tinh.tongPt).replace(".", ",")}%).`);
    if (kk !== 0 && !kkGc.trim()) return setError("Có khoản cộng/trừ khác thì phải ghi lý do.");
    setBusy(true);
    const r = await supabase.rpc("chia_tien_chot_khoang", {
      p_tu: tu, p_den: den, p_du_phong_pt: pctDp, p_khoan_khac: kk, p_khoan_khac_ghi_chu: kkGc.trim() || null,
      p_nguoi: nguoi.map((n) => ({ ten: n.ten.trim(), phan_tram: toNum(n.pt || "0") || 0 })), p_ghi_chu: ghiChu.trim() || null,
    });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã chốt chia tiền kỳ ${tenKy}.`);
    setXacNhan(false); setKkTien(""); setKkGc(""); setGhiChu("");
    await Promise.all([loadThang(), loadChung()]);
  }

  async function huyKy() {
    if (!chot || huyLy === null) return;
    if (!huyLy.trim()) return setError("Hãy nhập lý do hủy kỳ.");
    setBusy(true); setError("");
    const r = await supabase.rpc("chia_tien_huy", { p_id: chot.id, p_ly_do: huyLy.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã hủy kỳ ${fmtDate(chot.tu)} – ${fmtDate(chot.den)}. Phần trích dự phòng đã được đảo lại.`);
    setHuyLy(null);
    await Promise.all([loadThang(), loadChung()]);
  }

  async function dungDp(e: React.FormEvent) {
    e.preventDefault();
    if (!dung) return;
    const tien = Number(digits(dung.tien) || 0);
    if (tien <= 0) return setError("Nhập số tiền dùng.");
    if (!dung.ly.trim()) return setError("Hãy nhập lý do dùng quỹ dự phòng.");
    setBusy(true); setError("");
    const r = await supabase.rpc("du_phong_dung", { p_so_tien: tien, p_ngay: dung.ngay || null, p_ly_do: dung.ly.trim(), p_so_phieu_chi: dung.phieu.trim() || null });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã ghi dùng ${money(tien)} từ quỹ dự phòng.`);
    setDung(null);
    await Promise.all([loadThang(), loadChung()]);
  }

  async function huyDung() {
    if (!huyDp) return;
    if (!huyDp.ly.trim()) return setError("Hãy nhập lý do hủy.");
    setBusy(true); setError("");
    const r = await supabase.rpc("du_phong_huy", { p_id: huyDp.id, p_ly_do: huyDp.ly.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setHuyDp(null);
    await Promise.all([loadThang(), loadChung()]);
  }

  async function doiNhom(l: Loai, nhom: Nhom) {
    setBusy(true); setError("");
    const r = await supabase.rpc("loai_nhom_chia_dat", { p_bang: l.bang, p_ten: l.ten, p_nhom: nhom });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã đổi nhóm của "${l.ten}".`);
    await Promise.all([loadThang(), loadChung()]);
  }


  return (
    <div className="space-y-4 max-w-4xl">
      <PageTitle icon={<Icon name="users" />} title="Chia tiền" />
      <Toast text={error} onClose={() => setError("")} />
      <Toast text={notice} kind="ok" onClose={() => setNotice("")} />

      <section className="card space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <label className="block">
            <span className={lbl}>Từ ngày</span>
            <input type="date" className={inp} value={tu} max={den || undefined} onChange={(e) => setTu(e.target.value)} />
          </label>
          <label className="block">
            <span className={lbl}>Đến ngày</span>
            <input type="date" className={inp} value={den} min={tu || undefined} onChange={(e) => setDen(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => chonThang(1)} className="btn-secondary text-sm">Tháng trước</button>
          <button type="button" onClick={() => chonThang(0)} className="btn-secondary text-sm">Tháng này</button>
          {xt?.goi_y_tu && xt.goi_y_tu <= xt.hom_nay && (
            <button type="button" onClick={() => { setTu(xt.goi_y_tu!); setDen(xt.hom_nay); }} className="btn-secondary text-sm">Từ sau kỳ trước đến hôm nay</button>
          )}
        </div>
        <div className="text-sm text-slate-600">
          Quỹ dự phòng hiện có: <b className={dpSoDu < 0 ? "text-red-700" : "text-navy-900"}>{money(dpSoDu)}</b>
          {xt?.goi_y_tu && <> · Kỳ đã chốt gần nhất kết thúc ngày {fmtDate(ngayTruoc(xt.goi_y_tu))}</>}
        </div>
      </section>

      {!xt ? <div className="card text-sm text-slate-500">{error ? "Không tải được số liệu." : "Đang tải..."}</div> : (
        <>
          {xt.pt_thieu_gia.length > 0 && (
            <div className="card border border-amber-300 bg-amber-50 text-sm space-y-1">
              <b className="text-amber-800">Có phiếu chứa phụ tùng chưa có giá nhập (giá vốn = 0)</b>
              <p>Lợi nhuận phụ tùng của các phiếu này đang bị tính cao hơn thực tế. Kiểm tra trước khi chốt:</p>
              <div className="flex flex-wrap gap-2">
                {xt.pt_thieu_gia.map((t) => <Link key={t.order_id} href={`/tiep-nhan/${t.order_id}`} className="underline text-brand-600 min-h-11 inline-flex items-center">PT{String(t.ma_phieu).padStart(4, "0")} ({t.so_dong} dòng)</Link>)}
              </div>
            </div>
          )}
          {trung.length > 0 && (
            <div className="card border border-red-300 bg-red-50 text-sm text-red-800">
              Khoảng ngày này trùng với kỳ đã chốt {trung.map((t) => `${fmtDate(t.tu)} – ${fmtDate(t.den)}`).join(", ")}. Không chốt được để tránh chia trùng.
              Chọn ngày khác, hoặc mở kỳ đó ở danh sách &quot;Các kỳ đã chốt&quot; để hủy (lý do bắt buộc).
            </div>
          )}
          {!chot && chuaHetThang && !thangTuongLai && (
            <div className="card border border-sky-200 bg-sky-50 text-sm">Kỳ {tenKy} gồm cả hôm nay: số liệu còn thay đổi nếu có thêm phiếu hoặc thu chi.</div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="card space-y-1">
              <h2 className="font-bold text-sky-800">Phần CÔNG (chia cho mọi người)</h2>
              <Dong label="Doanh thu công" value={(chot ?? xt).dt_cong} sub={`${(chot ?? xt).so_phieu} phiếu hoàn thành trong kỳ · tổng doanh thu ${money((chot ?? xt).doanh_thu)}`} />
              <Dong label="Chi phí phiếu (vật tư, thuê ngoài, khác)" value={(chot ?? xt).chi_phi_phieu} sign="−" />
              <Dong label="Chi phí nuôi xưởng (sổ quỹ)" value={(chot ?? xt).chi_xuong} sign="−" />
              {cong.filter((c) => c.loai === "chi").map((c) => <div key={"c" + c.danh_muc} className="flex justify-between text-xs text-slate-500 pl-3"><span>· {c.danh_muc}</span><span>{money(c.so_tien)}</span></div>)}
              {(chot ?? xt).thu_cong !== 0 && <Dong label="Thu khác nhóm công (sổ quỹ)" value={(chot ?? xt).thu_cong} sign="+" />}
              {!chot && (
                <div className="py-2 space-y-2">
                  <span className={lbl}>Khoản cộng / trừ khác (nếu có)</span>
                  <div className="flex gap-2">
                    <select className="border rounded-lg px-2 min-h-11 bg-white" value={kkDau} onChange={(e) => setKkDau(e.target.value as "+" | "-")}>
                      <option value="+">Cộng</option><option value="-">Trừ</option>
                    </select>
                    <input inputMode="numeric" className={inp} placeholder="0" value={kkTien ? Number(digits(kkTien)).toLocaleString("vi-VN") : ""} onChange={(e) => setKkTien(digits(e.target.value))} />
                  </div>
                  {kk !== 0 && <input className={inp} placeholder="Lý do (bắt buộc)" value={kkGc} onChange={(e) => setKkGc(e.target.value)} maxLength={500} />}
                </div>
              )}
              {chot && chot.khoan_khac !== 0 && <Dong label={`Khoản khác: ${chot.khoan_khac_ghi_chu ?? ""}`} value={chot.khoan_khac} sign={chot.khoan_khac < 0 ? "−" : "+"} />}
              {(() => {
                const pc = chot ? chot.phan_cong : tinh!.phanCong;
                const du = chot ? chot.du_phong : tinh!.du;
                const ch = chot ? chot.phan_chia : tinh!.chia;
                const p = chot ? chot.du_phong_pt : pctDp;
                return (
                  <>
                    <Dong label="Phần công còn lại" value={pc} bold red={pc < 0} />
                    {!chot && (
                      <label className="flex items-center justify-between gap-3 py-1 text-sm">
                        <span>Trích quỹ dự phòng (%)</span>
                        <input inputMode="decimal" className="border rounded-lg px-3 min-h-11 w-24 text-right bg-white" value={dpPt} onChange={(e) => setDpPt(decimalInput(e.target.value, 2))} />
                      </label>
                    )}
                    <Dong label={`Quỹ dự phòng ${String(p).replace(".", ",")}%`} value={du} sign="−" />
                    <Dong label="Phần chia cho mọi người" value={ch} bold />
                    {pc <= 0 && <p className="text-sm text-red-700">Phần công không dương: kỳ này không trích dự phòng và không có tiền chia.</p>}
                  </>
                );
              })()}
            </section>

            <section className="card space-y-1">
              <h2 className="font-bold text-amber-800">Phần PHỤ TÙNG (của chủ, không chia)</h2>
              <Dong label="Doanh thu phụ tùng" value={chot ? chot.dt_pt : xt.dt_pt} />
              <Dong label="Giá vốn phụ tùng (giá nhập)" value={chot ? chot.gia_von_pt : xt.gia_von_pt} sign="−" />
              {(chot ? chot.chi_pt : xt.chi_pt) !== 0 && <Dong label="Chi nhóm phụ tùng (sổ quỹ)" value={chot ? chot.chi_pt : xt.chi_pt} sign="−" />}
              {pt.map((c) => <div key={"p" + c.loai + c.danh_muc} className="flex justify-between text-xs text-slate-500 pl-3"><span>· {c.loai === "thu" ? "Thu" : "Chi"}: {c.danh_muc}</span><span>{money(c.so_tien)}</span></div>)}
              {(chot ? chot.thu_pt : xt.thu_pt) !== 0 && <Dong label="Thu nhóm phụ tùng (sổ quỹ)" value={chot ? chot.thu_pt : xt.thu_pt} sign="+" />}
              <Dong label="Lợi nhuận phụ tùng của chủ" value={chot ? chot.ln_pt_chu : tinh!.lnPt} bold red={(chot ? chot.ln_pt_chu : tinh!.lnPt) < 0} />
              {khong.length > 0 && (
                <details className="pt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer min-h-11 flex items-center">Thu / chi không tính khi chia ({khong.length})</summary>
                  {khong.map((c) => <div key={"k" + c.loai + c.danh_muc} className="flex justify-between pl-3"><span>· {c.loai === "thu" ? "Thu" : "Chi"}: {c.danh_muc}</span><span>{money(c.so_tien)}</span></div>)}
                </details>
              )}
            </section>
          </div>

          <section className="card space-y-3">
            <h2 className="font-bold">Chia cho mọi người {chot ? `(đã chốt kỳ ${fmtDate(chot.tu)} – ${fmtDate(chot.den)})` : ""}</h2>
            {chot ? (
              <>
                <ul className="divide-y">
                  {xt.nguoi_da_chot.map((n) => (
                    <li key={n.thu_tu} className="py-2 flex justify-between gap-3"><span>{n.ten} <span className="text-slate-500 text-sm">({String(n.phan_tram).replace(".", ",")}%)</span></span><b className="tabular-nums">{money(n.so_tien)}</b></li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500">Chốt lúc {new Date(chot.created_at).toLocaleString("vi-VN")} · {chot.created_by_name ?? ""}{chot.ghi_chu ? ` · ${chot.ghi_chu}` : ""}</p>
                <p className="text-sm text-slate-600">Khi trả tiền chia, ghi phiếu chi trong Sổ quỹ với loại <b>Chia tiền tháng</b> (không bị trừ lại vào kỳ sau).</p>
                {lechSauChot && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-2">Số liệu kỳ này đã thay đổi sau khi chốt (có phiếu hoặc thu chi được sửa). Nếu cần chia lại: hủy kỳ rồi chốt lại.</p>}
                {huyLy === null ? (
                  <button disabled={busy} onClick={() => setHuyLy("")} className="btn-secondary text-red-700">Hủy kỳ này</button>
                ) : (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
                    <input className={inp} placeholder="Lý do hủy (bắt buộc)" value={huyLy} onChange={(e) => setHuyLy(e.target.value)} maxLength={500} />
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={huyKy} className="btn-danger">Xác nhận hủy kỳ</button>
                      <button onClick={() => setHuyLy(null)} className="btn-secondary">Không hủy</button>
                    </div>
                  </div>
                )}
              </>
            ) : thangTuongLai ? <p className="text-sm text-slate-500">Kỳ này chưa tới.</p> : trung.length > 0 ? <p className="text-sm text-red-700">Trùng ngày với kỳ đã chốt, không chốt được.</p> : (
              <>
                <ul className="space-y-2">
                  {nguoi.map((n, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <input className={inp + " sm:flex-1 sm:w-auto"} placeholder="Tên người nhận" value={n.ten} maxLength={100}
                        onChange={(e) => setNguoi(nguoi.map((x, j) => (j === i ? { ...x, ten: e.target.value } : x)))} />
                      <span className="flex items-center gap-1">
                        <input inputMode="decimal" className="border rounded-lg px-3 min-h-11 w-20 text-right bg-white" placeholder="0" value={n.pt}
                          onChange={(e) => setNguoi(nguoi.map((x, j) => (j === i ? { ...x, pt: decimalInput(e.target.value, 2) } : x)))} />%
                      </span>
                      <b className="flex-1 sm:flex-none sm:w-32 text-right tabular-nums">{money(tinh?.tien[i] ?? 0)}</b>
                      <button type="button" onClick={() => setNguoi(nguoi.filter((_, j) => j !== i))} className="btn-secondary text-red-700" aria-label="Xóa dòng">Xóa</button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setNguoi([...nguoi, { ten: "", pt: "" }])} className="btn-secondary"><Icon name="plus" className="w-4 h-4" />Thêm người</button>
                  <span className={`text-sm font-semibold ${tinh && Math.abs(tinh.tongPt - 100) > 0.001 ? "text-red-700" : "text-green-700"}`}>
                    Tổng: {String(tinh?.tongPt ?? 0).replace(".", ",")}% {tinh && Math.abs(tinh.tongPt - 100) > 0.001 ? "(phải đúng 100%)" : "✓"}
                  </span>
                </div>
                <input className={inp} placeholder="Ghi chú kỳ này (không bắt buộc)" value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} maxLength={500} />
                {!xacNhan ? (
                  <button disabled={busy || !macDinhXong} onClick={() => setXacNhan(true)} className="btn-primary w-full sm:w-auto">Chốt chia tiền {tenKy}</button>
                ) : (
                  <div className="rounded-lg border border-brand-500 bg-sky-50 p-3 space-y-2 text-sm">
                    <p>Chốt kỳ <b>{tenKy}</b>: phần chia <b>{money(tinh?.chia ?? 0)}</b>, trích dự phòng <b>{money(tinh?.du ?? 0)}</b>, lợi nhuận phụ tùng của chủ <b>{money(tinh?.lnPt ?? 0)}</b>.</p>
                    <p>Máy chủ sẽ tính lại các con số khi chốt. Sau khi chốt không sửa được, chỉ hủy được (có lý do). Việc chốt không ghi gì vào Sổ quỹ.</p>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={chotKy} className="btn-primary">Xác nhận chốt</button>
                      <button onClick={() => setXacNhan(false)} className="btn-secondary">Xem lại</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Quỹ dự phòng: <span className={dpSoDu < 0 ? "text-red-700" : ""}>{money(dpSoDu)}</span></h2>
          {!dung && <button onClick={() => setDung({ tien: "", ngay: new Date().toLocaleDateString("sv-SE"), ly: "", phieu: "" })} className="btn-secondary">Dùng dự phòng</button>}
        </div>
        <p className="text-xs text-slate-500">Sổ theo dõi riêng, không phải quỹ tiền: số dư Tiền mặt / Tài khoản ngân hàng không đổi. Khi chi tiền thật, ghi phiếu chi trong Sổ quỹ rồi nhập mã phiếu chi ở đây.</p>
        {dung && (
          <form onSubmit={dungDp} className="grid gap-3 sm:grid-cols-2 rounded-lg border p-3">
            <label className="block"><span className={lbl}>Số tiền</span>
              <input inputMode="numeric" className={inp} value={dung.tien ? Number(dung.tien).toLocaleString("vi-VN") : ""} onChange={(e) => setDung({ ...dung, tien: digits(e.target.value) })} /></label>
            <label className="block"><span className={lbl}>Ngày</span>
              <input type="date" className={inp} max={new Date().toLocaleDateString("sv-SE")} value={dung.ngay} onChange={(e) => setDung({ ...dung, ngay: e.target.value })} /></label>
            <label className="block sm:col-span-2"><span className={lbl}>Lý do (bắt buộc)</span>
              <input className={inp} value={dung.ly} maxLength={500} placeholder="Ví dụ: hỏng máy nén khí" onChange={(e) => setDung({ ...dung, ly: e.target.value })} /></label>
            <label className="block"><span className={lbl}>Mã phiếu chi Sổ quỹ (nếu có)</span>
              <input className={inp} value={dung.phieu} maxLength={20} placeholder="CHI0012" onChange={(e) => setDung({ ...dung, phieu: e.target.value })} /></label>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <button disabled={busy} className="btn-primary">Ghi dùng dự phòng</button>
              <button type="button" onClick={() => setDung(null)} className="btn-secondary">Đóng</button>
            </div>
          </form>
        )}
        {dp.length === 0 ? <p className="text-sm text-slate-500">Chưa có dòng nào.</p> : (
          <ul className="divide-y">
            {dp.map((d) => (
              <li key={d.id} className="py-2 text-sm space-y-1">
                <div className="flex justify-between gap-3">
                  <span>{fmtDate(d.ngay)} · <b>{d.loai === "trich" ? "Trích" : d.loai === "dung" ? "Dùng" : "Hủy / đảo"}</b>{d.so_phieu_chi ? ` · ${d.so_phieu_chi}` : ""}</span>
                  <b className={`tabular-nums ${d.so_tien < 0 ? "text-red-700" : "text-green-700"}`}>{d.so_tien > 0 ? "+" : "−"} {money(Math.abs(d.so_tien))}</b>
                </div>
                <div className="text-slate-500">{d.ly_do}{d.created_by_name ? ` · ${d.created_by_name}` : ""}{daDao.has(d.id) ? " · đã hủy" : ""}</div>
                {d.loai === "dung" && !daDao.has(d.id) && (huyDp?.id === d.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input className={inp + " flex-1 min-w-40"} placeholder="Lý do hủy" value={huyDp.ly} onChange={(e) => setHuyDp({ ...huyDp, ly: e.target.value })} />
                    <button disabled={busy} onClick={huyDung} className="btn-danger">Hủy dòng này</button>
                    <button onClick={() => setHuyDp(null)} className="btn-secondary">Đóng</button>
                  </div>
                ) : <button onClick={() => setHuyDp({ id: d.id, ly: "" })} className="bare text-red-600 min-h-11">Hủy</button>)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-bold">Các kỳ đã chốt</h2>
        {kys.length === 0 ? <p className="text-sm text-slate-500">Chưa chốt kỳ nào.</p> : (
          <ul className="divide-y">
            {kys.map((k) => (
              <li key={k.id} className="py-2 text-sm flex flex-wrap justify-between gap-2">
                <button className="bare text-brand-600 underline min-h-11" onClick={() => { setTu(k.tu); setDen(k.den); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{fmtDate(k.tu)} – {fmtDate(k.den)}</button>
                <span className={k.da_huy ? "line-through text-slate-400" : ""}>Chia {money(N(k.phan_chia))} · Dự phòng {money(N(k.du_phong))} · LN phụ tùng {money(N(k.ln_pt_chu))}</span>
                {k.da_huy && <span className="w-full text-xs text-red-700">Đã hủy: {k.huy_ly_do} · {k.huy_boi_ten ?? ""}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card">
        <summary className="font-bold cursor-pointer min-h-11 flex items-center">Nhóm chia tiền của từng loại thu / chi trong Sổ quỹ</summary>
        <p className="text-xs text-slate-500 my-2">
          Phần công: chi phí nuôi xưởng (điện nước, lương cố định...) bị trừ trước khi chia. Phần phụ tùng: trừ vào lãi phụ tùng của chủ.
          Không tính: nhập hàng, vốn, chia tiền... Khoản thu của phiếu sửa chữa và chi phí của phiếu đã tính qua phiếu nên không lặp lại ở đây.
          Phiếu thu loại &quot;Thu khác&quot; không tính; cần thì dùng ô &quot;Khoản cộng / trừ khác&quot;.
        </p>
        <ul className="divide-y">
          {loais.map((l) => (
            <li key={l.bang + l.ten} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm"><b>{l.bang === "chi" ? "Chi" : "Thu"}:</b> {l.ten}</span>
              <select disabled={busy} className="border rounded-lg px-2 min-h-11 bg-white text-sm max-w-full" value={l.nhom_chia ?? "khong"} onChange={(e) => doiNhom(l, e.target.value as Nhom)}>
                {NHOM.map((n) => <option key={n.v} value={n.v}>{n.label}</option>)}
              </select>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
