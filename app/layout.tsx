import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAD Agent Workspace",
  description: "AI CAD agent workspace with chat, CAD preview, artifacts, and validation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
