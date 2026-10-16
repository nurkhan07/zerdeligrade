import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t.common.appName, template: `%s · ${t.common.appName}` },
    description: t.common.tagline,
    robots: { index: false, follow: false },
    other: { google: "notranslate" },
    icons: { icon: "/favicon.ico" },
  };
}

export const viewport: Viewport = { themeColor: "#7b4fd6", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html>
    // (e.g. data-*-nonce), which is not a real mismatch in our markup.
    // translate="no": the UI is already in Kazakh/Russian; browser auto-translation
    // rewrites text nodes that React owns and breaks the page.
    <html lang={locale} className={plex.variable} translate="no" suppressHydrationWarning>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
