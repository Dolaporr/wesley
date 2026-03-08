/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BUG FIX: These externals are REQUIRED for @solana/web3.js to work in Next.js.
  // Removing them causes "Module not found" errors at build time.
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

module.exports = nextConfig;
