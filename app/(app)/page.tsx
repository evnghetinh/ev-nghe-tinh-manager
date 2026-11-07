"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { money, tonText } from "@/lib/format";
import { useRole } from "@/lib/role";

type Cost = { cost_price: number };
type Paid = { paid_at: string; repair_items: { kind: string; qty: number; unit_price: number; repair_item_costs: Cost | Cost[] | null }[]; repair_costs: { kind: string; amount: number }[] };
const costOf = (i: Paid["repair_items"][number]) => {
  const c = i.repair_item_costs;
  return (Array.isArray(c) ? c[0]?.cost_price : c?.cost_price) ?? 0;
};
type Bd = { rev: number; parts: number; vat_tu: number; thue_ngoai: number; khac: number };
const emptyBd = (): Bd => ({ rev: 0, parts: 0, vat_tu: 0, thue_ngoai: 0, khac: 0 });
const profitOf = (b: Bd) => b.rev - b.parts - b.vat_tu - b.thue_ngoai - b.khac;
const rows: [string, keyof Bd][] = [["Doanh thu", "rev"], ["Giá vốn phụ tùng", "parts"], ["Chi phí vật tư tiêu hao", "vat_tu"], ["Chi phí thuê ngoài", "thue_ngoai"], ["Chi phí khác", "khac"]];
type Low = { id: string; name: string; stock: number; min_stock: number; don_vi_nhap: string; don_vi_ban: string; he_so: number };

export default function Dashboard() {
  const role = useRole();
  const [open, setOpen] = useState(0);
  const [bd, setBd] = useState<[Bd, Bd]>([emptyBd(), emptyBd()]); // [hôm nay, tháng này]
  const [low, setLow] = useState<Low[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (role !== "chu") return;
    (async () => {
      const today = new Date().toLocaleDateString("sv-SE");
      const first = today.slice(0, 8) + "01";
      const o = await supabase.from("repair_orders").select("*", { count: "exact", head: true }).in("status", ["Chờ xử lý", "Đang sửa"]);
      const p = await supabase.from("repair_orders").select("paid_at, repair_items(kind, qty, unit_price, repair_item_costs(cost_price)), repair_costs(kind, amount)")
        .eq("stock_deducted", true).gte("paid_at", first).lte("paid_at", today);
      const pt = await supabase.from("parts").select("id, name, stock, min_stock, don_vi_nhap, don_vi_ban, he_so").eq("is_hidden", false).order("stock");
      if (p.error || pt.error) setError((p.error ?? pt.error)!.message);
      const day = emptyBd(), mon = emptyBd();
      for (const r of (p.data ?? []) as unknown as Paid[]) {
        const rev = r.repair_items.reduce((s, i) => s + i.qty * i.unit_price, 0);
        const parts = r.repair_items.filter((i) => i.kind === "part").reduce((s, i) => s + i.qty * costOf(i), 0);
        for (const b of r.paid_at === today ? [day, mon] : [mon]) {
          b.rev += rev;
          b.parts += parts;
          for (const c of r.repair_costs ?? []) if (c.kind === "vat_tu" || c.kind === "thue_ngoai" || c.kind === "khac") b[c.kind] += c.amount;
        }
      }
      setOpen(o.count ?? 0);
      setBd([day, mon]);
      setLow(((pt.data ?? []) as Low[]).filter((x) => Number(x.stock) <= Number(x.min_stock)));
    })();
  }, [role]);

  if (role !== "chu") return <p className="text-slate-500">Bạn không có quyền xem trang này.</p>;

  const cards = [
    { label: "Xe đang sửa / chờ xử lý", value: String(open), href: "/tiep-nhan" },
    { label: "Doanh thu hôm nay", value: money(bd[0].rev) },
    { label: "Doanh thu tháng này", value: money(bd[1].rev) },
    { label: "Lợi nhuận hôm nay", value: money(profitOf(bd[0])), loss: profitOf(bd[0]) < 0 },
    { label: "Lợi nhuận tháng này", value: money(profitOf(bd[1])), loss: profitOf(bd[1]) < 0 },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Tổng quan</h1>
      {error && <p className="text-sm text-red-600">{error} (đã chạy giai-doan-10.sql chưa?)</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => {
          const inner = (<><div className={`text-2xl font-bold ${c.loss ? "text-red-700" : "text-green-700"}`}>{c.value}</div><div className="text-sm text-slate-500">{c.label}</div></>);
          return c.href
            ? <Link key={c.label} href={c.href} className="bg-white rounded-xl shadow p-4">{inner}</Link>
            : <div key={c.label} className="bg-white rounded-xl shadow p-4">{inner}</div>;
        })}
      </div>
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-semibold">Chia nhỏ lợi nhuận</h2>
        <p className="text-xs text-slate-500 mb-2">Tính vào ngày/tháng thu tiền của phiếu.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-slate-500 text-right"><th className="text-left font-normal"></th><th className="font-normal">Hôm nay</th><th className="font-normal">Tháng này</th></tr></thead>
          <tbody className="divide-y">
            {rows.map(([name, k]) => (
              <tr key={k} className="text-right"><td className="text-left py-2 pr-2">{name}</td><td>{money(bd[0][k])}</td><td>{money(bd[1][k])}</td></tr>
            ))}
            <tr className="text-right font-bold">
              <td className="text-left py-2">Lợi nhuận</td>
              {bd.map((b, i) => <td key={i} className={profitOf(b) < 0 ? "text-red-700" : "text-green-700"}>{money(profitOf(b))}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-semibold mb-2">Phụ tùng sắp hết hàng</h2>
        {low.length === 0 ? <p className="text-sm text-slate-500">Không có.</p> : (
          <ul className="divide-y">
            {low.map((x) => (
              <li key={x.id} className="py-2 flex justify-between text-sm"><span>{x.name}</span><span className="text-red-700 font-medium">Còn {tonText(Number(x.stock), { ...x, he_so: Number(x.he_so) })}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
