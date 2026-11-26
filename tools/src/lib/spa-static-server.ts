import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

/**
 * A tiny static file server with the same catch-all SPA rewrite semantics
 * as the production hosting (vercel.json): a request whose path matches a
 * real file serves that file; every other path serves index.html, so deep
 * links like /benchmarks/<id> reach the client-side router. Query strings
 * are ignored for file matching and preserved for the app.
 *
 * Used by the built-site tests and the browser check — not a product
 * component. Binds to 127.0.0.1 on an ephemeral port only.
 */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

export interface SpaStaticServer {
  /** The ephemeral port the server listens on (127.0.0.1). */
  port: number;
  /** Stops the server and drops every connection. */
  close(): Promise<void>;
}

function sendFile(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(statusCode, { "content-type": contentType });
  response.end(body);
}

/** Serves one request: a matching file, or index.html for everything else. */
function handleRequest(rootDir: string, request: IncomingMessage, response: ServerResponse): void {
  const root = path.resolve(rootDir);
  const requestPath = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");

  // Resolve inside the root only; traversal attempts and non-existent paths
  // fall through to the SPA shell.
  const candidate = path.resolve(root, `.${requestPath}`);
  const isFileInsideRoot =
    candidate.startsWith(root + path.sep) && existsSync(candidate) && statSync(candidate).isFile();

  if (isFileInsideRoot) {
    const contentType = MIME_TYPES[path.extname(candidate)] ?? "application/octet-stream";
    sendFile(response, 200, contentType, readFileSync(candidate, "utf8"));
    return;
  }

  sendFile(response, 200, MIME_TYPES[".html"]!, readFileSync(path.join(root, "index.html"), "utf8"));
}

/** Starts the SPA static server over `rootDir` on 127.0.0.1, port 0. */
export function startSpaStaticServer(rootDir: string): Promise<SpaStaticServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        handleRequest(rootDir, request, response);
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(`spa-static-server error: ${String(error)}`);
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("spa-static-server could not determine its port"));
        server.close();
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
            server.closeAllConnections();
          }),
      });
    });
  });
}
