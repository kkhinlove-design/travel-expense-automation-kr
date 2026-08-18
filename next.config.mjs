/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["kordoc"],
  outputFileTracingExcludes: {
    "/api/travel/parse-hwpx": [
      "./node_modules/@huggingface/**/*",
      "./node_modules/@hyzyla/pdfium/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/onnxruntime*/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/sharp/**/*",
    ],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      ],
    }];
  },
};

export default nextConfig;
