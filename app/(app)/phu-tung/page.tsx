"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";
import { useRole } from "@/lib/role";

type Lech = { part_id: string; ten: string; ma: string | null; ton_hien_tai: number; tong_so: number; lech: number };

function Reconcile() {
  const [rows, setRows] = useState<Lech[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setErr("");
    const r = await supabase.rpc("doi_chieu_ton");
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    setRows(r.data as Lech[]);
  }
  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <b>Đối chiếu tồn kho</b>
        <button onClick={run} disabled={busy} className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50">{busy ? "Đang đối chiếu..." : "Đối chiếu ngay"}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows && (rows.length === 0 ? <p className="text-sm text-green-700">Khớp: tồn của mọi phụ tùng bằng tổng sổ kho.</p> : (
        <ul className="space-y-1">
          <li className="text-sm text-red-700">Có {rows.length} món lệch:</li>
          {rows.map((x) => (
            <li key={x.part_id} className="text-sm border rounded-lg p-2">
              <Link href={`/phu-tung/${x.part_id}`} className="text-blue-700 font-medium">{x.ten}{x.ma ? ` · ${x.ma}` : ""}</Link>
              <div className="text-slate-600">Tồn hiện tại {x.ton_hien_tai} · Tổng sổ kho {x.tong_so} · Lệch {x.lech > 0 ? "+" : ""}{x.lech}</div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

type Part = { id: string; name: string; code: string | null; cost_price?: number; sale_price: number; stock: number };
const empty = { name: "", code: "", cost_price: "", sale_price: "", stock: "" };

export default function PartsPage() {
  const isOwner = useRole() === "chu";
  const [list, setList] = useState<Part[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("parts").select("*").order("name");
    if (error) return setError(error.message);
    let rows = data as Part[];
    if (isOwner) {
      const c = await supabase.from("part_costs").select("part_id, cost_price");
      if (c.error) return setError(c.error.message);
      const m = new Map((c.data ?? []).map((x) => [x.part_id as string, Number(x.cost_price)]));
      rows = rows.map((p) => ({ ...p, cost_price: m.get(p.id) ?? 0 }));
    }
    setList(rows);
  }, [isOwner]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const row = {
      name: form.name.trim(), code: form.code.trim() || null,
      sale_price: Number(form.sale_price || 0),
    };
    const initQty = Number(form.stock || 0);
    const res = editId
      ? await supabase.from("parts").update(row).eq("id", editId).select("id").single()
      : await supabase.from("parts").insert({ ...row, stock: 0 }).select("id").single();
    if (res.error) return setError(res.error.code === "23505" ? "Mã phụ tùng đã tồn tại." : res.error.message);
    if (!editId && initQty > 0) {
      const t = await supabase.rpc("dat_ton_dau", { p_part: res.data.id, p_qty: initQty });
      if (t.error) return setError(t.error.message);
    }
    if (isOwner) {
      const c = await supabase.from("part_costs").upsert({ part_id: res.data.id, cost_price: Number(form.cost_price || 0) });
      if (c.error) return setError(c.error.message);
    }
    setForm(empty); setEditId(null); load();
  }
  function edit(p: Part) {
    setEditId(p.id);
    setForm({ name: p.name, code: p.code ?? "", cost_price: String(p.cost_price ?? 0), sale_price: String(p.sale_price), stock: String(p.stock) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function remove(p: Part) {
    if (!confirm(`Xóa phụ tùng "${p.name}"?`)) return;
    const { error } = await supabase.from("parts").delete().eq("id", p.id);
    if (error) setError(error.message); else load();
  }

  const shown = list.filter((p) => !q || `${p.name} ${p.code ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const input = "w-full border rounded-lg px-3 py-2";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Phụ tùng</h1>
      {isOwner && <Reconcile />}
      <form onSubmit={save} className="bg-white rounded-xl shadow p-4 grid gap-3 sm:grid-cols-2">
        <input required placeholder="Tên phụ tùng *" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Mã phụ tùng" className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        {isOwner && <input placeholder="Giá nhập (đ)" inputMode="numeric" className={input} value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: digits(e.target.value) })} />}
        <input placeholder="Giá bán (đ)" inputMode="numeric" className={input} value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: digits(e.target.value) })} />
        {editId
          ? <p className="text-sm text-slate-500 self-center">Tồn kho không sửa ở đây: dùng Nhập hàng hoặc Kiểm kê điều chỉnh (trong trang chi tiết).</p>
          : <input placeholder="Số lượng tồn đầu" inputMode="numeric" className={input} value={form.stock} onChange={(e) => setForm({ ...form, stock: digits(e.target.value) })} />}
        <div className="flex gap-2">
          <button className="bg-green-600 text-white rounded-lg px-4 py-2">{editId ? "Lưu thay đổi" : "Thêm phụ tùng"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="border rounded-lg px-4 py-2">Hủy</button>}
        </div>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <input placeholder="Tìm theo tên hoặc mã..." className={input} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-2">
        {shown.map((p) => (
          <li key={p.id} className="bg-white rounded-xl shadow p-3 space-y-1">
            <div className="flex justify-between gap-2">
              <Link href={`/phu-tung/${p.id}`} className="font-medium text-blue-700">{p.name}{p.code ? <span className="text-slate-500 font-normal"> · {p.code}</span> : null}</Link>
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${p.stock > 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>Tồn: {p.stock}</span>
            </div>
            <div className="text-sm text-slate-500">{isOwner ? `Nhập ${money(p.cost_price ?? 0)} · ` : ""}Bán {money(p.sale_price)}</div>
            <div className="flex gap-4 text-sm">
              <Link href={`/phu-tung/${p.id}`} className="text-blue-600">Lịch sử</Link>
              <button onClick={() => edit(p)} className="text-blue-600">Sửa</button>
              <button onClick={() => remove(p)} className="text-red-600">Xóa</button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="text-slate-500 text-sm">Chưa có phụ tùng.</li>}
      </ul>
    </div>
  );
}
