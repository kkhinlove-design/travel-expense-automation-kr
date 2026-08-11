/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["kordoc", "cfb"],
  outputFileTracingIncludes: {
    "/*": ["node_modules/cfb/**/*"]
  }
};

export default nextConfig;
