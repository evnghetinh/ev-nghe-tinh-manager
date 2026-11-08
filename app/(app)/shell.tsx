"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { RoleContext, roleLabel, type Role } from "@/lib/role";
import { Icon, Logo, LoadingBlock } from "@/components/ui";

const menu = [
  { href: "/", label: "Tổng quan", icon: "home", ownerOnly: true },
  { href: "/tiep-nhan", label: "Tiếp nhận", icon: "clipboard" },
  { href: "/khach-hang", label: "Khách hàng", icon: "users" },
  { href: "/xe", label: "Xe", icon: "car" },
  { href: "/phu-tung", label: "Phụ tùng", icon: "box" },
  { href: "/cong-no", label: "Công nợ khách", icon: "receipt" },
  { href: "/nhap-hang", label: "Nhập hàng", icon: "truck", ownerOnly: true },
  { href: "/so-quy", label: "Sổ quỹ", icon: "money", ownerOnly: true },
  { href: "/von", label: "Vốn", icon: "wallet", ownerOnly: true },
  { href: "/nhat-ky", label: "Nhật ký", icon: "history", ownerOnly: true },
  { href: "/cai-dat", label: "Cài đặt", icon: "cog", ownerOnly: true },
];
const MOBILE_MAIN = ["/", "/tiep-nhan", "/phu-tung", "/khach-hang"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState("");
  const [email, setEmail] = useState("");
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return router.replace("/login");
      setEmail(data.session.user.email ?? "");
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

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMore(false); }, [pathname]);

  if (roleError) return (
    <div className="p-6 space-y-3 max-w-md mx-auto">
      <p className="text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{roleError}</p>
      <button onClick={() => supabase.auth.signOut()} className="btn-secondary">Đăng xuất</button>
    </div>
  );
  if (!role || (role === "nhan_vien" && pathname === "/")) return <div className="p-6 max-w-md"><LoadingBlock rows={2} /></div>;

  const items = menu.filter((m) => role === "chu" || !m.ownerOnly);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const main = items.filter((m) => MOBILE_MAIN.includes(m.href));
  const rest = items.filter((m) => !MOBILE_MAIN.includes(m.href));
  const left = main.slice(0, 2), right = main.slice(2);
  const name = email.split("@")[0] || "Người dùng";

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/tiep-nhan?tim=${encodeURIComponent(search.trim())}`);
  }
  const NavItem = ({ m }: { m: (typeof menu)[number] }) => (
    <Link href={m.href} className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs font-medium ${active(m.href) ? "text-brand-600" : "text-slate-600"}`}>
      <Icon name={m.icon} className="w-6 h-6" />{m.label}
    </Link>
  );

  return (
    <div className="min-h-screen pb-20 md:pb-0 md:flex">
      <aside className="hidden md:flex print:!hidden md:flex-col md:w-64 md:sticky md:top-0 md:h-screen shrink-0 bg-navy-900 text-slate-200 p-4 gap-1">
        <div className="flex items-center gap-3 px-2 pb-5">
          <Logo size={42} />
          <div className="leading-tight"><div className="font-bold text-white">EV Nghệ Tĩnh</div><div className="text-xs tracking-widest text-sky-300">AUTO</div></div>
        </div>
        {items.map((m) => (
          <Link key={m.href} href={m.href}
            className={`flex items-center gap-3 px-3 min-h-11 rounded-xl text-[15px] ${active(m.href) ? "bg-brand-600 text-white font-semibold shadow-lg shadow-sky-900/40" : "text-slate-300 hover:bg-navy-700 hover:text-white"}`}>
            <Icon name={m.icon} />{m.label}
          </Link>
        ))}
        <button onClick={() => supabase.auth.signOut()} className="bare mt-auto flex items-center gap-3 px-3 min-h-11 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-navy-700">
          <Icon name="logout" />Đăng xuất
        </button>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="print:hidden sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200 px-3 md:px-6 min-h-16 flex items-center gap-3">
          <div className="md:hidden"><Logo size={36} /></div>
          <form onSubmit={onSearch} className="flex-1 max-w-xl relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" className="w-5 h-5" /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm phiếu theo biển số, tên khách, SĐT..." aria-label="Tìm kiếm"
              className="w-full !pl-10 !bg-slate-100 !border-transparent" />
          </form>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-sm font-semibold text-navy-900">{name}</div>
              <div className="text-xs text-slate-500">{roleLabel[role]}</div>
            </div>
            <span className="w-10 h-10 rounded-full bg-navy-800 text-white font-bold flex items-center justify-center uppercase">{name[0]}</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-5xl w-full print:p-0 print:max-w-none"><RoleContext.Provider value={role}>{children}</RoleContext.Provider></main>
      </div>

      <nav className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 flex items-stretch shadow-[0_-4px_16px_rgba(10,27,51,0.08)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {left.map((m) => <NavItem key={m.href} m={m} />)}
        <Link href="/tiep-nhan" className="flex-1 flex flex-col items-center justify-end text-xs font-semibold text-brand-700 pb-1.5 relative">
          <span className="absolute -top-6 w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg shadow-sky-700/40 border-4 border-white" style={{ background: "linear-gradient(135deg,#1597f5,#0866b8)" }}><Icon name="plus" className="w-7 h-7" /></span>
          Tiếp nhận xe
        </Link>
        {right.map((m) => <NavItem key={m.href} m={m} />)}
        <button onClick={() => setMore(!more)} className="bare flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs font-medium text-slate-600"><Icon name="cog" className="w-6 h-6" />Thêm</button>
      </nav>
      {more && (
        <div className="md:hidden print:hidden fixed inset-0 z-50 bg-navy-900/60" onClick={() => setMore(false)}>
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl p-4 pb-8 grid grid-cols-3 gap-2" onClick={(e) => e.stopPropagation()}>
            {rest.map((m) => (
              <Link key={m.href} href={m.href} className="flex flex-col items-center gap-1 p-3 rounded-xl bg-slate-100 text-sm font-medium text-navy-800 min-h-20 justify-center"><Icon name={m.icon} className="w-6 h-6" />{m.label}</Link>
            ))}
            <button onClick={() => supabase.auth.signOut()} className="bare flex flex-col items-center gap-1 p-3 rounded-xl bg-red-50 text-sm font-medium text-red-700 min-h-20 justify-center"><Icon name="logout" className="w-6 h-6" />Đăng xuất</button>
          </div>
        </div>
      )}
    </div>
  );
}
