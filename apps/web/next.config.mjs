/** @type {import('next').NextConfig} */

const exportMode = process.env.BUILD_OUTPUT === "export";
const basePath = process.env.BASE_PATH ?? "";

const nextConfig = {
  transpilePackages: ["@space-bros/shared"],
  reactStrictMode: true,
  ...(basePath && { basePath, assetPrefix: basePath }),
  ...(exportMode && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
