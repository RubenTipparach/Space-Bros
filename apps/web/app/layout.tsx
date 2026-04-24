import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ChunkReloader } from "./ChunkReloader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Space Bros",
  description: "Build spaceships. Conquer the galaxy. Slowly.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#05060a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ChunkReloader />
        {children}
      </body>
    </html>
  );
}
