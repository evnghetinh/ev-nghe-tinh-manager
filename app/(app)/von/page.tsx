"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";
import { useRole } from "@/lib/role";

type Setup = { id: string; spent_on: string; category: string; amount: number; paid_by: string | null; note: string | null };
type Contrib = { id: string; contributor: string; amount: number; contributed_on: string; note: string | null };
type Op = { id: string; month: string; kind: string; amount: number; note: string | null };
type Prior = { id: string; month: string; amount: number; note: string | null };
// Mỗi dòng = một tháng: doanh thu SAU giảm giá, TRƯỚC thuế (hàm bao_cao_phieu, giai đoạn 31)
type Paid = { ky: string; doanh_thu: number; gia_von: number; chi_tat_ca: number };

const CATS = ["Thiết bị", "Sửa mặt bằng", "Đặt cọc", "Hàng tồn ban đầu", "Biển hiệu", "Khác"];
const KINDS: Record<string, string> = { thue_mat_bang: "Thuê mặt bằng", dien_nuoc: "Điện nước", luong: "Lương", internet: "Internet", khac: "Khoản khác" };
const today = () => new Date().toLocaleDateString("sv-SE");
const monthOf = (d: string) => d.slice(0, 7);
const addMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fmtMonth = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const fmtDate = (d: string) => d.split("-").reverse().join("/");
const num = (s: string) => Number(digits(s) || 0);
const inp = "border px-3 py-2 w-full bg-white";
const btn = "px-4 font-medium";

type Huy = { id: string; da_huy: boolean; huy_ly_do: string | null; huy_boi_ten: string | null; huy_luc: string | null; created_by_name: string | null; created_at: string };

function useRows<T>(table: string, order: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [huy, setHuy] = useState<(T & Huy)[]>([]);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const r = await supabase.from(table).select("*").order(order, { ascending: false }).order("created_at", { ascending: false });
    if (r.error) setError(`Không đọc được dữ liệu (đã chạy giai-doan-11.sql chưa?): ${r.error.message}`);
    else {
      setError("");
      const all = r.data as (T & Huy)[];
      setRows(all.filter((x) => !x.da_huy));
      setHuy(all.filter((x) => x.da_huy));
    }
  }, [table, order]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { rows, huy, error, reload };
}

// Không xóa cứng: "Hủy" bắt buộc có lý do, dòng được giữ lại và đánh dấu đã hủy
async function huyVon(bang: string, id: string, setErr: (s: string) => void): Promise<boolean> {
  const ly = window.prompt("Lý do hủy (bắt buộc):");
  if (ly === null) return false;
  if (!ly.trim()) { setErr("Bắt buộc nhập lý do hủy."); return false; }
  return run(supabase.rpc("von_huy", { p_bang: bang, p_id: id, p_ly_do: ly.trim() }), setErr);
}

function DaHuy({ rows, label }: { rows: Huy[]; label: (r: Huy) => string }) {
  if (rows.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-500 min-h-11 flex items-center">Đã hủy ({rows.length}) · không tính vào số liệu</summary>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="py-2 text-slate-500">
            <div className="line-through">{label(r)}</div>
            <div className="text-xs">Hủy bởi {r.huy_boi_ten ?? "Không rõ"} lúc {r.huy_luc ? new Date(r.huy_luc).toLocaleString("vi-VN") : ""} · Lý do: {r.huy_ly_do}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input inputMode="numeric" className={inp} placeholder={placeholder ?? "Số tiền (đ)"} value={value ? new Intl.NumberFormat("vi-VN").format(Number(value)) : ""} onChange={(e) => onChange(digits(e.target.value))} />;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className="card space-y-3">{title && <h2 className="font-semibold text-navy-900">{title}</h2>}{children}</div>;
}

function Msg({ error }: { error: string }) {
  return <Toast text={error} />;
}

async function run(p: PromiseLike<{ error: { message: string } | null }>, setError: (s: string) => void) {
  const r = await p;
  if (r.error) { setError(r.error.message); return false; }
  setError(""); return true;
}

/* ---------- 1. Chi phí mở xưởng ---------- */
function SetupSection({ rows, huy, reload, error }: { rows: Setup[]; huy: (Setup & Huy)[]; reload: () => void; error: string }) {
  const empty = { id: "", spent_on: today(), category: CATS[0], custom: "", amount: "", paid_by: "", note: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");
  const total = rows.reduce((s, r) => s + r.amount, 0);

  async function save() {
    const category = f.category === "Khác" && f.custom.trim() ? f.custom.trim() : f.category;
    if (!f.amount || num(f.amount) <= 0) return setErr("Hãy nhập số tiền.");
    const row = { spent_on: f.spent_on, category, amount: num(f.amount), paid_by: f.paid_by.trim() || null, note: f.note.trim() || null };
    const q = f.id ? supabase.from("von_chi_phi_mo_xuong").update(row).eq("id", f.id) : supabase.from("von_chi_phi_mo_xuong").insert(row);
    if (await run(q, setErr)) { setF(empty); reload(); }
  }
  async function del(r: Setup) {
    if (await huyVon("von_chi_phi_mo_xuong", r.id, setErr)) reload();
  }
  function edit(r: Setup) {
    const known = CATS.includes(r.category);
    setF({ id: r.id, spent_on: r.spent_on, category: known ? r.category : "Khác", custom: known ? "" : r.category, amount: String(r.amount), paid_by: r.paid_by ?? "", note: r.note ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <div className="space-y-4">
      <Card title={f.id ? "Sửa khoản chi" : "Thêm khoản chi mở xưởng"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input type="date" className={inp} value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} />
          <select className={inp} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          {f.category === "Khác" && <input className={inp} placeholder="Tên hạng mục khác" value={f.custom} onChange={(e) => setF({ ...f, custom: e.target.value })} />}
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          <input className={inp} placeholder="Người chi" value={f.paid_by} onChange={(e) => setF({ ...f, paid_by: e.target.value })} />
          <input className={inp} placeholder="Ghi chú" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <Msg error={err || error} />
        <div className="flex gap-2">
          <button onClick={save} className={`${btn} btn-primary`}>{f.id ? "Lưu thay đổi" : "Thêm"}</button>
          {f.id && <button onClick={() => { setF(empty); setErr(""); }} className={`${btn} btn-secondary`}>Hủy</button>}
        </div>
      </Card>
      <Card>
        <div className="flex justify-between font-bold text-lg"><span>Tổng chi phí mở xưởng</span><span className="text-green-700">{money(total)}</span></div>
        {rows.length === 0 ? <EmptyState icon={<Icon name="wallet" />} text="Chưa có khoản nào." /> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="py-2 flex gap-2 items-start">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.category} <span className="font-normal text-slate-500 text-sm">· {fmtDate(r.spent_on)}</span></div>
                  <div className="text-sm text-slate-500">{[r.paid_by && `Người chi: ${r.paid_by}`, r.note].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right"><div className="font-medium">{money(r.amount)}</div>
                  <button onClick={() => edit(r)} className="bare text-sm text-green-700 px-2 min-h-11">Sửa</button>
                  <button onClick={() => del(r)} className="bare text-sm text-red-600 px-2 min-h-11">Hủy</button></div>
              </li>
            ))}
          </ul>
        )}
        <DaHuy rows={huy} label={(r) => { const x = r as unknown as Setup; return `${x.category} · ${fmtDate(x.spent_on)} · ${money(x.amount)}`; }} />
      </Card>
    </div>
  );
}

/* ---------- 2. Vốn góp ---------- */
function ContribSection({ rows, huy, reload, error, setupTotal }: { rows: Contrib[]; huy: (Contrib & Huy)[]; reload: () => void; error: string; setupTotal: number }) {
  const empty = { id: "", contributor: "", amount: "", contributed_on: today(), note: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const diff = total - setupTotal;

  async function save() {
    if (!f.contributor.trim()) return setErr("Hãy nhập tên người góp.");
    if (num(f.amount) <= 0) return setErr("Hãy nhập số tiền lớn hơn 0.");
    const row = { contributor: f.contributor.trim(), amount: num(f.amount), contributed_on: f.contributed_on, note: f.note.trim() || null };
    const q = f.id ? supabase.from("von_gop").update(row).eq("id", f.id) : supabase.from("von_gop").insert(row);
    if (await run(q, setErr)) { setF(empty); reload(); }
  }
  async function del(r: Contrib) {
    if (await huyVon("von_gop", r.id, setErr)) reload();
  }
  return (
    <div className="space-y-4">
      <Card title={f.id ? "Sửa khoản góp" : "Thêm khoản vốn góp"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={inp} placeholder="Tên người góp" value={f.contributor} onChange={(e) => setF({ ...f, contributor: e.target.value })} />
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          <input type="date" className={inp} value={f.contributed_on} onChange={(e) => setF({ ...f, contributed_on: e.target.value })} />
          <input className={inp} placeholder="Ghi chú" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <Msg error={err || error} />
        <div className="flex gap-2">
          <button onClick={save} className={`${btn} btn-primary`}>{f.id ? "Lưu thay đổi" : "Thêm"}</button>
          {f.id && <button onClick={() => { setF(empty); setErr(""); }} className={`${btn} btn-secondary`}>Hủy</button>}
        </div>
      </Card>
      <Card>
        <div className="flex justify-between font-bold text-lg"><span>Tổng vốn góp</span><span className="text-green-700">{money(total)}</span></div>
        <div className="flex justify-between text-sm"><span>Tổng chi phí mở xưởng</span><span>{money(setupTotal)}</span></div>
        <div className={`rounded-xl p-3 text-sm font-medium ${diff < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>
          {diff === 0 ? "Vốn góp vừa đủ so với chi phí mở xưởng." : diff > 0 ? `Vốn góp DƯ ${money(diff)} so với chi phí mở xưởng.` : `Vốn góp THIẾU ${money(-diff)} so với chi phí mở xưởng.`}
        </div>
        {rows.length === 0 ? <EmptyState icon={<Icon name="users" />} text="Chưa có người góp." /> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="py-2 flex gap-2 items-start">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.contributor} <span className="text-green-700 text-sm">{total ? ((r.amount / total) * 100).toFixed(1) : 0}%</span></div>
                  <div className="text-sm text-slate-500">{[fmtDate(r.contributed_on), r.note].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right"><div className="font-medium">{money(r.amount)}</div>
                  <button onClick={() => setF({ id: r.id, contributor: r.contributor, amount: String(r.amount), contributed_on: r.contributed_on, note: r.note ?? "" })} className="bare text-sm text-green-700 px-2 min-h-11">Sửa</button>
                  <button onClick={() => del(r)} className="bare text-sm text-red-600 px-2 min-h-11">Hủy</button></div>
              </li>
            ))}
          </ul>
        )}
        <DaHuy rows={huy} label={(r) => { const x = r as unknown as Contrib; return `${x.contributor} · ${fmtDate(x.contributed_on)} · ${money(x.amount)}`; }} />
      </Card>
    </div>
  );
}

/* ---------- 3. Chi phí vận hành ---------- */
function OpSection({ rows, huy, reload, error }: { rows: Op[]; huy: (Op & Huy)[]; reload: () => void; error: string }) {
  const [month, setMonth] = useState(monthOf(today()));
  const empty = { id: "", kind: "thue_mat_bang", amount: "", note: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");
  const cur = rows.filter((r) => monthOf(r.month) === month);
  const prev = rows.filter((r) => monthOf(r.month) === addMonth(month, -1));
  const total = cur.reduce((s, r) => s + r.amount, 0);

  async function save() {
    if (!f.amount) return setErr("Hãy nhập số tiền.");
    const row = { month: month + "-01", kind: f.kind, amount: num(f.amount), note: f.note.trim() || null };
    const q = f.id ? supabase.from("von_chi_phi_van_hanh").update(row).eq("id", f.id) : supabase.from("von_chi_phi_van_hanh").insert(row);
    if (await run(q, setErr)) { setF(empty); reload(); }
  }
  async function del(r: Op) {
    if (await huyVon("von_chi_phi_van_hanh", r.id, setErr)) reload();
  }
  async function copyPrev() {
    if (prev.length === 0) return setErr(`Tháng ${fmtMonth(addMonth(month, -1))} chưa có khoản nào để sao chép.`);
    if (cur.length > 0 && !confirm(`Tháng ${fmtMonth(month)} đã có ${cur.length} khoản. Vẫn sao chép thêm từ tháng trước (có thể bị trùng)?`)) return;
    const ins = prev.map((r) => ({ month: month + "-01", kind: r.kind, amount: r.amount, note: r.note }));
    if (await run(supabase.from("von_chi_phi_van_hanh").insert(ins), setErr)) reload();
  }
  return (
    <div className="space-y-4">
      <Card title="Chi phí vận hành theo tháng">
        <div className="flex gap-2 items-center">
          <button onClick={() => setMonth(addMonth(month, -1))} className={`${btn} btn-secondary`}>‹</button>
          <input type="month" className={inp} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button onClick={() => setMonth(addMonth(month, 1))} className={`${btn} btn-secondary`}>›</button>
        </div>
        <button onClick={copyPrev} className={`${btn} btn-secondary w-full`}>Sao chép từ tháng {fmtMonth(addMonth(month, -1))}</button>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select className={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          <input className={inp} placeholder="Ghi chú (vd tên khoản khác)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <Msg error={err || error} />
        <div className="flex gap-2">
          <button onClick={save} className={`${btn} btn-primary`}>{f.id ? "Lưu thay đổi" : "Thêm"}</button>
          {f.id && <button onClick={() => { setF(empty); setErr(""); }} className={`${btn} btn-secondary`}>Hủy</button>}
        </div>
      </Card>
      <Card>
        <div className="flex justify-between font-bold text-lg"><span>Tổng tháng {fmtMonth(month)}</span><span className="text-green-700">{money(total)}</span></div>
        {cur.length === 0 ? <EmptyState icon={<Icon name="wallet" />} text="Tháng này chưa có khoản nào." /> : (
          <ul className="divide-y">
            {cur.map((r) => (
              <li key={r.id} className="py-2 flex gap-2 items-start">
                <div className="flex-1 min-w-0"><div className="font-medium">{KINDS[r.kind]}</div>{r.note && <div className="text-sm text-slate-500">{r.note}</div>}</div>
                <div className="text-right"><div className="font-medium">{money(r.amount)}</div>
                  <button onClick={() => setF({ id: r.id, kind: r.kind, amount: String(r.amount), note: r.note ?? "" })} className="bare text-sm text-green-700 px-2 min-h-11">Sửa</button>
                  <button onClick={() => del(r)} className="bare text-sm text-red-600 px-2 min-h-11">Hủy</button></div>
              </li>
            ))}
          </ul>
        )}
        <DaHuy rows={huy.filter((r) => monthOf(r.month) === month)} label={(r) => { const x = r as unknown as Op; return `${KINDS[x.kind]} · ${money(x.amount)}`; }} />
      </Card>
    </div>
  );
}

/* ---------- 4. Báo cáo thu hồi vốn ---------- */
function ReportSection({ setup, contribs, ops, priors, priorsHuy, reloadPriors, priorError }: { setup: Setup[]; contribs: Contrib[]; ops: Op[]; priors: Prior[]; priorsHuy: (Prior & Huy)[]; reloadPriors: () => void; priorError: string }) {
  const [start, setStart] = useState<string | null>(null);
  const [orders, setOrders] = useState<Paid[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const empty = { id: "", month: monthOf(today()), amount: "", neg: false, note: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const s = await supabase.from("von_cai_dat").select("start_date").maybeSingle();
      if (s.error) { setError(`Không đọc được cài đặt (đã chạy giai-doan-11.sql chưa?): ${s.error.message}`); setLoading(false); return; }
      setStart(s.data?.start_date ?? today().slice(0, 8) + "01");
    })();
  }, []);

  useEffect(() => {
    if (!start) return;
    (async () => {
      setLoading(true);
      const r = await supabase.rpc("bao_cao_phieu", { p_tu: start, p_den: today(), p_nhom: "thang" });
      if (r.error) setError(r.error.message + " (đã chạy giai-doan-31.sql chưa?)");
      setOrders(((r.data ?? []) as Paid[]).map((x) => ({ ...x, doanh_thu: Number(x.doanh_thu), gia_von: Number(x.gia_von), chi_tat_ca: Number(x.chi_tat_ca) })));
      setLoading(false);
    })();
  }, [start]);

  async function saveStart(v: string) {
    if (!v) return;
    setStart(v);
    await run(supabase.from("von_cai_dat").upsert({ id: true, start_date: v }), setError);
  }

  const invest = setup.reduce((s, r) => s + r.amount, 0);
  const startM = start ? monthOf(start) : "";
  const nowM = monthOf(today());

  const months = useMemo(() => {
    if (!startM) return [];
    const orderP: Record<string, number> = {}, prior: Record<string, number> = {}, op: Record<string, number> = {};
    for (const o of orders) {
      const m = monthOf(o.ky);
      orderP[m] = (orderP[m] ?? 0) + o.doanh_thu - o.gia_von - o.chi_tat_ca;
    }
    for (const p of priors) if (monthOf(p.month) >= startM) prior[monthOf(p.month)] = (prior[monthOf(p.month)] ?? 0) + p.amount;
    for (const c of ops) if (monthOf(c.month) >= startM) op[monthOf(c.month)] = (op[monthOf(c.month)] ?? 0) + c.amount;
    const keys = new Set<string>([...Object.keys(prior), ...Object.keys(op)]);
    for (let m = startM; m <= nowM; m = addMonth(m, 1)) keys.add(m);
    return [...keys].sort().map((m) => ({ m, order: orderP[m] ?? 0, prior: prior[m] ?? 0, op: op[m] ?? 0, net: (orderP[m] ?? 0) + (prior[m] ?? 0) - (op[m] ?? 0) }));
  }, [orders, priors, ops, startM, nowM]);

  const cum = months.reduce((s, r) => s + r.net, 0);
  const pct = invest > 0 ? (cum / invest) * 100 : 0;
  const remain = Math.max(invest - cum, 0);
  const recent = months.filter((r) => r.m < nowM).slice(-3);
  const avg = recent.length ? recent.reduce((s, r) => s + r.net, 0) / recent.length : null;
  const estimate = remain === 0 && invest > 0 ? "Đã thu hồi đủ vốn." : avg === null ? "Chưa đủ dữ liệu (cần ít nhất 1 tháng đã kết thúc)." : avg <= 0 ? "Không ước tính được vì lợi nhuận trung bình gần đây không dương." : `Khoảng ${Math.ceil(remain / avg)} tháng nữa (ước tính theo lợi nhuận trung bình ${recent.length} tháng gần nhất: ${money(Math.round(avg))}/tháng).`;
  const contribTotal = contribs.reduce((s, r) => s + r.amount, 0);
  const byPerson = new Map<string, number>();
  contribs.forEach((c) => byPerson.set(c.contributor.trim(), (byPerson.get(c.contributor.trim()) ?? 0) + c.amount));

  async function savePrior() {
    if (!f.amount) return setErr("Hãy nhập số tiền lợi nhuận.");
    const row = { month: f.month + "-01", amount: (f.neg ? -1 : 1) * num(f.amount), note: f.note.trim() || null };
    const q = f.id ? supabase.from("von_loi_nhuan_cu").update(row).eq("id", f.id) : supabase.from("von_loi_nhuan_cu").insert(row);
    if (await run(q, setErr)) { setF(empty); reloadPriors(); }
  }
  async function delPrior(p: Prior) {
    if (await huyVon("von_loi_nhuan_cu", p.id, setErr)) reloadPriors();
  }

  function exportXlsx() {
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: (string | number)[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    add("Tổng hợp", [
      ["Ngày bắt đầu tính", start ? fmtDate(start) : ""], ["Tổng vốn đầu tư", invest], ["Lợi nhuận lũy kế", cum],
      ["Đã thu hồi (%)", Number(pct.toFixed(1))], ["Số tiền còn lại", remain], ["Ước tính thời gian còn lại", estimate], [],
      ["Chia lợi nhuận lũy kế theo vốn", "Vốn góp", "Tỷ lệ %", "Lợi nhuận được chia"],
      ...[...byPerson].map(([n, a]) => [n, a, contribTotal ? Number(((a / contribTotal) * 100).toFixed(1)) : 0, Math.round(contribTotal ? (cum * a) / contribTotal : 0)]),
    ]);
    add("Chi phí mở xưởng", [["Ngày", "Hạng mục", "Số tiền", "Người chi", "Ghi chú"], ...setup.map((r) => [fmtDate(r.spent_on), r.category, r.amount, r.paid_by ?? "", r.note ?? ""]), ["Tổng", "", invest]]);
    add("Vốn góp", [["Người góp", "Số tiền", "Tỷ lệ %", "Ngày", "Ghi chú"], ...contribs.map((r) => [r.contributor, r.amount, contribTotal ? Number(((r.amount / contribTotal) * 100).toFixed(1)) : 0, fmtDate(r.contributed_on), r.note ?? ""]), ["Tổng", contribTotal]]);
    add("Chi phí vận hành", [["Tháng", "Khoản", "Số tiền", "Ghi chú"], ...[...ops].sort((a, b) => a.month.localeCompare(b.month)).map((r) => [fmtMonth(monthOf(r.month)), KINDS[r.kind], r.amount, r.note ?? ""])]);
    add("Lợi nhuận theo tháng", [["Tháng", "Lợi nhuận phiếu", "Nhập tay", "Chi phí vận hành", "Lợi nhuận ròng"], ...months.map((r) => [fmtMonth(r.m), r.order, r.prior, r.op, r.net])]);
    XLSX.writeFile(wb, `thu-hoi-von-${today()}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <Card title="Báo cáo thu hồi vốn">
        <label className="block text-sm text-slate-600">Tính từ ngày
          <input type="date" className={`${inp} mt-1`} value={start ?? ""} onChange={(e) => saveStart(e.target.value)} />
        </label>
        <Msg error={error} />
        {loading ? <LoadingBlock rows={2} /> : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Tổng vốn đầu tư" value={money(invest)} />
              <Stat label="Lợi nhuận lũy kế" value={money(cum)} bad={cum < 0} />
              <Stat label="Đã thu hồi" value={`${pct.toFixed(1)}%`} bad={pct < 0} />
              <Stat label="Còn lại" value={money(remain)} />
            </div>
            <div>
              <div className="h-4 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-green-600" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} /></div>
              <div className="text-xs text-slate-500 mt-1">{invest === 0 ? "Chưa nhập chi phí mở xưởng." : `${money(Math.max(cum, 0))} / ${money(invest)}`}</div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm"><b>Ước tính:</b> {estimate}</div>
            <button onClick={exportXlsx} className={`${btn} btn-secondary w-full`}>Xuất Excel</button>
          </>
        )}
      </Card>

      {!loading && (
        <Card title="Lợi nhuận theo từng tháng">
          <p className="text-xs text-slate-500">Lợi nhuận ròng = lợi nhuận phiếu (tính theo ngày thu tiền) + nhập tay − chi phí vận hành.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="text-slate-500 text-right"><th className="text-left font-normal">Tháng</th><th className="font-normal px-2">Phiếu</th><th className="font-normal px-2">Nhập tay</th><th className="font-normal px-2">Vận hành</th><th className="font-normal">Ròng</th></tr></thead>
              <tbody className="divide-y">
                {months.map((r) => (
                  <tr key={r.m} className="text-right"><td className="text-left py-2">{fmtMonth(r.m)}</td><td className="px-2">{money(r.order)}</td><td className="px-2">{money(r.prior)}</td><td className="px-2">{money(r.op)}</td>
                    <td className={`font-medium ${r.net < 0 ? "text-red-700" : "text-green-700"}`}>{money(r.net)}</td></tr>
                ))}
                <tr className="text-right font-bold"><td className="text-left py-2">Cộng</td><td className="px-2">{money(months.reduce((s, r) => s + r.order, 0))}</td><td className="px-2">{money(months.reduce((s, r) => s + r.prior, 0))}</td><td className="px-2">{money(months.reduce((s, r) => s + r.op, 0))}</td><td className={cum < 0 ? "text-red-700" : "text-green-700"}>{money(cum)}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && (
        <Card title="Chia lợi nhuận lũy kế theo tỷ lệ vốn">
          {byPerson.size === 0 ? <EmptyState icon={<Icon name="users" />} text="Chưa có người góp vốn." /> : (
            <ul className="divide-y">
              {[...byPerson].map(([n, a]) => (
                <li key={n} className="py-2 flex justify-between gap-2 text-sm">
                  <span>{n} <span className="text-slate-500">({contribTotal ? ((a / contribTotal) * 100).toFixed(1) : 0}% · góp {money(a)})</span></span>
                  <span className={`font-medium ${cum < 0 ? "text-red-700" : "text-green-700"}`}>{money(Math.round(contribTotal ? (cum * a) / contribTotal : 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Lợi nhuận các tháng trước khi dùng app (nhập tay)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input type="month" className={inp} value={f.month} onChange={(e) => e.target.value && setF({ ...f, month: e.target.value })} />
          <div className="flex gap-2">
            <select className="border px-2 bg-white" value={f.neg ? "-" : "+"} onChange={(e) => setF({ ...f, neg: e.target.value === "-" })}><option value="+">Lãi</option><option value="-">Lỗ</option></select>
            <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </div>
          <input className={`${inp} sm:col-span-2`} placeholder="Ghi chú" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <Msg error={err || priorError} />
        <div className="flex gap-2">
          <button onClick={savePrior} className={`${btn} btn-primary`}>{f.id ? "Lưu thay đổi" : "Thêm"}</button>
          {f.id && <button onClick={() => { setF(empty); setErr(""); }} className={`${btn} btn-secondary`}>Hủy</button>}
        </div>
        <p className="text-xs text-slate-500">Chỉ các tháng từ ngày bắt đầu tính trở đi mới được cộng vào báo cáo.</p>
        {priors.length > 0 && (
          <ul className="divide-y">
            {priors.map((p) => (
              <li key={p.id} className="py-2 flex gap-2 items-start">
                <div className="flex-1 min-w-0"><div className="font-medium">Tháng {fmtMonth(monthOf(p.month))}</div>{p.note && <div className="text-sm text-slate-500">{p.note}</div>}</div>
                <div className="text-right"><div className={`font-medium ${p.amount < 0 ? "text-red-700" : ""}`}>{money(p.amount)}</div>
                  <button onClick={() => setF({ id: p.id, month: monthOf(p.month), amount: String(Math.abs(p.amount)), neg: p.amount < 0, note: p.note ?? "" })} className="bare text-sm text-green-700 px-2 min-h-11">Sửa</button>
                  <button onClick={() => delPrior(p)} className="bare text-sm text-red-600 px-2 min-h-11">Hủy</button></div>
              </li>
            ))}
          </ul>
        )}
        <DaHuy rows={priorsHuy} label={(r) => { const x = r as unknown as Prior; return `Tháng ${fmtMonth(monthOf(x.month))} · ${money(x.amount)}`; }} />
      </Card>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return <div className="bg-green-50 rounded-xl p-3"><div className={`text-lg font-bold ${bad ? "text-red-700" : "text-green-700"}`}>{value}</div><div className="text-xs text-slate-500">{label}</div></div>;
}

const TABS = ["Chi phí mở xưởng", "Vốn góp", "Vận hành hàng tháng", "Thu hồi vốn"];

export default function VonPage() {
  const role = useRole();
  const [tab, setTab] = useState(3);
  const setup = useRows<Setup>("von_chi_phi_mo_xuong", "spent_on");
  const contrib = useRows<Contrib>("von_gop", "contributed_on");
  const ops = useRows<Op>("von_chi_phi_van_hanh", "month");
  const priors = useRows<Prior>("von_loi_nhuan_cu", "month");

  if (role !== "chu") return <EmptyState icon={<Icon name="alert" />} text="Bạn không có quyền xem trang này." />;
  const setupTotal = setup.rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="wallet" />} title="Vốn và thu hồi vốn" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-green-100 p-1 rounded-xl">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`bare rounded-xl min-h-11 text-sm ${tab === i ? "bg-white font-semibold text-green-800 shadow" : "text-slate-600"}`}>{t}</button>
        ))}
      </div>
      {tab === 0 && <SetupSection rows={setup.rows} huy={setup.huy} reload={setup.reload} error={setup.error} />}
      {tab === 1 && <ContribSection rows={contrib.rows} huy={contrib.huy} reload={contrib.reload} error={contrib.error} setupTotal={setupTotal} />}
      {tab === 2 && <OpSection rows={ops.rows} huy={ops.huy} reload={ops.reload} error={ops.error} />}
      {tab === 3 && <ReportSection setup={setup.rows} contribs={contrib.rows} ops={ops.rows} priors={priors.rows} priorsHuy={priors.huy} reloadPriors={priors.reload} priorError={priors.error} />}
    </div>
  );
}
