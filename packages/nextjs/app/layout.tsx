import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SaucerSwap Auto-DCA on Hedera",
  description:
    "Recurring SaucerSwap buys that schedule themselves with the Hedera Schedule Service and refuse to trade on bad Pyth prices.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
