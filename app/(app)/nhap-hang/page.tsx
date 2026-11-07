"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { money, money2, qtyText } from "@/lib/format";
import { useRole } from "@/lib/role";

type Field = "name" | "code" | "qty" | "cost" | "sale" | "unit";
const FIELDS: { key: Field; label: string; aliases: string[] }[] = [
  { key: "name", label: "Tên hàng", aliases: ["ten hang", "ten phu tung", "ten vat tu", "ten san pham", "ten", "san pham", "mat hang", "hang hoa", "name", "item", "product", "description", "part name"] },
  { key: "code", label: "Mã phụ tùng", aliases: ["ma phu tung", "ma hang", "ma vat tu", "ma sp", "ma san pham", "ma", "sku", "code", "part number", "part no", "part code", "partno"] },
  { key: "qty", label: "Số lượng", aliases: ["so luong", "sl", "luong", "qty", "quantity", "amount"] },
  { key: "cost", label: "Giá nhập", aliases: ["gia nhap", "don gia nhap", "gia von", "don gia", "gia mua", "cost", "cost price", "unit cost", "purchase price", "buy price", "price"] },
  { key: "unit", label: "Đơn vị", aliases: ["don vi", "don vi tinh", "dvt", "unit", "uom"] },
  { key: "sale", label: "Giá bán", aliases: ["gia ban", "gia ban le", "don gia ban", "sale price", "selling price", "retail price", "sell price"] },
];
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Mapping = Record<Field, number>; // -1 = không dùng
type Raw = { headers: string[]; body: unknown[][] };
type Row = { id: number; name: string; code: string; qty: string; cost: string; sale: string; unitText: string; unit: "ban" | "nhap"; dvn: string; dvb: string; he: string };
type Part = { id: string; name: string; code: string | null; don_vi_nhap: string; don_vi_ban: string; he_so: number };
type Batch = { id: string; imported_on: string; supplier: string | null; note: string | null; item_count: number; total: number; created_by_name: string | null; da_huy: boolean; huy_ly_do: string | null; huy_boi: string | null; huy_luc: string | null };
type Log = { id: string; action: string; noi_dung: string | null; created_by_name: string | null; created_at: string };
type BatchItem = { id: string; part_id: string | null; name: string; code: string | null; qty: number; cost_price: number; sale_price: number | null; is_new: boolean; don_vi: string; so_luong_goc: number | null; don_vi_goc: string | null; gia_nhap_goc: number | null; he_so: number | null };

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
  const m: Mapping = { name: -1, code: -1, qty: -1, cost: -1, sale: -1, unit: -1 };
  const used = new Set<number>();
  const hs = headers.map(norm);
  // khớp chính xác trước, rồi mới khớp "chứa"; Giá bán xét trước Giá nhập để "đơn giá" không bị nhầm
  const order: Field[] = ["code", "sale", "qty", "unit", "name", "cost"];
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
  const [map, setMap] = useState<Mapping>({ name: -1, code: -1, qty: -1, cost: -1, sale: -1, unit: -1 });
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
  const [openLogs, setOpenLogs] = useState<Log[]>([]);
  const [hideable, setHideable] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; supplier: string; date: string; note: string } | null>(null);
  const [cancelling, setCancelling] = useState<{ id: string; reason: string; redo: boolean } | null>(null);

  const loadAll = useCallback(async () => {
    const [p, h] = await Promise.all([
      supabase.from("parts").select("id, name, code, don_vi_nhap, don_vi_ban, he_so"),
      supabase.from("stock_imports").select("*").order("imported_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    ]);
    if (p.error) return setError(p.error.message);
    if (h.error) return setError("Không đọc được lịch sử (đã chạy giai-doan-8.sql chưa?): " + h.error.message);
    setParts((p.data as Part[]).map((x) => ({ ...x, he_so: Number(x.he_so) })));
    setHistory(h.data as Batch[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (isOwner) loadAll(); }, [isOwner, loadAll]);
  const loadDetail = useCallback(async (id: string) => {
    const [it, lg, hd] = await Promise.all([
      supabase.from("stock_import_items").select("*").eq("import_id", id).order("name"),
      supabase.from("stock_import_logs").select("id, action, noi_dung, created_by_name, created_at").eq("import_id", id).order("created_at", { ascending: false }),
      supabase.rpc("phu_tung_an_duoc", { p_import: id }),
    ]);
    if (it.error) return setError(it.error.message);
    setOpenItems(it.data as BatchItem[]); setOpenLogs((lg.data ?? []) as Log[]);
    setHideable(new Set((hd.data ?? []) as string[]));
    setOpen(id);
  }, []);
  // Mở sẵn lần nhập khi đi từ sổ kho sang (?mo=<id>)
  useEffect(() => {
    const mo = new URLSearchParams(window.location.search).get("mo");
    if (!isOwner || !mo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail(mo);
  }, [isOwner, loadDetail]);

  function buildRows(r: Raw, m: Mapping): Row[] {
    const g = (row: unknown[], k: Field) => (m[k] >= 0 ? cellText(row[m[k]]) : "");
    return r.body.map((row, i) => {
      const code = g(row, "code").trim().toLowerCase(), name = g(row, "name").trim().toLowerCase(), unitText = g(row, "unit");
      const ex = code ? parts.find((p) => p.code?.toLowerCase() === code) : parts.find((p) => !p.code && p.name.trim().toLowerCase() === name);
      // Cột đơn vị trong file trùng đơn vị nhập (mà khác đơn vị bán) của món đã có -> hiểu là nhập theo đơn vị nhập
      const nhap = !!ex && !!unitText && norm(unitText) === norm(ex.don_vi_nhap) && norm(ex.don_vi_nhap) !== norm(ex.don_vi_ban);
      return { id: i, name: g(row, "name"), code: g(row, "code"), qty: g(row, "qty"), cost: g(row, "cost"), sale: g(row, "sale"),
        unitText, unit: nhap ? "nhap" : "ban", dvn: unitText || "cái", dvb: unitText || "cái", he: "1" } as Row;
    });
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
  const setCell = (id: number, k: Exclude<keyof Row, "id" | "unit"> | "unit", v: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
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
      else if (Math.round(qty * 1000) / 1000 !== qty) errs.push("Số lượng tối đa 3 chữ số thập phân");
      if (cost === null || cost < 0) errs.push("Thiếu hoặc sai giá nhập");
      if (r.sale.trim() && (sale === null || sale < 0)) errs.push("Giá bán không hợp lệ");
      if (code && (codeCount.get(code) ?? 0) > 1) errs.push("Trùng mã trong file — bỏ bớt dòng hoặc sửa mã");
      if (!code) warns.push("Không có mã (khớp theo tên)");
      const exist = (code ? byCode.get(code) : byName.get(r.name.trim().toLowerCase())) ?? null;
      const he = exist ? exist.he_so : parseNum(r.he) ?? 0;
      if (!exist && (!(he > 0) || Math.round(he * 1000) / 1000 !== he)) errs.push("Hệ số quy đổi phải lớn hơn 0 (tối đa 3 số lẻ)");
      if (!exist && (!r.dvn.trim() || !r.dvb.trim())) errs.push("Thiếu tên đơn vị nhập / đơn vị bán");
      if (exist && r.unitText.trim() && ![exist.don_vi_nhap, exist.don_vi_ban].some((u) => norm(u) === norm(r.unitText))) warns.push(`Đơn vị "${r.unitText}" trong file không trùng ${exist.don_vi_nhap}/${exist.don_vi_ban} của món này — đang hiểu theo bảng chọn bên dưới`);
      const dvNhap = exist ? exist.don_vi_nhap : r.dvn.trim(), dvBan = exist ? exist.don_vi_ban : r.dvb.trim();
      const qtyBan = qty !== null && he > 0 ? (r.unit === "nhap" ? Math.round(qty * he * 1000) / 1000 : qty) : null;
      const costBan = cost !== null && he > 0 ? (r.unit === "nhap" ? Math.round((cost / he) * 10000) / 10000 : cost) : null;
      return { errs, warns, qty, cost, sale, exist, he, dvNhap, dvBan, qtyBan, costBan };
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
      sale_price: checks[i].sale, don_vi: r.unit,
      ...(checks[i].exist ? {} : { don_vi_nhap: r.dvn.trim(), don_vi_ban: r.dvb.trim(), he_so: checks[i].he }),
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
    setEditing(null); setCancelling(null);
    await loadDetail(b.id);
  }

  async function saveEdit() {
    if (!editing) return;
    setError(""); setOk(""); setBusy(true);
    const { error } = await supabase.rpc("sua_lan_nhap", { p_id: editing.id, p_supplier: editing.supplier, p_date: editing.date, p_note: editing.note });
    setBusy(false);
    if (error) return setError(error.message);
    setOk("Đã lưu thông tin lần nhập (kho không đổi)."); setEditing(null);
    await loadAll(); await loadDetail(editing.id);
  }

  async function doCancel() {
    if (!cancelling) return;
    setError(""); setOk("");
    if (!cancelling.reason.trim()) return setError("Bắt buộc nhập lý do hủy.");
    const b = history.find((x) => x.id === cancelling.id);
    if (!b) return;
    if (!confirm(`Hủy phiếu nhập ngày ${new Date(b.imported_on).toLocaleDateString("vi-VN")} (${b.item_count} món)?\nTồn kho sẽ bị trừ lại đúng số lượng đã nhập. Không hoàn tác được.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("huy_lan_nhap", { p_id: b.id, p_ly_do: cancelling.reason });
    setBusy(false);
    if (error) return setError(error.message);
    const giu = (data as { giu_gia?: string } | null)?.giu_gia;
    const warn = giu ? ` Chưa khôi phục được giá nhập của: ${giu} (lần nhập cũ không lưu giá trước đó) — kiểm tra lại ở Phụ tùng.` : "";
    const redo = cancelling.redo;
    setCancelling(null);
    if (redo) {
      setSupplier(b.supplier ?? ""); setNote(b.note ?? ""); setDate(b.imported_on);
      setRaw({ headers: [], body: [] }); setFileName("");
      setRows(openItems.map((it, i) => ({ id: i, name: it.name, code: it.code ?? "", qty: String(it.qty), cost: String(it.cost_price), sale: it.sale_price === null ? "" : String(it.sale_price),
        unitText: "", unit: "ban" as const, dvn: it.don_vi_goc && it.he_so && it.he_so !== 1 && it.don_vi_goc !== it.don_vi ? it.don_vi_goc : it.don_vi, dvb: it.don_vi, he: String(it.he_so ?? 1) })));
      setOpen(null);
      setOk("Đã hủy phiếu cũ. Sửa lại dữ liệu bên dưới rồi bấm Xác nhận nhập hàng." + warn);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await loadAll();
    } else {
      setOk("Đã hủy phiếu nhập." + warn);
      await loadAll(); await loadDetail(b.id);
    }
  }

  async function hidePart(partId: string | null) {
    if (!partId || !open) return;
    if (!confirm("Ẩn phụ tùng này khỏi danh sách chọn? Lịch sử vẫn được giữ.")) return;
    const { error } = await supabase.rpc("an_phu_tung", { p_part: partId });
    if (error) return setError(error.message);
    setOk("Đã ẩn phụ tùng."); loadDetail(open);
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
          {raw.headers.length > 0 && <div className="bg-white rounded-xl shadow p-4 space-y-2">
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
          </div>}

          <div className="space-y-2">
            <div className="font-medium">{raw.headers.length > 0 ? "2. " : ""}Xem trước ({rows.length} dòng{errCount ? `, ${errCount} dòng cần sửa` : ""})</div>
            {rows.map((r, i) => {
              const c = checks[i];
              return (
                <div key={r.id} className={`bg-white rounded-xl shadow p-3 space-y-2 border-l-4 ${c.errs.length ? "border-red-500" : c.exist ? "border-blue-400" : "border-green-500"}`}>
                  <div className="flex justify-between items-center gap-2 text-xs">
                    <span className="text-slate-500">#{i + 1} · {c.exist ? `Đã có (${c.exist.don_vi_ban}): tồn +${c.qtyBan !== null ? qtyText(c.qtyBan) : "?"} ${c.dvBan}, cập nhật giá nhập` : "Món mới"}</span>
                    <button onClick={() => del(r.id)} className="text-red-600 text-sm">Bỏ dòng</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    <input className={`${input} col-span-2 sm:col-span-3`} placeholder="Tên hàng" value={r.name} onChange={(e) => setCell(r.id, "name", e.target.value)} />
                    <input className={`${input} col-span-2 sm:col-span-3`} placeholder="Mã" value={r.code} onChange={(e) => setCell(r.id, "code", e.target.value)} />
                    {!c.exist && <>
                      <label className="space-y-1"><span className={lbl}>Đơn vị nhập</span><input className={input} placeholder="can" value={r.dvn} onChange={(e) => setCell(r.id, "dvn", e.target.value)} /></label>
                      <label className="space-y-1"><span className={lbl}>Đơn vị bán</span><input className={input} placeholder="lít" value={r.dvb} onChange={(e) => setCell(r.id, "dvb", e.target.value)} /></label>
                      <label className="space-y-1 col-span-2 sm:col-span-2"><span className={lbl}>Hệ số: 1 {r.dvn || "nhập"} = ? {r.dvb || "bán"}</span><input inputMode="decimal" className={input} value={r.he} onChange={(e) => setCell(r.id, "he", e.target.value)} /></label>
                    </>}
                    {(!c.exist || c.dvNhap !== c.dvBan) && (
                      <label className="space-y-1 col-span-2 sm:col-span-3"><span className={lbl}>Nhập theo đơn vị</span>
                        <select className={input} value={r.unit} onChange={(e) => setCell(r.id, "unit", e.target.value)}>
                          <option value="ban">Đơn vị bán ({c.dvBan || "?"})</option>
                          <option value="nhap">Đơn vị nhập ({c.dvNhap || "?"})</option>
                        </select></label>
                    )}
                    <label className="space-y-1"><span className={lbl}>Số lượng{r.unit === "nhap" ? ` (${c.dvNhap})` : ` (${c.dvBan})`}</span><input inputMode="decimal" className={input} value={r.qty} onChange={(e) => setCell(r.id, "qty", e.target.value)} /></label>
                    <label className="space-y-1 sm:col-span-2"><span className={lbl}>Giá nhập mỗi {r.unit === "nhap" ? c.dvNhap : c.dvBan}</span><input inputMode="decimal" className={input} value={r.cost} onChange={(e) => setCell(r.id, "cost", e.target.value)} /></label>
                    <label className="space-y-1 sm:col-span-2"><span className={lbl}>Giá bán mỗi {c.dvBan}</span><input inputMode="numeric" className={input} value={r.sale} onChange={(e) => setCell(r.id, "sale", e.target.value)} /></label>
                    <div className="text-sm self-end pb-2 text-slate-600">{c.qty && c.cost ? money(Math.round(c.qty * c.cost)) : ""}</div>
                  </div>
                  {c.qtyBan !== null && c.costBan !== null && c.he > 0 && (r.unit === "nhap" || c.he !== 1) && (
                    <p className="text-xs text-slate-600">→ Tồn cộng thêm <b>{qtyText(c.qtyBan)} {c.dvBan}</b> · giá vốn mỗi {c.dvBan}: <b>{money2(c.costBan)}</b></p>
                  )}
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
                <span className={b.da_huy ? "line-through text-slate-500" : ""}>
                  <span className="font-medium">{new Date(b.imported_on).toLocaleDateString("vi-VN")}</span>
                  <span className="text-slate-500"> · {b.supplier || "Chưa ghi nhà cung cấp"}</span>
                </span>
                <span className="block text-xs text-slate-500">{b.item_count} món{b.note ? ` · ${b.note}` : ""}{b.created_by_name ? ` · ${b.created_by_name}` : ""}</span>
                {b.da_huy && <span className="block text-xs text-red-600">Đã hủy · {b.huy_boi ?? "Không rõ"} · {b.huy_luc ? new Date(b.huy_luc).toLocaleString("vi-VN") : ""} · Lý do: {b.huy_ly_do}</span>}
              </span>
              <span className={`font-medium shrink-0 ${b.da_huy ? "line-through text-slate-400" : ""}`}>{money(b.total)}</span>
            </button>
            {open === b.id && (
              <div className="space-y-3 border-t pt-2">
                <ul className="text-sm divide-y">
                  {openItems.map((it) => (
                    <li key={it.id} className="py-1.5 space-y-0.5">
                      <div className="flex justify-between gap-2">
                        <span>{it.name}{it.code ? <span className="text-slate-500"> · {it.code}</span> : <span className="text-slate-400"> · không mã</span>}{it.is_new ? <span className="ml-1 text-xs text-green-700">(mới)</span> : null}</span>
                        <b className="shrink-0">{money(Math.round(it.so_luong_goc !== null && it.gia_nhap_goc !== null ? it.so_luong_goc * it.gia_nhap_goc : it.qty * it.cost_price))}</b>
                      </div>
                      <div className="text-xs text-slate-600">
                        SL {qtyText(it.so_luong_goc ?? it.qty)} {it.don_vi_goc ?? it.don_vi} × giá nhập {money2(it.gia_nhap_goc ?? it.cost_price)}
                        {it.so_luong_goc !== null && it.so_luong_goc !== it.qty ? ` → tồn +${qtyText(it.qty)} ${it.don_vi} (vốn ${money2(it.cost_price)}/${it.don_vi})` : ""}
                      </div>
                      {b.da_huy && it.is_new && hideable.has(it.part_id ?? "") && (
                        <button onClick={() => hidePart(it.part_id)} className="text-xs text-amber-700 border border-amber-300 rounded px-2 py-1">Ẩn phụ tùng này (tồn 0, chưa dùng)</button>
                      )}
                    </li>
                  ))}
                </ul>
                {!b.da_huy && !editing && !cancelling && (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setEditing({ id: b.id, supplier: b.supplier ?? "", date: b.imported_on, note: b.note ?? "" })} className="border rounded-lg px-3 py-2 text-sm">Sửa thông tin</button>
                    <button onClick={() => setCancelling({ id: b.id, reason: "", redo: false })} className="border border-red-300 text-red-700 rounded-lg px-3 py-2 text-sm">Hủy phiếu nhập</button>
                    <button onClick={() => setCancelling({ id: b.id, reason: "", redo: true })} className="border border-amber-300 text-amber-700 rounded-lg px-3 py-2 text-sm">Hủy và nhập lại</button>
                  </div>
                )}
                {editing?.id === b.id && (
                  <div className="space-y-2 bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Chỉ sửa thông tin, không đổi kho. Muốn đổi số lượng/giá: dùng &quot;Hủy và nhập lại&quot;.</p>
                    <input type="date" className={input} value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
                    <input className={input} placeholder="Nhà cung cấp" value={editing.supplier} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} />
                    <input className={input} placeholder="Ghi chú" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={saveEdit} className="bg-green-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Lưu</button>
                      <button onClick={() => setEditing(null)} className="border rounded-lg px-4 py-2">Đóng</button>
                    </div>
                  </div>
                )}
                {cancelling?.id === b.id && (
                  <div className="space-y-2 bg-red-50 rounded-lg p-3">
                    <p className="text-sm text-red-700">{cancelling.redo ? "Hủy phiếu này rồi mở lại màn hình nhập với dữ liệu cũ để sửa." : "Hủy phiếu: tồn kho sẽ bị trừ lại đúng số lượng đã nhập."}</p>
                    <input className={input} placeholder="Lý do hủy (bắt buộc)" value={cancelling.reason} onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })} />
                    <div className="flex gap-2">
                      <button disabled={busy || !cancelling.reason.trim()} onClick={doCancel} className="bg-red-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Đang hủy..." : cancelling.redo ? "Hủy và nhập lại" : "Xác nhận hủy"}</button>
                      <button onClick={() => setCancelling(null)} className="border rounded-lg px-4 py-2">Đóng</button>
                    </div>
                  </div>
                )}
                {openLogs.length > 0 && (
                  <div className="text-xs text-slate-500 space-y-1">
                    <b>Nhật ký</b>
                    {openLogs.map((l) => <div key={l.id}>{new Date(l.created_at).toLocaleString("vi-VN")} · {l.created_by_name ?? "Không rõ"} · {l.noi_dung}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {history.length === 0 && <p className="text-sm text-slate-500">Chưa có lần nhập nào.</p>}
      </div>
    </div>
  );
}
