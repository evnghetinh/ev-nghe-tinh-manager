"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";

type Cost = { id: string; kind: Kind; content: string; amount: number; note: string | null };
type Log = { id: string; action: "them" | "sua" | "xoa"; kind: Kind; content: string; amount_before: number | null; amount_after: number | null; note: string | null; detail: string | null; created_by_name: string | null; created_at: string };
type Kind = "vat_tu" | "thue_ngoai" | "khac";
const KINDS: { v: Kind; label: string }[] = [{ v: "vat_tu", label: "Vật tư tiêu hao" }, { v: "thue_ngoai", label: "Thuê ngoài" }, { v: "khac", label: "Khác" }];
const label = (k: string) => KINDS.find((x) => x.v === k)?.label ?? k;
const empty = { kind: "vat_tu" as Kind, content: "", amount: "", note: "" };

export default function Costs({ orderId, revenue, partsCost }: { orderId: string; revenue: number; partsCost: number }) {
  const [costs, setCosts] = useState<Cost[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const c = await supabase.from("repair_costs").select("id, kind, content, amount, note").eq("order_id", orderId).order("created_at");
    const l = await supabase.from("repair_cost_logs").select("id, action, kind, content, amount_before, amount_after, note, detail, created_by_name, created_at").eq("order_id", orderId).order("created_at", { ascending: false });
    if (c.error) setError(c.error.message + " (đã chạy giai-doan-10.sql chưa?)");
    if (c.data) setCosts(c.data as Cost[]);
    if (l.data) setLogs(l.data as Log[]);
  }, [orderId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amount = Number(form.amount || 0);
    setBusy(true);
    const r = editId
      ? await supabase.rpc("chi_phi_sua", { p_id: editId, p_kind: form.kind, p_content: form.content, p_amount: amount, p_note: form.note })
      : await supabase.rpc("chi_phi_them", { p_order: orderId, p_kind: form.kind, p_content: form.content, p_amount: amount, p_note: form.note });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setForm(empty); setEditId(null); load();
  }
  async function remove(c: Cost) {
    if (!confirm(`Xóa chi phí "${c.content}" (${money(c.amount)})?`)) return;
    setError(""); setBusy(true);
    const r = await supabase.rpc("chi_phi_xoa", { p_id: c.id });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    if (editId === c.id) { setForm(empty); setEditId(null); }
    load();
  }
  function startEdit(c: Cost) {
    setEditId(c.id);
    setForm({ kind: c.kind, content: c.content, amount: String(c.amount), note: c.note ?? "" });
  }

  const other = costs.reduce((s, c) => s + c.amount, 0);
  const profit = revenue - partsCost - other;
  const input = "w-full border rounded-lg px-3 py-2";

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-3 border-l-4 border-amber-500">
      <div>
        <h2 className="font-bold">Chi phí của phiếu</h2>
        <p className="text-xs text-slate-500">Chỉ Chủ xưởng thấy. Đây là tiền gara bỏ ra, không in lên phiếu báo giá của khách.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
        <input required placeholder="Nội dung (vd: hàn tấm pin) *" className={input} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        <input required placeholder="Số tiền (đ) *" inputMode="numeric" className={input} value={form.amount} onChange={(e) => setForm({ ...form, amount: digits(e.target.value) })} />
        <input placeholder="Ghi chú" className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <div className="sm:col-span-2 flex gap-2">
          <button disabled={busy} className="bg-amber-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{editId ? "Lưu sửa" : "Thêm chi phí"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="border rounded-lg px-4 py-2">Hủy sửa</button>}
        </div>
      </form>

      <ul className="space-y-2">
        {costs.map((c) => (
          <li key={c.id} className="border rounded-lg p-3 flex justify-between gap-2 items-start">
            <div className="text-sm min-w-0">
              <div className="font-medium break-words">{c.content} <span className="text-xs text-slate-500">({label(c.kind)})</span></div>
              {c.note && <div className="text-slate-500 break-words">{c.note}</div>}
            </div>
            <div className="text-right shrink-0 text-sm">
              <div className="font-medium">{money(c.amount)}</div>
              <button disabled={busy} onClick={() => startEdit(c)} className="text-blue-600 mr-3">Sửa</button>
              <button disabled={busy} onClick={() => remove(c)} className="text-red-600">Xóa</button>
            </div>
          </li>
        ))}
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
                  <b className={l.action === "them" ? "text-green-700" : l.action === "xoa" ? "text-red-600" : "text-blue-700"}>{l.action === "them" ? "Thêm" : l.action === "xoa" ? "Xóa" : "Sửa"}</b>{" "}
                  <b>{l.content}</b> ({label(l.kind)})
                </div>
                <div>
                  {l.action === "them" && <>Số tiền: {money(l.amount_after ?? 0)}</>}
                  {l.action === "xoa" && <>Số tiền: {money(l.amount_before ?? 0)}</>}
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
