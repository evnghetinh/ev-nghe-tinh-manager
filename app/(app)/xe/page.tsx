"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";

type Vehicle = { id: string; customer_id: string; plate: string; vin: string | null; vehicle_type: string; model: string | null; customers: { name: string; phone: string | null } | null };
type Cust = { id: string; name: string; phone: string | null };
const TYPES = ["Xe máy điện", "Xe đạp điện", "Ô tô điện", "Xe ba bánh điện", "Khác"];
const empty = { customer_id: "", plate: "", vin: "", vehicle_type: TYPES[0], model: "" };

export default function VehiclesPage() {
  const [list, setList] = useState<Vehicle[]>([]);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const v = await supabase.from("vehicles").select("*, customers(name, phone)").order("created_at", { ascending: false });
    const c = await supabase.from("customers").select("id, name, phone").order("name");
    if (v.error) setError(v.error.message); else setList(v.data as unknown as Vehicle[]);
    if (c.data) setCusts(c.data);
    setLoaded(true);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body = { ...form, plate: form.plate.trim().toUpperCase() };
    const res = editId
      ? await supabase.from("vehicles").update(body).eq("id", editId)
      : await supabase.from("vehicles").insert(body);
    if (res.error) return setError(res.error.code === "23505" ? "Biển số này đã có trong hệ thống." : res.error.message);
    setForm(empty); setEditId(null); load();
  }
  async function remove(v: Vehicle) {
    if (!confirm(`Xóa xe ${v.plate}? Phiếu tiếp nhận của xe này cũng bị xóa.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
    if (error) setError(error.message); else load();
  }

  const shown = list.filter((v) => (v.plate + (v.vin ?? "") + (v.customers?.name ?? "")).toLowerCase().includes(q.toLowerCase()));
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="car" />} title="Xe" />
      <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
        <select required className={input} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
          <option value="">-- Chọn chủ xe * --</option>
          {custs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` - ${c.phone}` : ""}</option>)}
        </select>
        <input required placeholder="Biển số *" className={input} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
        <input placeholder="Số khung" className={input} value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
        <select className={input} value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input placeholder="Hãng / mẫu xe (VD: VinFast Klara S)" className={`${input} sm:col-span-2`} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <div className="sm:col-span-2 flex gap-2">
          <button className="btn-primary">{editId ? "Lưu thay đổi" : "Thêm xe"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="btn-secondary">Hủy</button>}
        </div>
        {custs.length === 0 && <p className="sm:col-span-2 text-sm text-amber-700">Cần thêm khách hàng trước khi thêm xe.</p>}
      </form>
      <Toast text={error} onClose={() => setError("")} />
      <input placeholder="Tìm theo biển số, số khung, tên chủ xe..." className={input} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-2">
        {shown.map((v) => (
          <li key={v.id} className="card flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-navy-900">{v.plate} <span className="text-sm font-normal text-slate-500">· {v.vehicle_type}{v.model ? ` · ${v.model}` : ""}</span></div>
              <div className="text-sm text-slate-500">Chủ xe: {v.customers?.name}{v.customers?.phone ? ` (${v.customers.phone})` : ""}{v.vin ? ` · Số khung: ${v.vin}` : ""}</div>
            </div>
            <div className="flex gap-1 text-sm shrink-0 items-start">
              <button onClick={() => { setEditId(v.id); setForm({ customer_id: v.customer_id, plate: v.plate, vin: v.vin ?? "", vehicle_type: v.vehicle_type, model: v.model ?? "" }); window.scrollTo(0, 0); }} className="bare text-green-700 px-3 min-h-11">Sửa</button>
              <button onClick={() => remove(v)} className="bare text-red-600 px-3 min-h-11">Xóa</button>
            </div>
          </li>
        ))}
        {!loaded && <li><LoadingBlock rows={3} /></li>}
        {loaded && shown.length === 0 && <li><EmptyState icon={<Icon name="car" />} text={q ? "Không có xe nào khớp từ khóa." : "Chưa có xe. Nhập form phía trên để thêm xe đầu tiên."} /></li>}
      </ul>
    </div>
  );
}
