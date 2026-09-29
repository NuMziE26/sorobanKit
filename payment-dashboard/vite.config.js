import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE || 'http://127.0.0.1:5000'

  return {
    plugins: [
      react(),
      nodePolyfills({
        // The generated contract bindings (packages/types) import "buffer"
        // directly; resolving it to the real npm package (hoisted by npm)
        // avoids the plugin's alias shim, which does not resolve for files
        // outside the dashboard root.
        exclude: ['buffer'],
      }),
    ],
  },
  define: {
    global: 'globalThis',
  },
  build: {
    chunkSizeWarningLimit: 1100,
    // Files in public/ (robots.txt, sitemap.xml, favicons, …) are copied
    // verbatim to the build output root by Vite's default behaviour.
    // The explicit `publicDir` declaration below makes this intent clear and
    // ensures the setting is not accidentally overridden.
  },
  // Explicitly declare the public assets directory so it is obvious which
  // static files (robots.txt, sitemap.xml, …) will be copied to dist/.
  publicDir: 'public',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
    html: {
      // Parameterize the CSP `connect-src` directive with the configured API
      // base URL so the meta tag in index.html stays in sync with the
      // environment. `%VITE_API_BASE%` is replaced by Vite at build/serve time.
      cspNonce: undefined,
    },
    define: {
      global: 'globalThis',
      __API_BASE__: JSON.stringify(apiBase),
    },
  }
})