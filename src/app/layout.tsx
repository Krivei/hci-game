import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// i18n
import I18nProvider from "./i18n/i18provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HCI Game",
  description: "A Human-Computer Interaction Game",
};
interface RootLayoutProps {
  children: React.ReactNode;
  params: { lang: string };
}

export default function RootLayout({
  children,
  params: { lang },
}: Readonly<RootLayoutProps>) {
  return (
    <html lang={lang}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
         <I18nProvider>{children}</I18nProvider>
      </body> 
    </html>
  );
}
