"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { RoleContext, roleLabel, type Role } from "@/lib/role";

const menu = [
  { href: "/", label: "Tổng quan", ownerOnly: true },
  { href: "/tiep-nhan", label: "Tiếp nhận" },
  { href: "/khach-hang", label: "Khách hàng" },
  { href: "/xe", label: "Xe" },
  { href: "/phu-tung", label: "Phụ tùng" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return router.replace("/login");
      supabase.from("user_roles").select("role").eq("user_id", data.session.user.id).maybeSingle().then(({ data: r, error }) => {
        if (error) setRoleError("Không đọc được vai trò (đã chạy giai-doan-4.sql chưa?): " + error.message);
        else if (!r) setRoleError("Tài khoản chưa được cấp vai trò. Hãy nhờ Chủ xưởng cấp quyền.");
        else setRole(r.role as Role);
      });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (role === "nhan_vien" && pathname === "/") router.replace("/tiep-nhan");
  }, [role, pathname, router]);

  if (roleError) return (
    <div className="p-6 space-y-3">
      <p className="text-red-600">{roleError}</p>
      <button onClick={() => supabase.auth.signOut()} className="border rounded-lg px-4 py-2">Đăng xuất</button>
    </div>
  );
  if (!role || (role === "nhan_vien" && pathname === "/")) return <p className="p-6 text-slate-500">Đang tải...</p>;

  const items = menu.filter((m) => role === "chu" || !m.ownerOnly);

  return (
    <div className="min-h-screen bg-slate-50 pb-16 md:pb-0 md:flex">
      <aside className="hidden md:flex md:flex-col md:w-56 bg-white border-r p-4 gap-1">
        <div className="font-bold">⚡ Gara xe điện</div>
        <div className="text-xs text-slate-500 mb-4">{roleLabel[role]}</div>
        {items.map((m) => (
          <Link key={m.href} href={m.href}
            className={`px-3 py-2 rounded-lg ${pathname === m.href ? "bg-green-100 text-green-800 font-medium" : "hover:bg-slate-100"}`}>
            {m.label}
          </Link>
        ))}
        <button onClick={() => supabase.auth.signOut()} className="mt-auto text-left px-3 py-2 text-sm text-slate-500 hover:text-red-600">
          Đăng xuất
        </button>
      </aside>
      <main className="flex-1 p-4 md:p-6 max-w-4xl w-full"><RoleContext.Provider value={role}>{children}</RoleContext.Provider></main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t flex">
        {items.map((m) => (
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
