import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "ycscout — Activant YC Scout",
  description: "Automated YC batch scouting for Activant Capital",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <a href="/" className="brand">ycscout</a>
            <nav>
              <a href="/">Dashboard</a>
              <a href="/ask">Ask</a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
