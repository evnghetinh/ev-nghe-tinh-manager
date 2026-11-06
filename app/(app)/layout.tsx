import { Suspense } from "react";
import AppShell from "./shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-6 text-slate-500">Đang tải...</p>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
