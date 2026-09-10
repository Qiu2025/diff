import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Some environments ship a preinstalled Chromium that does not match the
 * revision Playwright downloads by default. `PDF_DIFF_CHROMIUM_EXECUTABLE`
 * points the browser tests at that build instead.
 */
export function launchChromium(): Promise<Browser> {
  const executablePath = process.env.PDF_DIFF_CHROMIUM_EXECUTABLE;
  return chromium.launch(executablePath ? { executablePath } : {});
}

export async function startDevServer(): Promise<ViteDevServer & { baseUrl: string }> {
  const server = await createServer({
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) {
    await server.close();
    throw new Error('The Vite dev server did not report a local URL.');
  }
  return Object.assign(server, { baseUrl });
}
