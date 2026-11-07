import type { Metadata, Viewport } from "next";
import { Red_Hat_Mono, Red_Hat_Text } from "next/font/google";
import "./globals.css";

const sans = Red_Hat_Text({ variable: "--font-sans", subsets: ["latin"] });
const mono = Red_Hat_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Visual traceroute",
  description: "Trace the network path to any host and follow every hop on a globe.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#06122b" },
    { media: "(prefers-color-scheme: light)", color: "#eaf2fb" },
  ],
};

// Applies a stored theme before first paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem("vt-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
