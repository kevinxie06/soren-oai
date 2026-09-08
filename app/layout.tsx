import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soren — Robotic Policy Research",
  description:
    "Create simulation experiments, train robotic policies, and compare results.",
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
