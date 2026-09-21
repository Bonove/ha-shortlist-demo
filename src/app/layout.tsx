import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Nav } from '@/components/nav';
import { PresenterBar } from '@/components/presenter-bar';

export const metadata: Metadata = {
  title: 'HousingAnywhere · Trusted shortlist prototype',
  description: 'Agent harness prototype: live assistant, shared tenant context and real Lemma policy execution.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="appbar">
          <div className="appbar-inner">
            <div className="wordmark">Housing<span>Anywhere</span></div>
            <Nav />
            <div className="spacer" />
            <PresenterBar />
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
