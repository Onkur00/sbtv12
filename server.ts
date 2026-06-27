import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Agent, setGlobalDispatcher } from "undici";
import dns from "dns";
import http from "http";
import https from "https";
import { Readable } from "stream";

// Prefer IPv4 during DNS resolution to avoid timeout/failure on hybrid dual-stack container interfaces
dns.setDefaultResultOrder("ipv4first");

// Disable SSL certificate verification to prevent issues on custom IPTV CDN streams with untrusted or expired certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Configure undici globally to ignore self-signed certificates or expired TLS handshakes
const undiciAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  }
});
setGlobalDispatcher(undiciAgent);

// Lower-level Node.js native http/https request fetcher to bypass any high-level HTTP version,
// ALPN negotiation, or client TLS/undici fingerprint blocks on raw IPTV servers/IP addresses.
function nativeNodeRequest(targetUrl: string, options: any = {}, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    let redirectsCount = 0;
    
    function performRequest(currentUrl: string) {
      if (redirectsCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }
      
      try {
        const parsed = new URL(currentUrl);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;
        
        const reqHeaders = { ...options.headers };
        // Delete existing host/Host key if present so Node can set it properly from the URL
        delete reqHeaders['host'];
        delete reqHeaders['Host'];
        
        // Remove undefined headers
        for (const key of Object.keys(reqHeaders)) {
          if (reqHeaders[key] === undefined || reqHeaders[key] === null) {
            delete reqHeaders[key];
          }
        }
        
        const reqOptions: any = {
          method: options.method || 'GET',
          headers: reqHeaders,
          timeout: timeoutMs,
        };
        
        if (isHttps) {
          reqOptions.rejectUnauthorized = false; // Bypass TLS checks
        }
        
        const req = lib.request(currentUrl, reqOptions, (res) => {
          const statusCode = res.statusCode || 200;
          
          // Handle HTTP redirects automatically
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            redirectsCount++;
            res.resume(); // Resume previous response stream to discard body and release socket
            const redirectUrl = new URL(res.headers.location, currentUrl).toString();
            performRequest(redirectUrl);
            return;
          }
          
          const ok = statusCode >= 200 && statusCode < 300;
          if (!ok) {
            res.resume(); // Resume non-ok response stream to discard body and release socket
          }
          
          // Helper to expose header values
          const headersMap = new Map<string, string>();
          for (const [key, val] of Object.entries(res.headers)) {
            if (val) {
              headersMap.set(key.toLowerCase(), Array.isArray(val) ? val.join(', ') : val);
            }
          }
          
          const headers = {
            get: (name: string) => headersMap.get(name.toLowerCase()) || null
          };
          
          const mockResponse = {
            ok,
            status: statusCode,
            statusText: res.statusMessage || '',
            url: currentUrl,
            headers: headers,
            text: async () => {
              return new Promise<string>((resolveText, rejectText) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolveText(data));
                res.on('error', (err) => rejectText(err));
              });
            },
            body: ok ? res : null
          };
          
          resolve(mockResponse);
        });
        
        req.on('error', (err) => {
          reject(err);
        });
        
        req.on('timeout', () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
        
        req.end();
      } catch (err) {
        reject(err);
      }
    }
    
    performRequest(targetUrl);
  });
}

// Helper to identify if an error is a terminal DNS or address-level failure (where trying other headers is useless)
function isConnectionError(err: any): boolean {
  if (!err) return false;

  // Recursively inspect the nested cause if it exists (highly common for undici/fetch wrapper errors)
  if (err.cause && typeof err.cause === 'object') {
    if (isConnectionError(err.cause)) {
      return true;
    }
  }

  const code = err.code;
  if (code && [
    'ENOTFOUND', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'ENETUNREACH'
  ].includes(code)) {
    return true;
  }

  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('unreachable')
  ) {
    return true;
  }

  return false;
}

// Keep track of hosts that fail with standard undici fetch to bypass latency on subsequent segment requests
const standardFetchFailedHosts = new Set<string>();

// Keep track of working configurations per host to avoid latency on segment requests
const workingConfigIndexes = new Map<string, number>();
const workingClientTypes = new Map<string, 'native' | 'standard'>();

// Helper for robust stream fetching with cascading header configurations and fallback strategies on connection failures
async function robustFetch(targetUrl: string, timeoutMs = 8000, clientHeaders: any = {}): Promise<any> {
  const isGpcdn = targetUrl.includes('gpcdn.net') || targetUrl.includes('akash') || targetUrl.includes('toffee') || targetUrl.includes('bpk-tv');
  const isAynaott = targetUrl.includes('aynaott.com') || targetUrl.includes('aynaott');

  // Parse hostname to check if it's an IP address or a raw domain
  let isIpAddress = false;
  let host = '';
  try {
    const parsedUrl = new URL(targetUrl);
    isIpAddress = /^[0-9.]+$/.test(parsedUrl.hostname);
    host = parsedUrl.host;
  } catch (_) {}

  // List of header configurations to cascade
  const browserConfig = {
    'User-Agent': isGpcdn 
      ? 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(isGpcdn ? {
      'Referer': 'https://toffeelive.com/',
      'Origin': 'https://toffeelive.com'
    } : isAynaott ? {
      'Referer': 'https://aynaott.com/',
      'Origin': 'https://aynaott.com'
    } : {
      'Referer': targetUrl
    })
  };

  const cleanBrowserConfig = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const firefoxConfig = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
    'Referer': isGpcdn ? 'https://aynaott.com/' : 'https://toffeelive.com/',
    'Origin': isGpcdn ? 'https://aynaott.com' : 'https://toffeelive.com'
  };

  const vlcPlayerConfig = {
    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
    'Accept': '*/*'
  };

  const ffmpegPlayerConfig = {
    'User-Agent': 'Lavf/58.76.100',
    'Accept': '*/*'
  };

  const iptvAppConfig = {
    'User-Agent': 'AptvPlayer/1.3.1 (com.aptv.player; build:12; iOS 16.5.0) Alamofire/5.6.4',
    'Accept': '*/*'
  };

  const smartTvConfig = {
    'User-Agent': 'Mozilla/5.0 (Web0S; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.240 Safari/537.36 SmartTV',
    'Accept': '*/*'
  };

  const noHeadersConfig = {};

  // Order of configurations depends on whether it's an IP address or a CDN domain
  // Raw IP servers (like http://41.205.93.154/...) almost always block standard browsers, so we prioritize media players
  const configs = isIpAddress 
    ? [vlcPlayerConfig, ffmpegPlayerConfig, iptvAppConfig, smartTvConfig, cleanBrowserConfig, browserConfig, firefoxConfig, noHeadersConfig]
    : [browserConfig, cleanBrowserConfig, firefoxConfig, vlcPlayerConfig, ffmpegPlayerConfig, iptvAppConfig, smartTvConfig, noHeadersConfig];

  let lastError: any = null;

  // 1. If we have a cached working configuration and client type, try that combination FIRST
  if (host && workingConfigIndexes.has(host) && workingClientTypes.has(host)) {
    const cachedIndex = workingConfigIndexes.get(host)!;
    const cachedClient = workingClientTypes.get(host)!;
    
    const targetConfig = cachedIndex >= 0 && cachedIndex < configs.length ? configs[cachedIndex] : null;
    if (targetConfig) {
      console.log(`info: robustFetch [Cache-First] trying cached config index ${cachedIndex} with client "${cachedClient}" for host ${host}`);
      try {
        const headersToSend: any = { ...targetConfig };
        if (clientHeaders.range) {
          headersToSend['Range'] = clientHeaders.range;
        }

        if (cachedClient === 'native') {
          const response = await nativeNodeRequest(targetUrl, {
            method: 'GET',
            headers: headersToSend
          }, timeoutMs);
          if (response.ok) {
            return response;
          }
        } else {
          const response = await fetch(targetUrl, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: headersToSend,
            dispatcher: undiciAgent
          } as any);
          if (response.status >= 200 && response.status < 300) {
            return response;
          }
          try {
            if (response.body) {
              await response.body.cancel();
            }
          } catch (_) {}
        }
      } catch (err: any) {
        workingConfigIndexes.delete(host);
        workingClientTypes.delete(host);
      }
    }
  }

  // Decide if we should prefer the Native client based on host failure history or raw IP address
  const preferNative = isIpAddress || (host && standardFetchFailedHosts.has(host));

  if (preferNative) {
    console.log(`info: robustFetch [Native-First] trying native client for ${targetUrl}`);
    for (let i = 0; i < configs.length; i++) {
      try {
        const headersToSend: any = { ...configs[i] };
        if (clientHeaders.range) {
          headersToSend['Range'] = clientHeaders.range;
        }
        
        const response = await nativeNodeRequest(targetUrl, {
          method: 'GET',
          headers: headersToSend
        }, timeoutMs);
        
        if (response.ok) {
          console.log(`info: robustFetch [Native-First] success on hop ${i + 1} for ${targetUrl}`);
          if (host) {
            workingConfigIndexes.set(host, i);
            workingClientTypes.set(host, 'native');
          }
          return response;
        }
        lastError = new Error(`HTTP status ${response.status} ${response.statusText}`);
      } catch (err: any) {
        lastError = err;
        if (isConnectionError(err)) {
          break;
        }
      }
    }
    
    // Fallback to standard fetch
    console.log(`info: robustFetch [Native-First] all native hops skipped, trying standard fetch fallback for ${targetUrl}...`);
    for (let i = 0; i < configs.length; i++) {
      try {
        const headersToSend: any = { ...configs[i] };
        if (clientHeaders.range) {
          headersToSend['Range'] = clientHeaders.range;
        }
        
        const response = await fetch(targetUrl, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: headersToSend,
          dispatcher: undiciAgent
        } as any);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`info: robustFetch [Native-First] standard fetch fallback success on hop ${i + 1} for ${targetUrl}`);
          if (host) {
            workingConfigIndexes.set(host, i);
            workingClientTypes.set(host, 'standard');
          }
          return response;
        }
        
        try {
          if (response.body) {
            await response.body.cancel();
          }
        } catch (_) {}
        
        lastError = new Error(`HTTP status ${response.status} ${response.statusText}`);
      } catch (err: any) {
        lastError = err;
        if (isConnectionError(err)) {
          break;
        }
      }
    }
  } else {
    // Normal flow: Standard Fetch first, then Native Client fallback
    console.log(`info: robustFetch [Fetch-First] trying standard fetch for ${targetUrl}`);
    for (let i = 0; i < configs.length; i++) {
      try {
        const headersToSend: any = { ...configs[i] };
        if (clientHeaders.range) {
          headersToSend['Range'] = clientHeaders.range;
        }
        
        const response = await fetch(targetUrl, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: headersToSend,
          dispatcher: undiciAgent
        } as any);
        
        if (response.status >= 200 && response.status < 300) {
          console.log(`info: robustFetch [Fetch-First] success on hop ${i + 1} for ${targetUrl}`);
          if (host) {
            workingConfigIndexes.set(host, i);
            workingClientTypes.set(host, 'standard');
          }
          return response;
        }
        
        try {
          if (response.body) {
            await response.body.cancel();
          }
        } catch (_) {}
        
        lastError = new Error(`HTTP status ${response.status} ${response.statusText}`);
      } catch (err: any) {
        lastError = err;
        if (isConnectionError(err)) {
          break;
        }
      }
    }
    
    // Standard fetch skipped all hops, mark host as failed
    if (host) {
      console.log(`info: robustFetch marking host ${host} as unreachable for standard fetch. Will prefer native client next time.`);
      standardFetchFailedHosts.add(host);
    }
    
    // Try native client fallback
    console.log(`info: robustFetch [Fetch-First] standard fetch skipped, trying native client fallback for ${targetUrl}...`);
    for (let i = 0; i < configs.length; i++) {
      try {
        const headersToSend: any = { ...configs[i] };
        if (clientHeaders.range) {
          headersToSend['Range'] = clientHeaders.range;
        }
        
        const response = await nativeNodeRequest(targetUrl, {
          method: 'GET',
          headers: headersToSend
        }, timeoutMs);
        
        if (response.ok) {
          console.log(`info: robustFetch [Fetch-First] native fallback success on hop ${i + 1} for ${targetUrl}`);
          if (host) {
            workingConfigIndexes.set(host, i);
            workingClientTypes.set(host, 'native');
          }
          return response;
        }
        lastError = new Error(`HTTP status ${response.status} ${response.statusText}`);
      } catch (err: any) {
        lastError = err;
        if (isConnectionError(err)) {
          break;
        }
      }
    }
  }

  throw lastError || new Error(`Could not load stream from target`);
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  // Handle CORS OPTIONS preflight requests for streaming proxy
  app.options("/api/stream-proxy", (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization, X-Requested-With');
    res.status(200).end();
  });

  // Add robust streaming live proxy route to bypass HTTPS Mixed Content blocks
  app.get("/api/stream-proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).send("Missing target url parameter");
      return;
    }

    try {
      // Gather client request headers to pass through (like Range for seeking/buffering segment blocks)
      const clientHeaders: any = {};
      if (req.headers.range) {
        clientHeaders.range = req.headers.range;
      }

      // Fetch stream chunk or m3u8 playlist using the robust cascading proxy fetcher
      const response = await robustFetch(targetUrl, 8000, clientHeaders);

      const finalUrl = response.url || targetUrl;
      let contentType = response.headers.get('content-type') || '';
      
      const isM3U8 = targetUrl.toLowerCase().includes('.m3u8') || 
                     finalUrl.toLowerCase().includes('.m3u8') || 
                     contentType.toLowerCase().includes('mpegurl') || 
                     contentType.toLowerCase().includes('mpegURL');

      const origin = req.headers.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      if (isM3U8) {
        const text = await response.text();
        // Resolve lines
        const lines = text.split(/\r?\n/);
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (trimmed === '') return line;

          if (!trimmed.startsWith('#')) {
            try {
              const resolved = new URL(trimmed, finalUrl).toString();
              return `/api/stream-proxy?url=${encodeURIComponent(resolved)}`;
            } catch (err) {
              return line;
            }
          }

          // Handle any #EXT directives that contain a URI attribute, such as #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, etc.
          if (trimmed.startsWith('#EXT')) {
            return trimmed.replace(/URI="([^"]+)"/g, (_, p1) => {
              try {
                const resolved = new URL(p1, finalUrl).toString();
                return `URI="/api/stream-proxy?url=${encodeURIComponent(resolved)}"`;
              } catch (err) {
                return `URI="${p1}"`;
              }
            });
          }

          return line;
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));
      } else {
        // Direct media pipeline (TS fragments, chunks, audio, subtitles keys, etc.)
        res.status(response.status || 200);

        // Fallback or override content-types for strict browsers, handling misconfigured text/plain or octet-stream responses
        const isTsUrl = targetUrl.toLowerCase().includes('.ts') || finalUrl.toLowerCase().includes('.ts');
        const isMp4Url = targetUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.mp4');
        const isM3u8Url = targetUrl.toLowerCase().includes('.m3u8') || finalUrl.toLowerCase().includes('.m3u8');

        const isGenericType = !contentType || 
                              contentType === 'application/octet-stream' || 
                              contentType.startsWith('text/plain') ||
                              contentType.startsWith('text/html');

        if (isGenericType) {
          if (isTsUrl) {
            contentType = 'video/mp2t';
          } else if (isMp4Url) {
            contentType = 'video/mp4';
          } else if (isM3u8Url) {
            contentType = 'application/vnd.apple.mpegurl';
          }
        }

        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        if (response.headers.get('content-length')) {
          res.setHeader('Content-Length', response.headers.get('content-length')!);
        }
        if (response.headers.get('content-range')) {
          res.setHeader('Content-Range', response.headers.get('content-range')!);
        }
        if (response.headers.get('accept-ranges')) {
          res.setHeader('Accept-Ranges', response.headers.get('accept-ranges')!);
        }

        // Stream reader loop to pipe response chunks (supports both web standard ReadableStream and Node.js Readable stream)
        if (response.body) {
          if (typeof (response.body as any).getReader === 'function') {
            const reader = (response.body as any).getReader();
            let closed = false;

            req.on('close', () => {
              closed = true;
              try {
                reader.cancel();
              } catch (e) {}
            });

            while (!closed) {
              const { done, value } = await reader.read();
              if (done || closed) break;
              res.write(value);
            }
            if (!closed) {
              res.end();
            }
          } else {
            // It's a Node.js Readable stream (e.g. IncomingMessage)
            const nodeStream = response.body as any;
            let closed = false;

            req.on('close', () => {
              closed = true;
              try {
                nodeStream.destroy();
              } catch (e) {}
            });

            nodeStream.on('data', (chunk: any) => {
              if (!closed) {
                res.write(chunk);
              }
            });

            nodeStream.on('end', () => {
              if (!closed) {
                res.end();
              }
            });

            nodeStream.on('error', (err: any) => {
              console.log(`info: Node stream pipe error: ${err.message || err}`);
              if (!closed) {
                try {
                  res.end();
                } catch (_) {}
              }
            });
          }
        } else {
          res.status(502).send("Active content stream empty");
        }
      }
    } catch (err: any) {
      if (res.headersSent) {
        console.log(`info: Stream proxy transmission completed or client disconnected.`);
        try {
          res.end();
        } catch (_) {}
        return;
      }
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('Timeout');
      if (isTimeout) {
        console.log(`info: Connection limit exceeded while fetching stream content for target URL`);
        res.status(504).send(`Error: Stream connection timed out (Offline feed).`);
      } else {
        console.log(`info: Stream session completed.`);
        res.status(502).send(`Error: Failed to stream from host (${err.message || 'unknown'}).`);
      }
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite development middleware vs Static Production server
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server starting on port ${PORT}`);
  });
}

startServer();
