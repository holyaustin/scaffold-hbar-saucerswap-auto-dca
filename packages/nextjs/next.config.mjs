import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repo is an npm workspace, so tell Next where the real root is.
  outputFileTracingRoot: path.join(here, "../.."),
};

export default nextConfig;
