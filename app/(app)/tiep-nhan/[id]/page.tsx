"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money, digits } from "@/lib/format";
import Photos from "./photos";

type Item = { id: string; kind: "part" | "labor"; name: string; qty: number; unit_price: number };
type Part = { id: string; name: string; code: string | null; sale_price: number; stock: number };
type Past = { id: string; code: number; received_at: string; odometer: number | null; issue: string; status: string; items: { kind: "part" | "labor"; name: string; qty: number }[] };
type Order = { code: number; issue: string; status: string; payment_method: string | null; paid_at: string | null; stock_deducted: boolean; vehicles: { plate: string } | null; customers: { name: string; phone: string | null } | null };

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const [labor, setLabor] = useState({ name: "", price: "" });
  const [error, setError] = useState("");
  const [pay, setPay] = useState({ method: "Tiền mặt", date: new Date().toLocaleDateString("sv-SE") });
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<Past[] | null>(null);
  const [pastError, setPastError] = useState("");

  const load = useCallback(async () => {
    const o = await supabase.from("repair_orders").select("code, issue, status, payment_method, paid_at, stock_deducted, vehicles(plate), customers(name, phone)").eq("id", id).single();
    const i = await supabase.from("repair_items").select("id, kind, name, qty, unit_price").eq("order_id", id).order("created_at");
    const p = await supabase.from("parts").select("id, name, code, sale_price, stock").order("name");
    if (o.error) setError(o.error.message); else setOrder(o.data as unknown as Order);
    if (i.data) setItems(i.data as Item[]);
    if (p.data) setParts(p.data as Part[]);
    const h = await supabase.rpc("lich_su_xe", { p_order: id });
    if (h.error) { setPastError(h.error.message); setPast([]); } else { setPastError(""); setPast(h.data as Past[]); }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const p = parts.find((x) => x.id === partId);
    if (!p) return setError("Hãy chọn phụ tùng.");
    const n = Number(qty);
    if (!(n > 0)) return setError("Số lượng phải lớn hơn 0.");
    const { error } = await supabase.from("repair_items").insert({ order_id: id, part_id: p.id, kind: "part", name: p.name, qty: n, unit_price: p.sale_price });
    if (error) return setError(error.message);
    setPartId(""); setQty("1"); load();
  }
  async function addLabor(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.from("repair_items").insert({ order_id: id, kind: "labor", name: labor.name.trim(), qty: 1, unit_price: Number(labor.price || 0) });
    if (error) return setError(error.message);
    setLabor({ name: "", price: "" }); load();
  }
  async function remove(it: Item) {
    if (!confirm(`Xóa dòng "${it.name}"?`)) return;
    const { error } = await supabase.from("repair_items").delete().eq("id", it.id);
    if (error) setError(error.message); else load();
  }

  async function complete() {
    setError("");
    if (!pay.date) return setError("Hãy chọn ngày thu tiền.");
    if (!confirm(`Hoàn thành và thu ${money(partsTotal + laborTotal)} (${pay.method})? Kho phụ tùng sẽ bị trừ và không hoàn tác được.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("hoan_thanh_phieu", { p_order: id, p_method: pay.method, p_date: pay.date });
    setBusy(false);
    if (error) return setError(error.message);
    load();
  }

  const sum = (k: Item["kind"]) => items.filter((i) => i.kind === k).reduce((s, i) => s + i.qty * i.unit_price, 0);
  const partsTotal = sum("part");
  const laborTotal = sum("labor");
  const done = !!order?.stock_deducted;
  const input = "w-full border rounded-lg px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <Link href="/tiep-nhan" className="text-sm text-blue-600">← Quay lại danh sách phiếu</Link>
        <Link href={`/tiep-nhan/${id}/in`} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm">In báo giá</Link>
      </div>
      {order && (
        <div className="bg-white rounded-xl shadow p-4">
          <h1 className="text-xl font-bold">Báo giá PT{String(order.code).padStart(4, "0")} · {order.vehicles?.plate}</h1>
          <p className="text-sm text-slate-500">{order.customers?.name}{order.customers?.phone ? ` (${order.customers.phone})` : ""} · {order.status}</p>
          <p className="text-sm mt-1">{order.issue}</p>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!done && <form onSubmit={addPart} className="bg-white rounded-xl shadow p-4 grid gap-3 sm:grid-cols-[1fr_6rem_auto]">
        <select className={input} value={partId} onChange={(e) => setPartId(e.target.value)}>
          <option value="">-- Chọn phụ tùng --</option>
          {parts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""} · {money(p.sale_price)} · tồn {p.stock}</option>)}
        </select>
        <input placeholder="SL" inputMode="decimal" className={input} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
        <button className="bg-green-600 text-white rounded-lg px-4 py-2">Thêm phụ tùng</button>
        {parts.length === 0 && <p className="sm:col-span-3 text-sm text-amber-700">Chưa có phụ tùng. Hãy thêm ở mục Phụ tùng.</p>}
      </form>}

      {!done && <form onSubmit={addLabor} className="bg-white rounded-xl shadow p-4 grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
        <input required placeholder="Tiền công (vd: Thay bộ sạc) *" className={input} value={labor.name} onChange={(e) => setLabor({ ...labor, name: e.target.value })} />
        <input required placeholder="Số tiền (đ) *" inputMode="numeric" className={input} value={labor.price} onChange={(e) => setLabor({ ...labor, price: digits(e.target.value) })} />
        <button className="bg-green-600 text-white rounded-lg px-4 py-2">Thêm tiền công</button>
      </form>}

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="bg-white rounded-xl shadow p-3 flex justify-between gap-2 items-center">
            <div>
              <div className="font-medium">{it.name} <span className="text-xs text-slate-500">({it.kind === "part" ? "Phụ tùng" : "Tiền công"})</span></div>
              <div className="text-sm text-slate-500">{it.qty} × {money(it.unit_price)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-medium">{money(it.qty * it.unit_price)}</div>
              {!done && <button onClick={() => remove(it)} className="text-red-600 text-sm">Xóa</button>}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="text-slate-500 text-sm">Chưa có dòng nào.</li>}
      </ul>

      <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-1">
        <div className="flex justify-between text-sm"><span>Tiền phụ tùng</span><span>{money(partsTotal)}</span></div>
        <div className="flex justify-between text-sm"><span>Tiền công</span><span>{money(laborTotal)}</span></div>
        <div className="flex justify-between text-lg font-bold"><span>Tổng báo giá</span><span>{money(partsTotal + laborTotal)}</span></div>
      </div>

      {done ? (
        <div className="bg-slate-100 rounded-xl p-4 text-sm">Đã hoàn thành và thu tiền ({order?.payment_method}) ngày {order?.paid_at?.split("-").reverse().join("/")}. Kho đã được trừ.</div>
      ) : (
        <div className="bg-white rounded-xl shadow p-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <select className={input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            <option>Tiền mặt</option><option>Chuyển khoản</option>
          </select>
          <input type="date" className={input} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
          <button onClick={complete} disabled={busy || items.length === 0} className="bg-green-700 text-white rounded-lg px-4 py-2 disabled:opacity-50">Hoàn thành và thu tiền</button>
        </div>
      )}

      <Photos orderId={id} />

      <section className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="font-bold">Lịch sử sửa chữa của xe này</h2>
        {past === null ? <p className="text-sm text-slate-500">Đang tải...</p> : (
          <>
            <p className="text-sm text-slate-600">Tổng số lượt xe đã vào xưởng: <b>{past.length + 1}</b>{past.length === 0 ? " (đây là lần đầu)" : ""}</p>
            {pastError && <p className="text-sm text-red-600">Không tải được lịch sử: {pastError}</p>}
            <ul className="space-y-2">
              {past.map((h) => {
                const ps = h.items.filter((x) => x.kind === "part");
                const ls = h.items.filter((x) => x.kind === "labor");
                return (
                  <li key={h.id}>
                    <Link href={`/tiep-nhan/${h.id}`} className="block border rounded-lg p-3 hover:bg-slate-50 space-y-1">
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span className="font-medium">PT{String(h.code).padStart(4, "0")} · {new Date(h.received_at).toLocaleDateString("vi-VN")}{h.odometer != null ? ` · ${new Intl.NumberFormat("vi-VN").format(h.odometer)} km` : ""}</span>
                        <span className="text-sm text-slate-500">{h.status}</span>
                      </div>
                      <div className="text-sm"><span className="text-slate-500">Khách báo: </span>{h.issue}</div>
                      <div className="text-sm"><span className="text-slate-500">Phụ tùng đã thay: </span>{ps.length ? ps.map((x) => `${x.name} ×${x.qty}`).join(", ") : "—"}</div>
                      <div className="text-sm"><span className="text-slate-500">Công đã làm: </span>{ls.length ? ls.map((x) => x.name).join(", ") : "—"}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
