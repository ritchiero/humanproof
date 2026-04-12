import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HumanProof — AI Authorship Evidence',
  description: 'Document human-AI interactions for copyright registration.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
