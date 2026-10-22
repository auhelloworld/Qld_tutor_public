import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import ToastHost from '../components/ToastHost';
import ErrorBoundary from '../components/ErrorBoundary';
import AuthGate from '../components/AuthGate';
import ThemeToggle from '../components/ThemeToggle';

export const metadata: Metadata = {
  title: 'QLD AI Tutor',
  description: 'Queensland-aligned tutoring and practice for Years 7–10 and supported QCAA senior courses.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU" suppressHydrationWarning>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var theme=localStorage.getItem('theme');if(theme==='dark'||(!theme&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){}})();`
          }}
        />
        <a href="#main" className="skip-link">Skip to main content</a>
        <AuthGate />
        <ToastHost />
        <ThemeToggle />
        <ErrorBoundary>
          <main id="main" tabIndex={-1}>{children}</main>
        </ErrorBoundary>
      </body>
    </html>
  );
}
