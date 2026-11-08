"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { money, tonText } from "@/lib/format";
import { useRole } from "@/lib/role";
import { Icon, PageTitle, EmptyState, Toast } from "@/components/ui";

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
type Month = { label: string; rev: number; profit: number };
const PAID_SEL = "paid_at, repair_items(kind, qty, unit_price, repair_item_costs(cost_price)), repair_costs(kind, amount)";

export default function Dashboard() {
  const role = useRole();
  const [open, setOpen] = useState(0);
  const [bd, setBd] = useState<[Bd, Bd]>([emptyBd(), emptyBd()]); // [hôm nay, tháng này]
  const [low, setLow] = useState<Low[]>([]);
  const [error, setError] = useState("");
  const [months, setMonths] = useState<Month[]>([]);
  const [kho, setKho] = useState<{ von: number; ban: number; con: number; thieu: number } | null>(null);
  const [no, setNo] = useState<{ tong: number; khach: number } | null>(null);

  useEffect(() => {
    if (role !== "chu") return;
    (async () => {
      const today = new Date().toLocaleDateString("sv-SE");
      const first = today.slice(0, 8) + "01";
      const o = await supabase.from("repair_orders").select("*", { count: "exact", head: true }).in("status", ["Chờ xử lý", "Đang sửa"]);
      const p = await supabase.from("repair_orders").select("paid_at, repair_items(kind, qty, unit_price, repair_item_costs(cost_price)), repair_costs(kind, amount)")
        .eq("stock_deducted", true).eq("da_huy", false).eq("repair_costs.da_huy", false).gte("paid_at", first).lte("paid_at", today);
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
      // 6 tháng gần nhất cho biểu đồ (cùng công thức doanh thu / lợi nhuận)
      const now = new Date();
      const keys = Array.from({ length: 6 }, (_, n) => {
        const d = new Date(now.getFullYear(), now.getMonth() - 5 + n, 1);
        return { k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `T${d.getMonth() + 1}` };
      });
      const h = await supabase.from("repair_orders").select(PAID_SEL).eq("stock_deducted", true).eq("da_huy", false).eq("repair_costs.da_huy", false).gte("paid_at", keys[0].k + "-01").lte("paid_at", today);
      const agg = new Map(keys.map((x) => [x.k, emptyBd()]));
      for (const r of (h.data ?? []) as unknown as Paid[]) {
        const b = agg.get(r.paid_at.slice(0, 7));
        if (!b) continue;
        b.rev += r.repair_items.reduce((t, i) => t + i.qty * i.unit_price, 0);
        b.parts += r.repair_items.filter((i) => i.kind === "part").reduce((t, i) => t + i.qty * costOf(i), 0);
        for (const c of r.repair_costs ?? []) if (c.kind === "vat_tu" || c.kind === "thue_ngoai" || c.kind === "khac") b[c.kind] += c.amount;
      }
      setMonths(keys.map((x) => ({ label: x.label, rev: agg.get(x.k)!.rev, profit: profitOf(agg.get(x.k)!) })));
      const cn = await supabase.rpc("cong_no_tong");
      const row = (cn.data as { tong: number; so_khach: number }[] | null)?.[0];
      setNo(row ? { tong: Number(row.tong), khach: Number(row.so_khach) } : null);
      const tk = await supabase.rpc("tong_gia_tri_ton");
      const k = (tk.data as { tong_von: number; tong_ban: number; so_con_hang: number; so_thieu_gia: number }[] | null)?.[0];
      setKho(k ? { von: Number(k.tong_von), ban: Number(k.tong_ban), con: Number(k.so_con_hang), thieu: Number(k.so_thieu_gia) } : null);
      setOpen(o.count ?? 0);
      setBd([day, mon]);
      setLow(((pt.data ?? []) as Low[]).filter((x) => Number(x.stock) <= Number(x.min_stock)));
    })();
  }, [role]);

  if (role !== "chu") return <EmptyState text="Bạn không có quyền xem trang này." />;

  const cards = [
    { label: "Xe đang sửa / chờ xử lý", value: String(open), href: "/tiep-nhan", icon: "wrench", tone: "bg-sky-100 text-sky-700", loss: false },
    { label: no ? `Khách còn nợ (${no.khach} khách)` : "Khách còn nợ", value: no ? money(no.tong) : "—", href: "/cong-no", icon: "receipt", tone: "bg-red-100 text-red-700", loss: false },
    { label: "Tiền hàng trong kho", value: kho ? money(kho.von) : "—", href: "/phu-tung", icon: "box", tone: "bg-amber-100 text-amber-700", loss: false,
      sub: kho ? `${kho.con} loại còn hàng · giá bán dự kiến ${money(kho.ban)}${kho.thieu > 0 ? ` · ${kho.thieu} món chưa có giá nhập` : ""}` : undefined },
    { label: "Doanh thu hôm nay", value: money(bd[0].rev), icon: "money", tone: "bg-blue-100 text-blue-700", loss: false },
    { label: "Doanh thu tháng này", value: money(bd[1].rev), icon: "money", tone: "bg-indigo-100 text-indigo-700", loss: false },
    { label: "Lợi nhuận hôm nay", value: money(profitOf(bd[0])), loss: profitOf(bd[0]) < 0, icon: "trend", tone: "bg-emerald-100 text-emerald-700" },
    { label: "Lợi nhuận tháng này", value: money(profitOf(bd[1])), loss: profitOf(bd[1]) < 0, icon: "trend", tone: "bg-teal-100 text-teal-700" },
  ];
  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="home" />} title="Tổng quan" />
      <Toast text={error ? error + " (đã chạy giai-doan-10.sql chưa?)" : ""} onClose={() => setError("")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => {
          const inner = (
            <div className="flex items-center gap-3">
              <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${c.tone}`}><Icon name={c.icon} className="w-6 h-6" /></span>
              <div className="min-w-0">
                <div className="text-sm text-slate-500">{c.label}</div>
                <div className={`text-2xl font-bold truncate ${c.loss ? "text-red-700" : "text-navy-900"}`}>{c.value}</div>
                {"sub" in c && c.sub && <div className="text-xs text-slate-500">{c.sub}</div>}
              </div>
            </div>
          );
          return c.href
            ? <Link key={c.label} href={c.href} className="card block hover:ring-2 hover:ring-brand-500">{inner}</Link>
            : <div key={c.label} className="card">{inner}</div>;
        })}
      </div>
      <div className="card">
        <h2 className="font-semibold text-navy-900">Doanh thu và lợi nhuận 6 tháng gần nhất</h2>
        <BarChart data={months} />
      </div>
      <div className="card overflow-x-auto">
        <h2 className="font-semibold text-navy-900">Chia nhỏ lợi nhuận</h2>
        <p className="text-xs text-slate-500 mb-2">Tính vào ngày/tháng thu tiền của phiếu.</p>
        <table className="tbl">
          <thead><tr><th></th><th className="!text-right">Hôm nay</th><th className="!text-right">Tháng này</th></tr></thead>
          <tbody>
            {rows.map(([name, k]) => (
              <tr key={k} className="text-right"><td className="!text-left">{name}</td><td>{money(bd[0][k])}</td><td>{money(bd[1][k])}</td></tr>
            ))}
            <tr className="text-right font-bold">
              <td className="!text-left">Lợi nhuận</td>
              {bd.map((b, i) => <td key={i} className={profitOf(b) < 0 ? "text-red-700" : "text-green-700"}>{money(profitOf(b))}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2 className="font-semibold text-navy-900 mb-2">Phụ tùng sắp hết hàng</h2>
        {low.length === 0 ? <EmptyState icon={<Icon name="box" />} text="Kho đang đủ hàng, chưa có phụ tùng nào sắp hết." /> : (
          <ul className="divide-y">
            {low.map((x) => (
              <li key={x.id} className="py-2 flex justify-between gap-2 text-sm"><span>{x.name}</span><span className="badge bg-red-100 text-red-700 shrink-0">Còn {tonText(Number(x.stock), { ...x, he_so: Number(x.he_so) })}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Biểu đồ cột SVG nhẹ: doanh thu (xanh điện) và lợi nhuận (navy). */
function BarChart({ data }: { data: Month[] }) {
  const W = 360, H = 190, pad = { l: 8, r: 8, t: 14, b: 26 };
  const max = Math.max(1, ...data.flatMap((d) => [d.rev, d.profit]));
  const min = Math.min(0, ...data.map((d) => d.profit));
  const span = max - min || 1;
  const ph = H - pad.t - pad.b;
  const y = (v: number) => pad.t + ph * (1 - (v - min) / span);
  const zero = y(0);
  const slot = (W - pad.l - pad.r) / Math.max(data.length, 1);
  const bw = Math.min(18, slot / 2 - 3);
  const short = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "tr" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + "k" : String(v));
  if (data.length === 0) return <p className="text-sm text-slate-500 py-6 text-center">Đang tải biểu đồ...</p>;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Biểu đồ cột doanh thu và lợi nhuận 6 tháng gần nhất">
        <line x1={pad.l} x2={W - pad.r} y1={zero} y2={zero} stroke="#cbd5e1" />
        {data.map((d, n) => {
          const cx = pad.l + slot * n + slot / 2;
          const bar = (v: number, x: number, fill: string) => <rect x={x} y={Math.min(y(v), zero)} width={bw} height={Math.max(Math.abs(y(v) - zero), v ? 1 : 0)} rx={3} fill={fill} />;
          return (
            <g key={d.label}>
              {bar(d.rev, cx - bw - 1, "#1597f5")}
              {bar(d.profit, cx + 1, d.profit < 0 ? "#dc2626" : "#0f2747")}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#55657d">{d.label}</text>
              {d.rev > 0 && <text x={cx - bw / 2 - 1} y={y(d.rev) - 3} textAnchor="middle" fontSize="8" fill="#0866b8">{short(d.rev)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-xs text-slate-600 justify-center">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: "#1597f5" }} />Doanh thu</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: "#0f2747" }} />Lợi nhuận</span>
      </div>
    </div>
  );
}
