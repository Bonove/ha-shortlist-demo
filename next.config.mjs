/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Lemma engine is a wasm module loaded from disk on the server only.
  serverExternalPackages: ['@lemmabase/lemma-engine'],
};
export default nextConfig;
