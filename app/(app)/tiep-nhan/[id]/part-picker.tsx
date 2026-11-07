"use client";
import { useMemo, useState } from "react";
import { money, tonText, type DonVi } from "@/lib/format";

type P = { id: string; name: string; code: string | null; sale_price: number; stock: number } & DonVi;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export default function PartPicker({ parts, value, onChange, className }: { parts: P[]; value: string; onChange: (id: string) => void; className: string }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const list = useMemo(() => {
    const q = norm(text.trim());
    const f = q ? parts.filter((p) => norm(p.name).includes(q) || norm(p.code || "").includes(q)) : parts;
    return f.slice(0, 50);
  }, [parts, text]);

  function pick(p: P) {
    onChange(p.id);
    setText(`${p.name}${p.code ? ` (${p.code})` : ""}`);
    setOpen(false);
  }

  // khi phiếu được thêm xong, value được đặt lại "" -> xóa ô
  if (!value && text && !open && parts.some((p) => text === `${p.name}${p.code ? ` (${p.code})` : ""}`)) setText("");

  return (
    <div className="relative">
      <input
        className={className}
        placeholder="Gõ tên hoặc mã phụ tùng..."
        value={text}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); onChange(""); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border rounded-lg shadow-lg">
          {list.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Không tìm thấy phụ tùng</li>}
          {list.map((p, i) => (
            <li
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHi(i)}
              className={`px-3 py-2 text-sm cursor-pointer border-b last:border-0 ${i === hi ? "bg-green-50" : ""}`}
            >
              <div className="font-medium">{p.name}{p.code ? <span className="text-slate-500 font-normal"> ({p.code})</span> : null}</div>
              <div className="text-xs text-slate-600">Giá bán {money(p.sale_price)}/{p.don_vi_ban} · tồn {tonText(p.stock, p)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
