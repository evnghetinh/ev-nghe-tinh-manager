"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money, tonText } from "@/lib/format";
import { tenXe } from "@/lib/format";
import { Icon, StatusBadge } from "@/components/ui";

type Kh = { id: string; name: string; phone: string | null; xe: string; no: number };
type Xe = { id: string; customer_id: string; plate: string; hang_xe: string | null; dong_xe: string | null; chu: string };
type Ph = { id: string; code: number; plate: string; khach: string; status: string; ngay: string | null };
type Pt = { id: string; name: string; code: string | null; stock: number; don_vi_ban: string; don_vi_nhap: string; he_so: number };
type KetQua = { khach: Kh[]; xe: Xe[]; phieu: Ph[]; phu_tung: Pt[] };
type Muc = { key: string; href: string; nhom: string };

const maPhieu = (n: number) => "PT" + String(n).padStart(4, "0");
const fmtNgay = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");

/** Ô tìm kiếm trên cùng: gõ từ 2 ký tự, chờ 250ms rồi tìm; kết quả nhóm theo loại. */
export function TimKiem() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [kq, setKq] = useState<KetQua | null>(null);
  const [dangTim, setDangTim] = useState(false);
  const [loi, setLoi] = useState("");
  const [mo, setMo] = useState(false);
  const [chon, setChon] = useState(-1);
  const goc = useRef<HTMLFormElement>(null);
  const lanTim = useRef(0);
  const du = q.trim().length >= 2;

  // Chờ 250ms sau khi ngừng gõ rồi mới tìm
  useEffect(() => {
    if (!du) return;
    const lan = ++lanTim.current;
    const t = setTimeout(async () => {
      setDangTim(true);
      const { data, error } = await supabase.rpc("tim_kiem_tong", { p_q: q.trim() });
      if (lan !== lanTim.current) return; // đã có lần gõ mới hơn
      setDangTim(false);
      if (error) { setLoi(error.message + " (đã chạy giai-doan-27.sql chưa?)"); setKq(null); return; }
      setLoi("");
      const d = data as KetQua;
      setKq({ khach: d.khach ?? [], xe: d.xe ?? [], phieu: d.phieu ?? [], phu_tung: d.phu_tung ?? [] });
      setChon(-1);
    }, 250);
    return () => clearTimeout(t);
  }, [q, du]);

  // Đổi trang thì đóng; bấm ra ngoài thì đóng
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMo(false); }, [pathname]);
  useEffect(() => {
    const out = (e: Event) => { if (goc.current && !goc.current.contains(e.target as Node)) setMo(false); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, []);

  const co = du && kq !== null;
  const tong = co ? kq.khach.length + kq.xe.length + kq.phieu.length + kq.phu_tung.length : 0;
  const hienKq = mo && du;

  const muc = useMemo<Muc[]>(() => {
    if (!kq) return [];
    return [
      ...kq.khach.map((k) => ({ key: "k" + k.id, href: `/khach-hang/${k.id}`, nhom: "khach" })),
      ...kq.xe.map((x) => ({ key: "x" + x.id, href: `/khach-hang/${x.customer_id}`, nhom: "xe" })),
      ...kq.phieu.map((p) => ({ key: "p" + p.id, href: `/tiep-nhan/${p.id}`, nhom: "phieu" })),
      ...kq.phu_tung.map((p) => ({ key: "t" + p.id, href: `/phu-tung/${p.id}`, nhom: "phu_tung" })),
    ];
  }, [kq]);

  function di(href: string) { setMo(false); setQ(""); setKq(null); router.push(href); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setMo(false); return; }
    if (!hienKq || muc.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setChon((c) => (c + 1) % muc.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setChon((c) => (c <= 0 ? muc.length - 1 : c - 1)); }
  }
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hienKq || muc.length === 0) return;
    di(muc[chon >= 0 ? chon : 0].href);
  }

  const idx = (key: string) => muc.findIndex((m) => m.key === key);
  const hang = (key: string, href: string, children: React.ReactNode) => {
    const i = idx(key);
    return (
      <button key={key} type="button" role="option" aria-selected={i === chon} onClick={() => di(href)} onMouseEnter={() => setChon(i)}
        ref={(el) => { if (el && i === chon) el.scrollIntoView({ block: "nearest" }); }}
        className={`bare w-full text-left px-3 py-2 min-h-11 flex items-start justify-between gap-3 border-b border-slate-100 ${i === chon ? "bg-sky-50" : "bg-white"}`}>
        {children}
      </button>
    );
  };
  const tieuDe = (t: string) => <div className="px-3 py-1.5 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600 sticky top-0">{t}</div>;
  const moiKhach = encodeURIComponent(q.trim());

  return (
    <form onSubmit={onSubmit} className="flex-1 max-w-xl md:relative" role="search">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" className="w-5 h-5" /></span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setMo(true); if (e.target.value.trim().length < 2) setKq(null); }}
          onFocus={() => setMo(true)} onKeyDown={onKey}
          placeholder="Tìm khách, xe, phiếu, phụ tùng..." aria-label="Tìm kiếm" autoComplete="off" enterKeyHint="search"
          role="combobox" aria-expanded={hienKq} aria-controls="kq-tim-kiem"
          className="w-full !pl-10 !bg-slate-100 !border-transparent" />
      </div>
      {hienKq && (
        <div id="kq-tim-kiem" role="listbox"
          className="absolute left-0 right-0 top-full md:mt-1 md:right-auto md:w-[min(40rem,calc(100vw-20rem))] max-h-[calc(100dvh-8.5rem)] md:max-h-[70vh] overflow-y-auto overscroll-contain bg-white border-y md:border md:rounded-xl border-slate-200 shadow-xl">
          {dangTim && !co && <div className="px-3 py-3 text-sm text-slate-500">Đang tìm...</div>}
          {loi && <div className="px-3 py-3 text-sm text-red-700 bg-red-50">{loi}</div>}
          {co && !loi && (
            <>
              {kq.khach.length > 0 && tieuDe("Khách hàng")}
              {kq.khach.map((k) => hang("k" + k.id, `/khach-hang/${k.id}`, (
                <>
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900 break-words">{k.name}</span>
                    <span className="block text-sm text-slate-500 break-words">{[k.phone, k.xe].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <span className={`text-sm shrink-0 text-right ${k.no > 0 ? "font-semibold text-red-700" : "text-slate-400"}`}>{k.no > 0 ? `Nợ ${money(Number(k.no))}` : "Không nợ"}</span>
                </>
              )))}
              {kq.xe.length > 0 && tieuDe("Xe")}
              {kq.xe.map((x) => hang("x" + x.id, `/khach-hang/${x.customer_id}`, (
                <>
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900">{x.plate}</span>
                    <span className="block text-sm text-slate-500 break-words">{tenXe(x) || "Chưa ghi hãng/dòng xe"}</span>
                  </span>
                  <span className="text-sm text-slate-600 shrink-0 text-right max-w-[45%] break-words">Chủ: {x.chu}</span>
                </>
              )))}
              {kq.phieu.length > 0 && tieuDe("Phiếu")}
              {kq.phieu.map((p) => hang("p" + p.id, `/tiep-nhan/${p.id}`, (
                <>
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900">{maPhieu(p.code)} · {p.plate}</span>
                    <span className="block text-sm text-slate-500 break-words">{p.khach}{p.ngay ? ` · ${fmtNgay(p.ngay)}` : ""}</span>
                  </span>
                  <StatusBadge status={p.status} />
                </>
              )))}
              {kq.phu_tung.length > 0 && tieuDe("Phụ tùng")}
              {kq.phu_tung.map((p) => hang("t" + p.id, `/phu-tung/${p.id}`, (
                <>
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900 break-words">{p.name}</span>
                    <span className="block text-sm text-slate-500">{p.code ? `Mã: ${p.code}` : "Chưa có mã"}</span>
                  </span>
                  <span className="text-sm text-slate-600 shrink-0 text-right max-w-[45%]">Tồn: {tonText(Number(p.stock), { ...p, he_so: Number(p.he_so) })}</span>
                </>
              )))}
              {tong === 0 && (
                <div className="p-4 space-y-3">
                  <p className="text-slate-600">Không tìm thấy</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button type="button" className="btn-secondary" onClick={() => di(`/khach-hang?them=${moiKhach}`)}>Thêm khách mới</button>
                    <button type="button" className="btn-primary" onClick={() => di(`/tiep-nhan?moi=${moiKhach}`)}>Tiếp nhận xe mới</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </form>
  );
}
