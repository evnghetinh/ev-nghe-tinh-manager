"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";

type Customer = { id: string; name: string; phone: string | null; address: string | null; note: string | null; so_xe: number; no: number };
const empty = { name: "", phone: "", address: "", note: "" };
const TRANG = 20;
const SAP_XEP = [{ v: "moi", t: "Mới nhất" }, { v: "ten", t: "Tên A-Z" }, { v: "no", t: "Nợ nhiều nhất" }];

export default function CustomersPage() {
  const them = useSearchParams().get("them");
  const [list, setList] = useState<Customer[]>([]);
  const [form, setForm] = useState(() => {
    const t = (them ?? "").trim();
    if (!t) return empty;
    return /^[\d\s.+-]+$/.test(t) ? { ...empty, phone: t } : { ...empty, name: t };
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sort, setSort] = useState("moi");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [dangTai, setDangTai] = useState(false);
  const [lam, setLam] = useState(0);
  const lan = useRef(0);

  // Chờ 250ms sau khi ngừng gõ rồi mới tìm
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const tai = useCallback(async (batDau: number) => {
    const my = ++lan.current;
    setDangTai(true);
    const { data, error } = await supabase.rpc("khach_danh_sach", { p_q: dq, p_sap_xep: sort, p_so: TRANG + 1, p_bat_dau: batDau });
    if (my !== lan.current) return;
    setDangTai(false);
    setLoaded(true);
    if (error) return setError(error.message + " (đã chạy giai-doan-27.sql chưa?)");
    const rows = ((data ?? []) as Customer[]).map((c) => ({ ...c, so_xe: Number(c.so_xe), no: Number(c.no) }));
    setHasMore(rows.length > TRANG);
    setList((cu) => (batDau === 0 ? rows.slice(0, TRANG) : [...cu, ...rows.slice(0, TRANG)]));
  }, [dq, sort]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { tai(0); }, [tai, lam]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = editId
      ? await supabase.from("customers").update(form).eq("id", editId)
      : await supabase.from("customers").insert(form);
    if (res.error) return setError(res.error.message);
    setForm(empty); setEditId(null); setLam((n) => n + 1);
  }
  async function remove(c: Customer) {
    if (!confirm(`Xóa khách "${c.name}"? Xe và phiếu của khách này cũng bị xóa.`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) setError(error.message); else setLam((n) => n + 1);
  }

  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="users" />} title="Khách hàng" />
      <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
        <input required autoFocus={!!them} placeholder="Tên khách *" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Số điện thoại" inputMode="tel" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Địa chỉ" className={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input placeholder="Ghi chú" className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <div className="sm:col-span-2 flex gap-2">
          <button className="btn-primary">{editId ? "Lưu thay đổi" : "Thêm khách"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="btn-secondary">Hủy</button>}
        </div>
      </form>
      <Toast text={error} onClose={() => setError("")} />
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <input type="search" placeholder="Tìm theo tên hoặc số điện thoại (bất kỳ phần nào)..." aria-label="Tìm khách" className={input} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Sắp xếp" className={input} value={sort} onChange={(e) => setSort(e.target.value)}>
          {SAP_XEP.map((o) => <option key={o.v} value={o.v}>Sắp xếp: {o.t}</option>)}
        </select>
      </div>
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.id} className="card flex justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/khach-hang/${c.id}`} className="block font-semibold text-navy-900 break-words py-2 -my-2 underline-offset-2 hover:underline">{c.name}</Link>
              <div className="text-sm text-slate-500 break-words">{[c.phone, c.address, c.note].filter(Boolean).join(" · ")}</div>
              <div className="text-sm text-slate-500">{c.so_xe} xe{c.no > 0 && <span className="font-semibold text-red-700"> · Nợ {money(c.no)}</span>}</div>
            </div>
            <div className="flex gap-1 text-sm shrink-0 items-start">
              <button onClick={() => { setEditId(c.id); setForm({ name: c.name, phone: c.phone ?? "", address: c.address ?? "", note: c.note ?? "" }); window.scrollTo(0, 0); }} className="bare text-green-700 px-3 min-h-11">Sửa</button>
              <button onClick={() => remove(c)} className="bare text-red-600 px-3 min-h-11">Xóa</button>
            </div>
          </li>
        ))}
        {!loaded && <li><LoadingBlock rows={3} /></li>}
        {loaded && list.length === 0 && <li><EmptyState icon={<Icon name="users" />} text={dq ? "Không có khách nào khớp từ khóa." : "Chưa có khách hàng. Nhập form phía trên để thêm khách đầu tiên."} /></li>}
      </ul>
      {hasMore && <button type="button" disabled={dangTai} onClick={() => tai(list.length)} className="btn-secondary w-full">{dangTai ? "Đang tải..." : "Tải thêm"}</button>}
    </div>
  );
}
