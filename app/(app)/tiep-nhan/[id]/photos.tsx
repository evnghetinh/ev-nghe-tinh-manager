"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/photo";
import { useRole } from "@/lib/role";

const LABELS = ["Lúc nhận xe", "Đang sửa", "Lúc giao xe"] as const;
const MAX = 12;
type Photo = { id: string; path: string; label: string; note: string | null; uploaded_by_name: string | null; created_at: string; url?: string };

export default function Photos({ orderId }: { orderId: string }) {
  const isOwner = useRole() === "chu";
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [label, setLabel] = useState<string>(LABELS[0]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Photo | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("order_photos").select("id, path, label, note, uploaded_by_name, created_at").eq("order_id", orderId).order("created_at");
    if (error) return setMsg(error.message);
    const list = (data ?? []) as Photo[];
    if (list.length) {
      const s = await supabase.storage.from("phieu-anh").createSignedUrls(list.map((p) => p.path), 3600);
      s.data?.forEach((d, i) => { list[i].url = d.signedUrl ?? undefined; });
    }
    setPhotos(list);
  }, [orderId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setMsg("");
    const room = MAX - photos.length;
    if (room <= 0) return setMsg(`Phiếu đã đủ ${MAX} ảnh.`);
    const use = files.slice(0, room);
    setBusy(true);
    const errs: string[] = [];
    if (files.length > room) errs.push(`Chỉ còn chỗ cho ${room} ảnh, đã bỏ ${files.length - room} ảnh.`);
    for (const f of use) {
      try {
        const blob = await compressImage(f);
        const path = `${orderId}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("phieu-anh").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const ins = await supabase.from("order_photos").insert({ order_id: orderId, path, label, note: note.trim() || null });
        if (ins.error) { await supabase.storage.from("phieu-anh").remove([path]); throw ins.error; }
      } catch (err) { errs.push(`${f.name}: ${(err as Error).message}`); }
    }
    setBusy(false);
    setNote("");
    if (errs.length) setMsg(errs.join(" "));
    load();
  }

  async function remove(p: Photo) {
    if (!confirm("Xóa ảnh này? Không thể khôi phục.")) return;
    const { error } = await supabase.from("order_photos").delete().eq("id", p.id);
    if (error) return setMsg(error.message);
    await supabase.storage.from("phieu-anh").remove([p.path]);
    setView(null); load();
  }

  const input = "w-full border rounded-lg px-3 py-2";
  const full = photos.length >= MAX;
  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-3">
      <h2 className="font-bold">Hình ảnh ({photos.length}/{MAX})</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className={input} value={label} onChange={(e) => setLabel(e.target.value)}>
          {LABELS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <input className={input} maxLength={200} placeholder="Ghi chú ngắn (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy || full} onClick={() => cam.current?.click()} className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">📷 Chụp ảnh</button>
        <button disabled={busy || full} onClick={() => lib.current?.click()} className="border border-blue-600 text-blue-600 rounded-lg px-4 py-2 disabled:opacity-50">Chọn nhiều ảnh</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
        <input ref={lib} type="file" accept="image/*" multiple className="hidden" onChange={pick} />
      </div>
      {busy && <p className="text-sm text-slate-500">Đang nén và tải ảnh lên, vui lòng chờ...</p>}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {photos.length === 0 && <p className="text-sm text-slate-500">Chưa có ảnh nào.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {photos.map((p) => (
          <button key={p.id} onClick={() => setView(p)} className="text-left border rounded-lg overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.url ? <img src={p.url} alt={p.label} loading="lazy" className="w-full aspect-square object-cover bg-slate-100" /> : <div className="aspect-square bg-slate-100" />}
            <div className="p-1.5 text-xs"><b>{p.label}</b><br />{new Date(p.created_at).toLocaleString("vi-VN")}</div>
          </button>
        ))}
      </div>
      {view && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-3" onClick={() => setView(null)}>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {view.url && <img src={view.url} alt={view.label} className="max-w-full max-h-full object-contain" />}
          </div>
          <div className="text-white text-sm pt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
            <div><b>{view.label}</b> · {new Date(view.created_at).toLocaleString("vi-VN")} · {view.uploaded_by_name ?? "Không rõ"}</div>
            {view.note && <div>{view.note}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setView(null)} className="bg-white text-black rounded-lg px-4 py-2">Đóng</button>
              {isOwner && <button onClick={() => remove(view)} className="bg-red-600 text-white rounded-lg px-4 py-2">Xóa ảnh</button>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
