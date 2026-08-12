import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "并肩 · 双人健康记录",
    template: "%s · 并肩",
  },
  description: "和重要的人一起记录体重、安排运动、统计健身消费。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "并肩 · 双人健康记录",
    description: "一起记录，一起变好",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "并肩 · 双人健康记录",
    description: "一起记录，一起变好",
    images: ["/og.png"],
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? { metadataBase: new URL(`${protocol}://${host}`) } : {};
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
