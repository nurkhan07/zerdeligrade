import { AppShell } from "@/components/shell/app-shell";
import { requireContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <AppShell
      role={ctx.role}
      fullName={ctx.fullName}
      email={ctx.email}
      isHq={ctx.isHq}
      centers={ctx.centers.map(({ id, name, code, is_demo }) => ({ id, name, code, is_demo }))}
      activeCenterId={ctx.activeCenterId}
    >
      {children}
    </AppShell>
  );
}
