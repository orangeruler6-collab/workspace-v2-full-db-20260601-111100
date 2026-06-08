import type { Metadata } from "next";
import { AppProviders } from "@/components/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: "账号风格库",
  description: "本地账号风格库与文案工作台",
  icons: {
    icon: "/style-workbench/favicon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  var supported = { apple: true, silver: true, violet: true, usagi: true };
  function normalize(value) {
    if (supported[value]) return value;
    if (value === "light") return "apple";
    if (value === "dark") return "violet";
    return "apple";
  }
  try {
    var params = new URLSearchParams(window.location.search);
    var theme = normalize(params.get("uiStyle") || document.documentElement.dataset.uiStyle || window.localStorage.getItem("usagi_ui_style"));
    document.documentElement.dataset.uiStyle = theme;
    window.localStorage.setItem("usagi_ui_style", theme);
  } catch (e) {
    document.documentElement.dataset.uiStyle = "apple";
  }
})();`
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <AppProviders>
          <main className="main-content" id="main-content">
            {children}
          </main>
        </AppProviders>
      </body>
    </html>
  );
}
