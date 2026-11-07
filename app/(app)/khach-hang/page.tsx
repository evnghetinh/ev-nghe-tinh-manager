"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";

type Customer = { id: string; name: string; phone: string | null; address: string | null; note: string | null };
const empty = { name: "", phone: "", address: "", note: "" };

export default function CustomersPage() {
  const [list, setList] = useState<Customer[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setList(data as Customer[]);
    setLoaded(true);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = editId
      ? await supabase.from("customers").update(form).eq("id", editId)
      : await supabase.from("customers").insert(form);
    if (res.error) return setError(res.error.message);
    setForm(empty); setEditId(null); load();
  }
  async function remove(c: Customer) {
    if (!confirm(`Xóa khách "${c.name}"? Xe và phiếu của khách này cũng bị xóa.`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) setError(error.message); else load();
  }

  const shown = list.filter((c) => (c.name + (c.phone ?? "")).toLowerCase().includes(q.toLowerCase()));
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="users" />} title="Khách hàng" />
      <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
        <input required placeholder="Tên khách *" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Số điện thoại" inputMode="tel" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Địa chỉ" className={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input placeholder="Ghi chú" className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <div className="sm:col-span-2 flex gap-2">
          <button className="btn-primary">{editId ? "Lưu thay đổi" : "Thêm khách"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="btn-secondary">Hủy</button>}
        </div>
      </form>
      <Toast text={error} onClose={() => setError("")} />
      <input placeholder="Tìm theo tên hoặc số điện thoại..." className={input} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-2">
        {shown.map((c) => (
          <li key={c.id} className="card flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-navy-900">{c.name}</div>
              <div className="text-sm text-slate-500">{[c.phone, c.address, c.note].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="flex gap-1 text-sm shrink-0 items-start">
              <button onClick={() => { setEditId(c.id); setForm({ name: c.name, phone: c.phone ?? "", address: c.address ?? "", note: c.note ?? "" }); window.scrollTo(0, 0); }} className="bare text-green-700 px-3 min-h-11">Sửa</button>
              <button onClick={() => remove(c)} className="bare text-red-600 px-3 min-h-11">Xóa</button>
            </div>
          </li>
        ))}
        {!loaded && <li><LoadingBlock rows={3} /></li>}
        {loaded && shown.length === 0 && <li><EmptyState icon={<Icon name="users" />} text={q ? "Không có khách nào khớp từ khóa." : "Chưa có khách hàng. Nhập form phía trên để thêm khách đầu tiên."} /></li>}
      </ul>
    </div>
  );
}
