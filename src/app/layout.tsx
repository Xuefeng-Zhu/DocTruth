import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocTruth: docs answers that show their receipts",
  description: "Rerank, compare and verify answers about any GitHub project's docs with Clocked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
