"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { useRole } from "@/lib/role";

type Paid = { paid_at: string; repair_items: { kind: string; qty: number; unit_price: number; repair_item_costs: { cost_price: number } | { cost_price: number }[] | null }[] };
const costOf = (i: Paid["repair_items"][number]) => {
  const c = i.repair_item_costs;
  return (Array.isArray(c) ? c[0]?.cost_price : c?.cost_price) ?? 0;
};
type Low = { id: string; name: string; stock: number; min_stock: number };

export default function Dashboard() {
  const role = useRole();
  const [d, setD] = useState({ open: 0, today: 0, month: 0, profit: 0 });
  const [low, setLow] = useState<Low[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (role !== "chu") return;
    (async () => {
      const today = new Date().toLocaleDateString("sv-SE");
      const first = today.slice(0, 8) + "01";
      const o = await supabase.from("repair_orders").select("*", { count: "exact", head: true }).in("status", ["Chờ xử lý", "Đang sửa"]);
      const p = await supabase.from("repair_orders").select("paid_at, repair_items(kind, qty, unit_price, repair_item_costs(cost_price))")
        .eq("stock_deducted", true).gte("paid_at", first).lte("paid_at", today);
      const pt = await supabase.from("parts").select("id, name, stock, min_stock").order("stock");
      if (p.error || pt.error) setError((p.error ?? pt.error)!.message);
      let t = 0, m = 0, cost = 0;
      for (const r of (p.data ?? []) as unknown as Paid[]) {
        const rev = r.repair_items.reduce((s, i) => s + i.qty * i.unit_price, 0);
        m += rev;
        if (r.paid_at === today) t += rev;
        cost += r.repair_items.filter((i) => i.kind === "part").reduce((s, i) => s + i.qty * costOf(i), 0);
      }
      setD({ open: o.count ?? 0, today: t, month: m, profit: m - cost });
      setLow(((pt.data ?? []) as Low[]).filter((x) => x.stock <= x.min_stock));
    })();
  }, [role]);

  if (role !== "chu") return <p className="text-slate-500">Bạn không có quyền xem trang này.</p>;

  const cards = [
    { label: "Xe đang sửa / chờ xử lý", value: String(d.open), href: "/tiep-nhan" },
    { label: "Doanh thu hôm nay", value: money(d.today) },
    { label: "Doanh thu tháng này", value: money(d.month) },
    { label: "Lợi nhuận tháng này", value: money(d.profit) },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Tổng quan</h1>
      {error && <p className="text-sm text-red-600">{error} (đã chạy giai-doan-3.sql chưa?)</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => {
          const inner = (<><div className="text-2xl font-bold text-green-700">{c.value}</div><div className="text-sm text-slate-500">{c.label}</div></>);
          return c.href
            ? <Link key={c.label} href={c.href} className="bg-white rounded-xl shadow p-4">{inner}</Link>
            : <div key={c.label} className="bg-white rounded-xl shadow p-4">{inner}</div>;
        })}
      </div>
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-semibold mb-2">Phụ tùng sắp hết hàng</h2>
        {low.length === 0 ? <p className="text-sm text-slate-500">Không có.</p> : (
          <ul className="divide-y">
            {low.map((x) => (
              <li key={x.id} className="py-2 flex justify-between text-sm"><span>{x.name}</span><span className="text-red-700 font-medium">Còn {x.stock}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
