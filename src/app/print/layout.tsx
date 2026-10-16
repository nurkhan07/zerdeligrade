import { requireContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

/** Print views: no dashboard chrome, white background, A4 pages. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireContext();
  return <div className="min-h-dvh bg-neutral-200 print:bg-white">{children}</div>;
}
