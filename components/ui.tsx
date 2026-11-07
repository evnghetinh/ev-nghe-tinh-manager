"use client";
import { useEffect, useState } from "react";

export function Bolt({ className = "w-5 h-5" }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden><path d="M13.5 2 5 13.5h5.5L9.5 22 19 9.5h-5.7L13.5 2Z" /></svg>);
}

/** Logo: dùng public/logo.png nếu có, không thì biểu tượng tia sét. */
export function Logo({ size = 40 }: { size?: number }) {
  const [bad, setBad] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  if (!bad) return <img src="/logo.png" alt="EV Nghệ Tĩnh Auto" width={size} height={size} onError={() => setBad(true)} style={{ width: size, height: size, objectFit: "contain" }} />;
  return (
    <span className="inline-flex items-center justify-center rounded-xl text-white shrink-0" style={{ width: size, height: size, background: "linear-gradient(135deg,#1597f5,#0866b8)" }}>
      <Bolt className="w-1/2 h-1/2" />
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  "Chờ xử lý": "bg-amber-100 text-amber-800",
  "Đang sửa": "bg-blue-100 text-blue-800",
  "Hoàn thành": "bg-emerald-100 text-emerald-800",
  "Đã giao xe": "bg-slate-200 text-slate-700",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge shrink-0 ${STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700"}`}>{status}</span>;
}

export function EmptyState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="card flex flex-col items-center text-center gap-2 py-8 text-slate-500">
      <span className="w-12 h-12 rounded-full bg-green-50 text-green-700 flex items-center justify-center">{icon ?? <Bolt />}</span>
      <p className="text-sm max-w-xs">{text}</p>
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-busy>{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-20" />)}</div>;
}

/** Thông báo dạng toast, tự tắt sau vài giây. `kind` = lỗi hoặc thành công. */
export function Toast({ text, kind = "error", onClose }: { text: string; kind?: "error" | "ok"; onClose?: () => void }) {
  useEffect(() => {
    if (!text || kind === "error" || !onClose) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [text, kind, onClose]);
  if (!text) return null;
  const style = kind === "error" ? "bg-red-50 border-red-300 text-red-800" : "bg-emerald-50 border-emerald-300 text-emerald-800";
  return (
    <div role="alert" className={`toast-in fixed z-50 top-3 inset-x-3 md:left-auto md:right-4 md:w-[26rem] border rounded-xl shadow-lg p-3 pr-2 flex gap-2 items-start text-sm ${style}`}>
      <span className="font-bold">{kind === "error" ? "!" : "✓"}</span>
      <span className="flex-1">{text}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Đóng" className="bare w-9 h-9 -my-1 rounded-lg text-lg leading-none">×</button>}
    </div>
  );
}

export function PageTitle({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
        {icon && <span className="w-9 h-9 rounded-xl bg-green-100 text-green-700 flex items-center justify-center">{icon}</span>}{title}
      </h1>
      {children}
    </div>
  );
}

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const icons: Record<string, React.ReactNode> = {
  home: <path d="M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10" />,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12h6M9 16h4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.6 3.5 6" /></>,
  car: <><path d="M4 16V12l2-5h12l2 5v4M3 16h18v3H3z" /><circle cx="7.5" cy="16" r="0.6" /><circle cx="16.5" cy="16" r="0.6" /></>,
  box: <path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4m0 0 9-4m-9 4v10" />,
  truck: <><path d="M2 6h11v10H2zM13 10h4l4 3v3h-8" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z" /><circle cx="16.5" cy="14.5" r="1" /></>,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  logout: <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
  money: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  trend: <path d="m3 17 6-6 4 4 8-9M15 6h6v6" />,
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5L10 21a2.1 2.1 0 0 1-3-3l9.5-9.5Z" />,
  alert: <path d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.5" />,
};
export function Icon({ name, className = "w-5 h-5" }: { name: keyof typeof icons | string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...P} aria-hidden>{icons[name] ?? icons.box}</svg>;
}
