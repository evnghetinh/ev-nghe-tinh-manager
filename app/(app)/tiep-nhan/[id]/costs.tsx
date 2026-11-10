"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";

type Kind = "vat_tu" | "thue_ngoai" | "khac";
type Trang = "chua_ghi" | "chua_chi" | "da_ghi";
type Hinh = "tien_mat" | "chuyen_khoan" | "chua_chi" | "giu_nguyen";
type Quy = "Tiền mặt" | "Tài khoản ngân hàng";
type Cost = { id: string; kind: Kind; content: string; amount: number; note: string | null; da_huy: boolean; huy_ly_do: string | null; huy_boi_ten: string | null; huy_luc: string | null; created_by_name: string | null; created_at: string; trang_thai_quy: Trang };
type Dong = { chi_phi_id: string; quy: Quy; so_tien: number; ngay: string; so_phieu: string | null };
type Log = { id: string; action: "them" | "sua" | "xoa" | "huy"; kind: Kind; content: string; amount_before: number | null; amount_after: number | null; note: string | null; detail: string | null; created_by_name: string | null; created_at: string };

const KINDS: { v: Kind; label: string }[] = [{ v: "vat_tu", label: "Vật tư tiêu hao" }, { v: "thue_ngoai", label: "Thuê ngoài" }, { v: "khac", label: "Khác" }];
const label = (k: string) => KINDS.find((x) => x.v === k)?.label ?? k;
const today = () => new Date().toLocaleDateString("sv-SE");
const fmtDate = (d: string) => d.split("-").reverse().join("/");
const hinhOfQuy = (q: Quy): Hinh => (q === "Tiền mặt" ? "tien_mat" : "chuyen_khoan");
const quyOfHinh = (h: Hinh): Quy | null => (h === "tien_mat" ? "Tiền mặt" : h === "chuyen_khoan" ? "Tài khoản ngân hàng" : null);
const empty = { kind: "vat_tu" as Kind, content: "", amount: "", note: "", hinh: "chua_chi" as Hinh, ngay: today(), lyDo: "" };

const inp = "w-full border rounded-lg px-3 py-2 min-h-11 text-base bg-white";
const lbl = "block text-sm font-semibold text-slate-700 mb-1";

// Ô xác nhận khi số chi lớn hơn số dư quỹ
function VuotBox({ msg, ok, ly, onOk, onLy }: { msg: string; ok: boolean; ly: string; onOk: (v: boolean) => void; onLy: (v: string) => void }) {
  return (
    <div className="sm:col-span-2 rounded-lg border border-red-300 bg-red-50 p-3 space-y-2 text-sm">
      <div className="text-red-800 font-semibold">{msg}</div>
      <label className="flex items-start gap-2 min-h-11">
        <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={ok} onChange={(e) => onOk(e.target.checked)} />
        <span>Tôi xác nhận <b>chi vượt số dư</b></span>
      </label>
      <input className={inp} placeholder="Lý do chi vượt số dư (bắt buộc) *" value={ly} maxLength={400} onChange={(e) => onLy(e.target.value)} />
    </div>
  );
}

export default function Costs({ orderId, revenue: revenueIn, partsCost: partsCostIn, cancelled = false, huyLuc = null }: { orderId: string; revenue: number; partsCost: number; cancelled?: boolean; huyLuc?: string | null }) {
  // Phiếu đã hủy: không tính doanh thu, giá vốn, lợi nhuận
  const revenue = cancelled ? 0 : revenueIn;
  const partsCost = cancelled ? 0 : partsCostIn;
  const [costs, setCosts] = useState<Cost[]>([]);
  const [dongs, setDongs] = useState<Record<string, Dong>>({});
  const [du, setDu] = useState<Partial<Record<Quy, number>>>({});
  const [logs, setLogs] = useState<Log[]>([]);
  const [form, setForm] = useState(empty);
  const [vuotOk, setVuotOk] = useState(false);
  const [vuotLy, setVuotLy] = useState("");
  const [forceVuot, setForceVuot] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [pay, setPay] = useState<{ id: string; hinh: "tien_mat" | "chuyen_khoan"; ngay: string; ok: boolean; ly: string; force: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDu = useCallback(async () => {
    const d: Partial<Record<Quy, number>> = {};
    for (const q of ["Tiền mặt", "Tài khoản ngân hàng"] as Quy[]) {
      const r = await supabase.rpc("quy_so_du", { p_quy: q });
      if (!r.error && r.data !== null) d[q] = Number(r.data);
    }
    setDu(d);
  }, []);

  const load = useCallback(async () => {
    const c = await supabase.from("repair_costs").select("id, kind, content, amount, note, da_huy, huy_ly_do, huy_boi_ten, huy_luc, created_by_name, created_at, trang_thai_quy").eq("order_id", orderId).order("created_at");
    const l = await supabase.from("repair_cost_logs").select("id, action, kind, content, amount_before, amount_after, note, detail, created_by_name, created_at").eq("order_id", orderId).order("created_at", { ascending: false });
    if (c.error) { setError(c.error.message + " (đã chạy giai-doan-26.sql chưa?)"); return; }
    const list = (c.data as Cost[]).map((x) => ({ ...x, amount: Number(x.amount) }));
    setCosts(list);
    if (l.data) setLogs(l.data as Log[]);
    const ids = list.filter((x) => x.trang_thai_quy === "da_ghi" && !x.da_huy).map((x) => x.id);
    const m: Record<string, Dong> = {};
    if (ids.length) {
      const s = await supabase.from("so_quy_xem").select("chi_phi_id, quy, so_tien, ngay, so_phieu").in("chi_phi_id", ids).eq("loai", "chi").eq("da_dao", false);
      if (s.error) setError(s.error.message + " (đã chạy giai-doan-26.sql chưa?)");
      for (const d of (s.data ?? []) as Dong[]) m[d.chi_phi_id] = { ...d, so_tien: Number(d.so_tien) };
    }
    setDongs(m);
    loadDu();
  }, [orderId, loadDu]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const amountNum = Number(form.amount || 0);
  const editing = editId ? costs.find((c) => c.id === editId) : undefined;
  const oldDong = editing ? dongs[editing.id] : undefined;
  const quyForm = quyOfHinh(form.hinh);
  // Số dư có thể dùng: nếu sửa khoản đã ghi cùng quỹ thì tiền của dòng cũ sẽ được trả lại trước
  const duDung = quyForm && du[quyForm] !== undefined ? du[quyForm]! + (oldDong && oldDong.quy === quyForm ? -oldDong.so_tien : 0) : null;
  const canhBaoForm = quyForm !== null && duDung !== null && amountNum > duDung;
  const showVuot = canhBaoForm || forceVuot;

  function resetForm() { setForm({ ...empty, ngay: today() }); setEditId(null); setVuotOk(false); setVuotLy(""); setForceVuot(false); }

  function loiRpc(msg: string, setForce: () => void) {
    if (msg.startsWith("VUOT_SO_DU|")) { setForce(); setError(msg.slice("VUOT_SO_DU|".length)); } else setError(msg);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice("");
    const amount = Number(form.amount || 0);
    const ghi = form.hinh === "tien_mat" || form.hinh === "chuyen_khoan";
    if (showVuot && ghi && (!vuotOk || !vuotLy.trim())) return setError("Số chi lớn hơn số dư quỹ: hãy tick xác nhận \"chi vượt số dư\" và nhập lý do.");
    if (editing && oldDong) {
      const doi = amount !== editing.amount || (quyForm !== null && quyForm !== oldDong.quy) || form.kind !== editing.kind || (ghi && form.ngay !== oldDong.ngay) || form.hinh === "chua_chi";
      if (doi && !form.lyDo.trim()) return setError("Khoản này đã ghi sổ quỹ: nhập lý do sửa (dòng cũ được đảo, không sửa).");
    }
    setBusy(true);
    const base = { p_kind: form.kind, p_content: form.content, p_amount: amount, p_note: form.note, p_hinh_thuc: form.hinh, p_ngay: ghi ? form.ngay || null : null, p_vuot: vuotOk, p_vuot_ly_do: vuotLy.trim() };
    const r = editId
      ? await supabase.rpc("chi_phi_phieu_sua", { p_id: editId, ...base, p_ly_do: form.lyDo.trim() })
      : await supabase.rpc("chi_phi_phieu_them", { p_order: orderId, ...base });
    setBusy(false);
    if (r.error) return loiRpc(r.error.message, () => setForceVuot(true));
    setNotice(editId ? "Đã lưu chi phí." : ghi ? "Đã thêm chi phí và ghi chi vào sổ quỹ." : "Đã thêm chi phí (chưa chi).");
    resetForm(); load();
  }

  async function ghiQuy(e: React.FormEvent) {
    e.preventDefault();
    if (!pay) return;
    setError(""); setNotice("");
    const c = costs.find((x) => x.id === pay.id);
    const d = du[quyOfHinh(pay.hinh)!];
    const vuot = pay.force || (c !== undefined && d !== undefined && c.amount > d);
    if (vuot && (!pay.ok || !pay.ly.trim())) return setError("Số chi lớn hơn số dư quỹ: hãy tick xác nhận \"chi vượt số dư\" và nhập lý do.");
    setBusy(true);
    const r = await supabase.rpc("chi_phi_phieu_ghi_quy", { p_id: pay.id, p_hinh_thuc: pay.hinh, p_ngay: pay.ngay || null, p_vuot: pay.ok, p_vuot_ly_do: pay.ly.trim() });
    setBusy(false);
    if (r.error) return loiRpc(r.error.message, () => setPay({ ...pay, force: true }));
    setNotice("Đã ghi vào sổ quỹ."); setPay(null); load();
  }

  async function remove(c: Cost) {
    const dong = dongs[c.id];
    const ly = window.prompt(`Hủy chi phí "${c.content}" (${money(c.amount)}). Dòng được giữ lại và đánh dấu đã hủy, không tính vào lợi nhuận.${dong ? `\nDòng chi trong sổ quỹ (${dong.quy}) sẽ được đảo lại.` : ""}\n\nLý do hủy (bắt buộc):`);
    if (ly === null) return;
    if (!ly.trim()) return setError("Bắt buộc nhập lý do hủy chi phí.");
    setError(""); setNotice(""); setBusy(true);
    const r = await supabase.rpc("chi_phi_huy", { p_id: c.id, p_ly_do: ly.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    if (editId === c.id) resetForm();
    if (pay?.id === c.id) setPay(null);
    load();
  }

  function startEdit(c: Cost) {
    const dong = dongs[c.id];
    setEditId(c.id); setPay(null); setVuotOk(false); setVuotLy(""); setForceVuot(false);
    setForm({
      kind: c.kind, content: c.content, amount: String(c.amount), note: c.note ?? "",
      hinh: c.trang_thai_quy === "da_ghi" && dong ? hinhOfQuy(dong.quy) : c.trang_thai_quy === "chua_chi" ? "chua_chi" : "giu_nguyen",
      ngay: dong?.ngay ?? today(), lyDo: "",
    });
  }
  function startPay(c: Cost) {
    setPay({ id: c.id, hinh: "tien_mat", ngay: today(), ok: false, ly: "", force: false });
    setEditId(null); setError(""); setNotice("");
  }

  const other = costs.filter((c) => !c.da_huy).reduce((s, c) => s + c.amount, 0);
  const profit = revenue - partsCost - other;
  const ghiHinh = form.hinh === "tien_mat" || form.hinh === "chuyen_khoan";
  const payQuy = pay ? quyOfHinh(pay.hinh)! : null;
  const payCost = pay ? costs.find((x) => x.id === pay.id) : undefined;
  const payDu = payQuy ? du[payQuy] : undefined;
  const payVuot = !!pay && (pay.force || (payCost !== undefined && payDu !== undefined && payCost.amount > payDu));

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-3 border-l-4 border-amber-500">
      <div>
        <h2 className="font-bold">Chi phí của phiếu</h2>
        <p className="text-xs text-slate-500">Chỉ Chủ xưởng thấy. Đây là tiền gara bỏ ra, không in lên phiếu báo giá của khách.</p>
      </div>
      {error && <p className="text-sm text-red-600 break-words">{error}</p>}
      {notice && <p className="text-sm text-emerald-700 break-words">{notice}</p>}

      {cancelled && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">Phiếu đã hủy: mọi chi phí đã được hủy và đảo khỏi sổ quỹ. Không thêm hoặc sửa chi phí được nữa.</p>}
      {!cancelled && <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <select className={inp} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
        <input required placeholder="Nội dung (vd: hàn tấm pin) *" className={inp} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        <input required placeholder="Số tiền (đ) *" inputMode="numeric" className={inp} value={form.amount ? new Intl.NumberFormat("vi-VN").format(Number(form.amount)) : ""} onChange={(e) => setForm({ ...form, amount: digits(e.target.value) })} />
        <input placeholder="Ghi chú" className={inp} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <label className="block">
          <span className={lbl}>Hình thức chi</span>
          <select className={inp} value={form.hinh} onChange={(e) => setForm({ ...form, hinh: e.target.value as Hinh })}>
            {editing && editing.trang_thai_quy === "chua_ghi" && <option value="giu_nguyen">Chưa ghi vào sổ quỹ (giữ nguyên)</option>}
            <option value="tien_mat">Tiền mặt (trừ quỹ Tiền mặt)</option>
            <option value="chuyen_khoan">Chuyển khoản (trừ quỹ Tài khoản)</option>
            <option value="chua_chi">Chưa chi</option>
          </select>
        </label>
        {ghiHinh && (
          <label className="block">
            <span className={lbl}>Ngày chi</span>
            <input type="date" className={inp} max={today()} value={form.ngay} onChange={(e) => setForm({ ...form, ngay: e.target.value })} />
          </label>
        )}
        {quyForm && duDung !== null && <p className="sm:col-span-2 text-xs text-slate-500">Quỹ {quyForm} đang có {money(duDung)}.</p>}
        {showVuot && ghiHinh && (
          <VuotBox msg={`Số chi ${money(amountNum)} lớn hơn số dư quỹ ${quyForm ?? ""}${duDung !== null ? ` (${money(duDung)})` : ""}.`} ok={vuotOk} ly={vuotLy} onOk={setVuotOk} onLy={setVuotLy} />
        )}
        {editing && editing.trang_thai_quy === "da_ghi" && (
          <label className="block sm:col-span-2">
            <span className={lbl}>Lý do sửa (bắt buộc nếu đổi số tiền, quỹ, loại hoặc ngày chi)</span>
            <input className={inp} value={form.lyDo} maxLength={500} onChange={(e) => setForm({ ...form, lyDo: e.target.value })} />
            <span className="text-xs text-slate-500">Dòng chi cũ trong sổ quỹ được giữ nguyên và đảo lại, rồi thêm dòng mới.</span>
          </label>
        )}
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button disabled={busy} className="bg-amber-600 text-white rounded-lg px-4 py-2 min-h-11 disabled:opacity-50">{editId ? "Lưu sửa" : "Thêm chi phí"}</button>
          {editId && <button type="button" onClick={resetForm} className="border rounded-lg px-4 py-2 min-h-11">Hủy sửa</button>}
        </div>
      </form>}

      <ul className="space-y-2">
        {costs.map((c) => {
          const dong = dongs[c.id];
          return (
            <li key={c.id} className={`border rounded-lg p-3 space-y-2 ${c.da_huy ? "bg-slate-50 text-slate-400" : ""}`}>
              <div className="flex justify-between gap-2 items-start">
                <div className="text-sm min-w-0">
                  <div className={`font-medium break-words ${c.da_huy ? "line-through" : ""}`}>{c.content} <span className="text-xs text-slate-500">({label(c.kind)})</span></div>
                  {c.note && <div className="text-slate-500 break-words">{c.note}</div>}
                  <div className="text-xs text-slate-500">Ghi bởi {c.created_by_name ?? "Không rõ"} · {new Date(c.created_at).toLocaleString("vi-VN")}</div>
                  {!c.da_huy && c.trang_thai_quy === "da_ghi" && (
                    <div className="text-xs text-emerald-700 break-words">
                      Đã chi{dong ? `: ${dong.quy === "Tiền mặt" ? "Tiền mặt" : "Chuyển khoản"} · ${fmtDate(dong.ngay)}${dong.so_phieu ? ` · ${dong.so_phieu}` : ""} (sổ quỹ ${dong.quy})` : " (đã ghi sổ quỹ)"}
                    </div>
                  )}
                  {!c.da_huy && c.trang_thai_quy === "chua_chi" && <span className="inline-block mt-1 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">Chưa chi</span>}
                  {!c.da_huy && c.trang_thai_quy === "chua_ghi" && <span className="inline-block mt-1 text-xs font-semibold bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">Chưa ghi vào sổ quỹ</span>}
                  {c.da_huy && cancelled && !!huyLuc && !!c.huy_luc && new Date(c.huy_luc).getTime() >= new Date(huyLuc).getTime() && <span className="inline-block mt-1 text-xs font-semibold bg-red-100 text-red-700 rounded-full px-2 py-0.5">Đã hủy do hủy phiếu</span>}
                  {c.da_huy && <div className="text-xs text-red-600">Đã hủy bởi {c.huy_boi_ten ?? "Không rõ"} lúc {c.huy_luc ? new Date(c.huy_luc).toLocaleString("vi-VN") : ""} · Lý do: {c.huy_ly_do}</div>}
                </div>
                <div className={`font-medium text-sm shrink-0 ${c.da_huy ? "line-through" : ""}`}>{money(c.amount)}</div>
              </div>
              {!c.da_huy && !cancelled && (
                <div className="flex flex-wrap gap-2 text-sm">
                  {c.trang_thai_quy === "chua_chi" && <button disabled={busy} onClick={() => startPay(c)} className="border border-emerald-600 text-emerald-700 rounded-lg px-3 min-h-11">Ghi đã chi</button>}
                  {c.trang_thai_quy === "chua_ghi" && <button disabled={busy} onClick={() => startPay(c)} className="border border-emerald-600 text-emerald-700 rounded-lg px-3 min-h-11">Ghi vào sổ quỹ</button>}
                  <button disabled={busy} onClick={() => startEdit(c)} className="border rounded-lg px-3 min-h-11 text-blue-600">Sửa</button>
                  <button disabled={busy} onClick={() => remove(c)} className="border rounded-lg px-3 min-h-11 text-red-600">Hủy</button>
                </div>
              )}
              {pay?.id === c.id && payQuy && (
                <form onSubmit={ghiQuy} className="rounded-lg bg-slate-50 border p-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={lbl}>Chi từ quỹ</span>
                    <select className={inp} value={pay.hinh} onChange={(e) => setPay({ ...pay, hinh: e.target.value as "tien_mat" | "chuyen_khoan" })}>
                      <option value="tien_mat">Tiền mặt (quỹ Tiền mặt)</option>
                      <option value="chuyen_khoan">Chuyển khoản (quỹ Tài khoản)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={lbl}>Ngày chi</span>
                    <input type="date" className={inp} max={today()} value={pay.ngay} onChange={(e) => setPay({ ...pay, ngay: e.target.value })} />
                  </label>
                  {payDu !== undefined && <p className="sm:col-span-2 text-xs text-slate-500">Quỹ {payQuy} đang có {money(payDu)}. Sẽ chi {money(c.amount)}.</p>}
                  {payVuot && <VuotBox msg={`Số chi ${money(c.amount)} lớn hơn số dư quỹ ${payQuy}${payDu !== undefined ? ` (${money(payDu)})` : ""}.`} ok={pay.ok} ly={pay.ly} onOk={(v) => setPay({ ...pay, ok: v })} onLy={(v) => setPay({ ...pay, ly: v })} />}
                  <div className="sm:col-span-2 flex flex-wrap gap-2">
                    <button disabled={busy} className="bg-emerald-600 text-white rounded-lg px-4 min-h-11 disabled:opacity-50">Ghi vào sổ quỹ</button>
                    <button type="button" onClick={() => setPay(null)} className="border rounded-lg px-4 min-h-11">Đóng</button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
        {costs.length === 0 && <li className="text-sm text-slate-500">Chưa có chi phí nào.</li>}
      </ul>

      <div className={`rounded-xl p-4 space-y-1 border ${profit < 0 ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-200"}`}>
        <div className="flex justify-between text-sm"><span>Doanh thu</span><span>{money(revenue)}</span></div>
        <div className="flex justify-between text-sm"><span>Giá vốn phụ tùng (theo giá nhập)</span><span>{money(partsCost)}</span></div>
        <div className="flex justify-between text-sm"><span>Tổng chi phí khác</span><span>{money(other)}</span></div>
        <div className={`flex justify-between text-lg font-bold ${profit < 0 ? "text-red-700" : "text-green-700"}`}>
          <span>Lợi nhuận của phiếu{profit < 0 ? " (LỖ)" : ""}</span><span>{money(profit)}</span>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-1">Nhật ký sửa chi phí</h3>
        {logs.length === 0 ? <p className="text-sm text-slate-500">Chưa có.</p> : (
          <ul className="space-y-2">
            {logs.map((l) => (
              <li key={l.id} className="border rounded-lg p-3 text-sm space-y-1">
                <div className="text-slate-500">{new Date(l.created_at).toLocaleString("vi-VN")} · {l.created_by_name ?? "Không rõ"}</div>
                <div>
                  <b className={l.action === "them" ? "text-green-700" : l.action === "xoa" || l.action === "huy" ? "text-red-600" : "text-blue-700"}>{l.action === "them" ? "Thêm" : l.action === "xoa" ? "Xóa" : l.action === "huy" ? "Hủy" : "Sửa"}</b>{" "}
                  <b>{l.content}</b> ({label(l.kind)})
                </div>
                <div>
                  {l.action === "them" && <>Số tiền: {money(l.amount_after ?? 0)}</>}
                  {(l.action === "xoa" || l.action === "huy") && <>Số tiền: {money(l.amount_before ?? 0)}</>}
                  {l.action === "sua" && <>Số tiền: {money(l.amount_before ?? 0)} → {money(l.amount_after ?? 0)}</>}
                </div>
                {l.detail && <div className="text-slate-600 break-words">{l.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
