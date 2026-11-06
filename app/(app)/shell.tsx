"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const menu = [
  { href: "/", label: "Tổng quan" },
  { href: "/tiep-nhan", label: "Tiếp nhận" },
  { href: "/khach-hang", label: "Khách hàng" },
  { href: "/xe", label: "Xe" },
  { href: "/phu-tung", label: "Phụ tùng" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (!ready) return <p className="p-6 text-slate-500">Đang tải...</p>;

  return (
    <div className="min-h-screen bg-slate-50 pb-16 md:pb-0 md:flex">
      <aside className="hidden md:flex md:flex-col md:w-56 bg-white border-r p-4 gap-1">
        <div className="font-bold mb-4">⚡ Gara xe điện</div>
        {menu.map((m) => (
          <Link key={m.href} href={m.href}
            className={`px-3 py-2 rounded-lg ${pathname === m.href ? "bg-green-100 text-green-800 font-medium" : "hover:bg-slate-100"}`}>
            {m.label}
          </Link>
        ))}
        <button onClick={() => supabase.auth.signOut()} className="mt-auto text-left px-3 py-2 text-sm text-slate-500 hover:text-red-600">
          Đăng xuất
        </button>
      </aside>
      <main className="flex-1 p-4 md:p-6 max-w-4xl w-full">{children}</main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t flex">
        {menu.map((m) => (
          <Link key={m.href} href={m.href}
            className={`flex-1 text-center py-3 text-sm ${pathname === m.href ? "text-green-700 font-semibold" : "text-slate-600"}`}>
            {m.label}
          </Link>
        ))}
        <button onClick={() => supabase.auth.signOut()} className="flex-1 py-3 text-sm text-slate-500">Thoát</button>
      </nav>
    </div>
  );
}
