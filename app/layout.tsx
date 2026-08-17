import type { Metadata } from 'next';
// import { defaultMetadata } from "@/lib/metadata";
import Footer from '@/components/common/footer';
import AuthSessionProvider from '@/components/providers/session-provider';
import { PrototypeBanner } from '@/components/common/prototype-banner';
import './globals.css';

export const metadata: Metadata = {
  title: 'SMAK St. Louis 2',
  description: 'Learning Management System',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <AuthSessionProvider>
          <PrototypeBanner />
          <main className="flex-1">{children}</main>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
