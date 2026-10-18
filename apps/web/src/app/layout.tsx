import "@fontsource/ubuntu/400.css";
import "@fontsource/ubuntu/500.css";
import "@fontsource/ubuntu/700.css";
import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "VE Funding", template: "%s · VE Funding" },
  description: "Vision Empower's fundraising leads and pipeline portal",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
