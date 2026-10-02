/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./knowledge/**/*"],
  },
};

export default nextConfig;
