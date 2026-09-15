import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NaijaVision: Contribute to Nigerian Language Research",
  description: "Open audio-visual data contribution for Nigerian languages.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
