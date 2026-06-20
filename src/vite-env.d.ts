/// <reference types="vite/client" />

// Compile-time replace by vite.config.ts (define block). Holds the git
// SHA the running bundle was built from — compared against the live
// /index.html <meta name="build-id"> tag by useBuildVersionCheck to
// detect stale browser sessions after a Vercel deploy.
declare const __BUILD_ID__: string;
