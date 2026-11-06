"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";

type Part = { id: string; name: string; code: string | null; cost_price: number; sale_price: number; stock: number };
const empty = { name: "", code: "", cost_price: "", sale_price: "", stock: "" };

export default function PartsPage() {
  const [list, setList] = useState<Part[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("parts").select("*").order("name");
    if (error) setError(error.message); else setList(data as Part[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const row = {
      name: form.name.trim(), code: form.code.trim() || null,
      cost_price: Number(form.cost_price || 0), sale_price: Number(form.sale_price || 0),
      stock: Number(form.stock || 0),
    };
    const { error } = editId
      ? await supabase.from("parts").update(row).eq("id", editId)
      : await supabase.from("parts").insert(row);
    if (error) return setError(error.code === "23505" ? "Mã phụ tùng đã tồn tại." : error.message);
    setForm(empty); setEditId(null); load();
  }
  function edit(p: Part) {
    setEditId(p.id);
    setForm({ name: p.name, code: p.code ?? "", cost_price: String(p.cost_price), sale_price: String(p.sale_price), stock: String(p.stock) });
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
      <form onSubmit={save} className="bg-white rounded-xl shadow p-4 grid gap-3 sm:grid-cols-2">
        <input required placeholder="Tên phụ tùng *" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Mã phụ tùng" className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input placeholder="Giá nhập (đ)" inputMode="numeric" className={input} value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: digits(e.target.value) })} />
        <input placeholder="Giá bán (đ)" inputMode="numeric" className={input} value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: digits(e.target.value) })} />
        <input placeholder="Số lượng tồn" inputMode="numeric" className={input} value={form.stock} onChange={(e) => setForm({ ...form, stock: digits(e.target.value) })} />
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
              <div className="font-medium">{p.name}{p.code ? <span className="text-slate-500 font-normal"> · {p.code}</span> : null}</div>
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${p.stock > 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>Tồn: {p.stock}</span>
            </div>
            <div className="text-sm text-slate-500">Nhập {money(p.cost_price)} · Bán {money(p.sale_price)}</div>
            <div className="flex gap-4 text-sm">
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
