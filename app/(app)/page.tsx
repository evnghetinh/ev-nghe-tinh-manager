"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function Dashboard() {
  const [n, setN] = useState({ customers: 0, vehicles: 0, open: 0 });

  useEffect(() => {
    (async () => {
      const c = await supabase.from("customers").select("*", { count: "exact", head: true });
      const v = await supabase.from("vehicles").select("*", { count: "exact", head: true });
      const o = await supabase.from("repair_orders").select("*", { count: "exact", head: true })
        .in("status", ["Chờ xử lý", "Đang sửa"]);
      setN({ customers: c.count ?? 0, vehicles: v.count ?? 0, open: o.count ?? 0 });
    })();
  }, []);

  const cards = [
    { label: "Xe đang chờ / đang sửa", value: n.open, href: "/tiep-nhan" },
    { label: "Khách hàng", value: n.customers, href: "/khach-hang" },
    { label: "Xe đã đăng ký", value: n.vehicles, href: "/xe" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Tổng quan</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="bg-white rounded-xl shadow p-4">
            <div className="text-3xl font-bold text-green-700">{c.value}</div>
            <div className="text-sm text-slate-500">{c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
