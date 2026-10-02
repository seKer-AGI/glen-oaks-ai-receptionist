/** @type {import('next').NextConfig} */
const nextConfig = {
  // gzip buffers small streaming writes; the voice endpoints stream NDJSON + audio and need immediate flushes.
  compress: false,
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./knowledge/**/*"],
  },
};

export default nextConfig;
