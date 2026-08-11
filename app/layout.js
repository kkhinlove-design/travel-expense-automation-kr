import "./globals.css";
import { headers } from "next/headers";
import { APP_DESCRIPTION, APP_TITLE, ORGANIZATION_CONFIG } from "@/config/organization";

export async function generateMetadata() {
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("x-forwarded-host") || incomingHeaders.get("host") || "localhost:3000";
  const protocol = incomingHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = APP_TITLE;
  const description = APP_DESCRIPTION;
  const imageUrl = `${origin}${ORGANIZATION_CONFIG.ogImagePath.startsWith("/") ? "" : "/"}${ORGANIZATION_CONFIG.ogImagePath}`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: `${ORGANIZATION_CONFIG.appName} - 승인서에서 동반 출장자의 A4 서류까지` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
