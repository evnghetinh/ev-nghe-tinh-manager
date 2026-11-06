"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { useRole } from "@/lib/role";

type Field = "name" | "code" | "qty" | "cost" | "sale";
const FIELDS: { key: Field; label: string; aliases: string[] }[] = [
  { key: "name", label: "Tên hàng", aliases: ["ten hang", "ten phu tung", "ten vat tu", "ten san pham", "ten", "san pham", "mat hang", "hang hoa", "name", "item", "product", "description", "part name"] },
  { key: "code", label: "Mã phụ tùng", aliases: ["ma phu tung", "ma hang", "ma vat tu", "ma sp", "ma san pham", "ma", "sku", "code", "part number", "part no", "part code", "partno"] },
  { key: "qty", label: "Số lượng", aliases: ["so luong", "sl", "luong", "qty", "quantity", "amount"] },
  { key: "cost", label: "Giá nhập", aliases: ["gia nhap", "don gia nhap", "gia von", "don gia", "gia mua", "cost", "cost price", "unit cost", "purchase price", "buy price", "price"] },
  { key: "sale", label: "Giá bán", aliases: ["gia ban", "gia ban le", "don gia ban", "sale price", "selling price", "retail price", "sell price"] },
];
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Mapping = Record<Field, number>; // -1 = không dùng
type Raw = { headers: string[]; body: unknown[][] };
type Row = { id: number; name: string; code: string; qty: string; cost: string; sale: string };
type Part = { id: string; name: string; code: string | null };
type Batch = { id: string; imported_on: string; supplier: string | null; note: string | null; item_count: number; total: number; created_by_name: string | null };
type BatchItem = { id: string; name: string; code: string | null; qty: number; cost_price: number; sale_price: number | null; is_new: boolean };

function parseNum(v: string): number | null {
  const s = v.replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  let t = s;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) t = s.replace(/[.,]/g, "");
  else if (s.includes(",") && s.includes(".")) {
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    t = s.split(dec === "," ? "." : ",").join("").replace(dec, ".");
  } else t = s.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const cellText = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function detect(headers: string[]): Mapping {
  const m: Mapping = { name: -1, code: -1, qty: -1, cost: -1, sale: -1 };
  const used = new Set<number>();
  const hs = headers.map(norm);
  // khớp chính xác trước, rồi mới khớp "chứa"; Giá bán xét trước Giá nhập để "đơn giá" không bị nhầm
  const order: Field[] = ["code", "sale", "qty", "name", "cost"];
  for (const pass of [0, 1]) {
    for (const k of order) {
      if (m[k] >= 0) continue;
      const al = FIELDS.find((f) => f.key === k)!.aliases;
      const i = hs.findIndex((h, idx) => !used.has(idx) && h !== "" && (pass === 0 ? al.includes(h) : al.some((a) => a.length > 3 && h.includes(a))));
      if (i >= 0) { m[k] = i; used.add(i); }
    }
  }
  return m;
}

export default function ImportPage() {
  const isOwner = useRole() === "chu";
  const [raw, setRaw] = useState<Raw | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({ name: -1, code: -1, qty: -1, cost: -1, sale: -1 });
  const [rows, setRows] = useState<Row[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [history, setHistory] = useState<Batch[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<BatchItem[]>([]);

  const loadAll = useCallback(async () => {
    const [p, h] = await Promise.all([
      supabase.from("parts").select("id, name, code"),
      supabase.from("stock_imports").select("*").order("imported_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    ]);
    if (p.error) return setError(p.error.message);
    if (h.error) return setError("Không đọc được lịch sử (đã chạy giai-doan-8.sql chưa?): " + h.error.message);
    setParts(p.data as Part[]);
    setHistory(h.data as Batch[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (isOwner) loadAll(); }, [isOwner, loadAll]);

  function buildRows(r: Raw, m: Mapping): Row[] {
    const g = (row: unknown[], k: Field) => (m[k] >= 0 ? cellText(row[m[k]]) : "");
    return r.body.map((row, i) => ({ id: i, name: g(row, "name"), code: g(row, "code"), qty: g(row, "qty"), cost: g(row, "cost"), sale: g(row, "sale") }));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(""); setOk("");
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) return setError("Chỉ nhận file .xlsx, .xls hoặc .csv.");
    if (f.size > 5 * 1024 * 1024) return setError("File quá lớn (tối đa 5MB).");
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) return setError("File không có dữ liệu.");
      const all = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false }) as unknown[][])
        .filter((r) => r.some((c) => cellText(c) !== ""));
      if (all.length < 2) return setError("File cần có dòng tiêu đề và ít nhất 1 dòng hàng.");
      // tìm dòng tiêu đề: trong 10 dòng đầu, dòng khớp nhiều cột nhất
      let hi = 0, best = -1;
      all.slice(0, 10).forEach((r, i) => {
        const d = detect(r.map(cellText));
        const score = Object.values(d).filter((x) => x >= 0).length;
        if (score > best) { best = score; hi = i; }
      });
      const width = Math.max(...all.map((r) => r.length));
      const headers = Array.from({ length: width }, (_, i) => cellText(all[hi][i]) || `Cột ${i + 1}`);
      const body = all.slice(hi + 1).slice(0, 1000);
      const r: Raw = { headers, body };
      const m = detect(headers);
      setRaw(r); setMap(m); setFileName(f.name); setRows(buildRows(r, m));
      if (all.length - hi - 1 > 1000) setError("File có hơn 1000 dòng, chỉ lấy 1000 dòng đầu. Hãy chia nhỏ file.");
    } catch {
      setError("Không đọc được file. Hãy kiểm tra lại file Excel/CSV.");
    }
  }

  function changeMap(k: Field, v: number) {
    if (!raw) return;
    const m = { ...map, [k]: v };
    setMap(m); setRows(buildRows(raw, m));
  }
  const setCell = (id: number, k: Field, v: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const del = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));
  function reset() { setRaw(null); setRows([]); setFileName(""); setError(""); }

  const checks = useMemo(() => {
    const codeCount = new Map<string, number>();
    rows.forEach((r) => { const c = r.code.trim().toLowerCase(); if (c) codeCount.set(c, (codeCount.get(c) ?? 0) + 1); });
    const byCode = new Map(parts.filter((p) => p.code).map((p) => [p.code!.toLowerCase(), p]));
    const byName = new Map(parts.filter((p) => !p.code).map((p) => [p.name.trim().toLowerCase(), p]));
    return rows.map((r) => {
      const errs: string[] = [], warns: string[] = [];
      const code = r.code.trim().toLowerCase();
      const qty = parseNum(r.qty), cost = parseNum(r.cost), sale = r.sale.trim() ? parseNum(r.sale) : null;
      if (!r.name.trim()) errs.push("Thiếu tên hàng");
      if (qty === null || qty <= 0) errs.push("Số lượng phải lớn hơn 0");
      if (cost === null || cost < 0) errs.push("Thiếu hoặc sai giá nhập");
      if (r.sale.trim() && (sale === null || sale < 0)) errs.push("Giá bán không hợp lệ");
      if (code && (codeCount.get(code) ?? 0) > 1) errs.push("Trùng mã trong file — bỏ bớt dòng hoặc sửa mã");
      if (!code) warns.push("Không có mã (khớp theo tên)");
      const exist = code ? byCode.get(code) : byName.get(r.name.trim().toLowerCase());
      return { errs, warns, qty, cost, sale, exist: exist ?? null };
    });
  }, [rows, parts]);

  const errCount = checks.filter((c) => c.errs.length).length;
  const total = checks.reduce((s, c) => s + (c.qty && c.cost ? c.qty * c.cost : 0), 0);
  const newCount = checks.filter((c) => !c.exist).length;

  async function confirmImport() {
    setError(""); setOk("");
    if (rows.length === 0 || errCount > 0) return;
    if (!confirm(`Xác nhận nhập ${rows.length} món (${newCount} món mới), tổng ${money(Math.round(total))}?\nTồn kho và giá nhập sẽ được cập nhật.`)) return;
    setBusy(true);
    const items = rows.map((r, i) => ({
      name: r.name.trim(), code: r.code.trim() || null, qty: checks[i].qty, cost_price: checks[i].cost,
      sale_price: checks[i].sale,
    }));
    const { error } = await supabase.rpc("nhap_hang", { p_supplier: supplier, p_date: date, p_note: note, p_items: items });
    setBusy(false);
    if (error) return setError("Chưa lưu gì cả. Lỗi: " + error.message);
    setOk(`Đã nhập ${rows.length} món, tổng ${money(Math.round(total))}.`);
    reset(); setSupplier(""); setNote("");
    loadAll();
  }

  async function toggle(b: Batch) {
    if (open === b.id) return setOpen(null);
    const { data, error } = await supabase.from("stock_import_items").select("*").eq("import_id", b.id).order("name");
    if (error) return setError(error.message);
    setOpenItems(data as BatchItem[]); setOpen(b.id);
  }

  if (!isOwner) return <p className="text-slate-500">Mục này chỉ dành cho Chủ xưởng.</p>;

  const input = "w-full border rounded-lg px-3 py-2";
  const lbl = "text-xs text-slate-500";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Nhập hàng</h1>

      <div className="bg-white rounded-xl shadow p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1"><span className={lbl}>Ngày nhập</span>
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="space-y-1 sm:col-span-2"><span className={lbl}>Nhà cung cấp</span>
            <input className={input} placeholder="Tên nhà cung cấp" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
        </div>
        <label className="space-y-1 block"><span className={lbl}>Ghi chú (không bắt buộc)</span>
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="block">
          <span className="inline-block bg-green-600 text-white rounded-lg px-4 py-2 cursor-pointer">Chọn file Excel / CSV</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          {fileName && <span className="ml-3 text-sm text-slate-600 break-all">{fileName}</span>}
        </label>
        <p className="text-xs text-slate-500">Cột nên có: Tên hàng, Mã phụ tùng, Số lượng, Giá nhập, (Giá bán). Chưa lưu gì cho đến khi bạn bấm Xác nhận.</p>
      </div>

      {error && <p className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>}
      {ok && <p className="text-sm text-green-700">{ok}</p>}

      {raw && (
        <>
          <div className="bg-white rounded-xl shadow p-4 space-y-2">
            <div className="font-medium">1. Kiểm tra cột</div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
              {FIELDS.map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className={lbl}>{f.label}{f.key === "sale" || f.key === "code" ? "" : " *"}</span>
                  <select className={input} value={map[f.key]} onChange={(e) => changeMap(f.key, Number(e.target.value))}>
                    <option value={-1}>— Không có —</option>
                    {raw.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium">2. Xem trước ({rows.length} dòng{errCount ? `, ${errCount} dòng cần sửa` : ""})</div>
            {rows.map((r, i) => {
              const c = checks[i];
              return (
                <div key={r.id} className={`bg-white rounded-xl shadow p-3 space-y-2 border-l-4 ${c.errs.length ? "border-red-500" : c.exist ? "border-blue-400" : "border-green-500"}`}>
                  <div className="flex justify-between items-center gap-2 text-xs">
                    <span className="text-slate-500">#{i + 1} · {c.exist ? `Đã có: tồn ${"+"}${c.qty ?? "?"}, cập nhật giá nhập` : "Món mới"}</span>
                    <button onClick={() => del(r.id)} className="text-red-600 text-sm">Bỏ dòng</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    <input className={`${input} col-span-2 sm:col-span-3`} placeholder="Tên hàng" value={r.name} onChange={(e) => setCell(r.id, "name", e.target.value)} />
                    <input className={`${input} col-span-2 sm:col-span-3`} placeholder="Mã" value={r.code} onChange={(e) => setCell(r.id, "code", e.target.value)} />
                    <label className="space-y-1"><span className={lbl}>Số lượng</span><input inputMode="decimal" className={input} value={r.qty} onChange={(e) => setCell(r.id, "qty", e.target.value)} /></label>
                    <label className="space-y-1 sm:col-span-2"><span className={lbl}>Giá nhập</span><input inputMode="numeric" className={input} value={r.cost} onChange={(e) => setCell(r.id, "cost", e.target.value)} /></label>
                    <label className="space-y-1 sm:col-span-2"><span className={lbl}>Giá bán</span><input inputMode="numeric" className={input} value={r.sale} onChange={(e) => setCell(r.id, "sale", e.target.value)} /></label>
                    <div className="text-sm self-end pb-2 text-slate-600">{c.qty && c.cost ? money(Math.round(c.qty * c.cost)) : ""}</div>
                  </div>
                  {c.errs.map((m) => <p key={m} className="text-xs text-red-600">⚠ {m}</p>)}
                  {c.warns.map((m) => <p key={m} className="text-xs text-amber-600">• {m}</p>)}
                </div>
              );
            })}
            {rows.length === 0 && <p className="text-sm text-slate-500">Không còn dòng nào.</p>}
          </div>

          <div className="sticky bottom-16 md:bottom-0 bg-white rounded-xl shadow p-3 flex flex-wrap items-center gap-3 justify-between">
            <div className="text-sm">Tổng tiền nhập: <b>{money(Math.round(total))}</b>{errCount ? <span className="text-red-600"> · còn {errCount} dòng lỗi</span> : null}</div>
            <div className="flex gap-2">
              <button onClick={reset} className="border rounded-lg px-4 py-2">Hủy</button>
              <button disabled={busy || errCount > 0 || rows.length === 0} onClick={confirmImport}
                className="bg-green-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">{busy ? "Đang lưu..." : "Xác nhận nhập hàng"}</button>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <h2 className="font-bold">Lịch sử nhập hàng</h2>
        {history.map((b) => (
          <div key={b.id} className="bg-white rounded-xl shadow p-3 space-y-2">
            <button onClick={() => toggle(b)} className="w-full text-left flex justify-between gap-2">
              <span>
                <span className="font-medium">{new Date(b.imported_on).toLocaleDateString("vi-VN")}</span>
                <span className="text-slate-500"> · {b.supplier || "Chưa ghi nhà cung cấp"}</span>
                <span className="block text-xs text-slate-500">{b.item_count} món{b.note ? ` · ${b.note}` : ""}{b.created_by_name ? ` · ${b.created_by_name}` : ""}</span>
              </span>
              <span className="font-medium shrink-0">{money(b.total)}</span>
            </button>
            {open === b.id && (
              <ul className="text-sm divide-y border-t">
                {openItems.map((it) => (
                  <li key={it.id} className="py-1.5 flex justify-between gap-2">
                    <span>{it.name}{it.code ? <span className="text-slate-500"> · {it.code}</span> : null}{it.is_new ? <span className="ml-1 text-xs text-green-700">(mới)</span> : null}</span>
                    <span className="text-slate-600 shrink-0">{it.qty} × {money(it.cost_price)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {history.length === 0 && <p className="text-sm text-slate-500">Chưa có lần nhập nào.</p>}
      </div>
    </div>
  );
}
