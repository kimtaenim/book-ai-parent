import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI시대 부모 검수",
  description: "AI시대 부모를 위한 책 — QA 검수 도구",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
