import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glen Oaks Dental Professionals | AI Dental Receptionist",
  description: "Voice AI receptionist demo for Glen Oaks Dental Professionals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
