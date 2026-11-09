import type { Metadata, Viewport } from "next";
import { Red_Hat_Mono, Red_Hat_Text } from "next/font/google";
import Script from "next/script";
import { gaInitScript, parseGaIds } from "@/lib/client/analytics";
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
/** GA4 measurement ids, inlined at build time; none means no analytics script at all. */
const gaIds = parseGaIds(process.env.NEXT_PUBLIC_GA_IDS);

const themeScript = `try{var t=localStorage.getItem("vt-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Open the tile server connection and fetch the tileset index while JS downloads. */}
        <link rel="preconnect" href="https://tiles.openfreemap.org" crossOrigin="anonymous" />
        <link rel="preload" href="https://tiles.openfreemap.org/planet" as="fetch" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
        {gaIds.length > 0 && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaIds[0])}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {gaInitScript(gaIds)}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
