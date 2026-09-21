/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a verification build run without clobbering the .next a dev server is using.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Lemma engine is a wasm module loaded from disk on the server only.
  serverExternalPackages: ['@lemmabase/lemma-engine'],
};
export default nextConfig;
