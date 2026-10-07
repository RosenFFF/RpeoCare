import type { Metadata } from "next";
import Script from "next/script";
import { appearanceBootstrap } from "@/shared/lib/appearance";
import "./globals.css";
import "./appearance.css";

export const metadata: Metadata = {
  icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
  title: "RepoCare · 开源维护工作台",
  description: "面向开源项目维护者的工作台：项目体检、Issue 分诊、PR 检查与协作规范改进。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Extensions may add body attributes before hydration. Keep this escape hatch
  // on the body only; descendant content must still match its server render.
  return <html lang="zh-CN" suppressHydrationWarning><head><Script id="appearance-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head><body suppressHydrationWarning>{children}</body></html>;
}
