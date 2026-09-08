import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soren · Isaac Studio",
  description:
    "A local workspace for viewing and controlling an Isaac Sim robot environment.",
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
