// Minimal Deezer proxy for local dev (no external deps)
// Usage: node proxy.js
// Then set window.AURAWAVE_PROXY = 'http://localhost:3000' in devtools or inline script.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const BASE = 'https://api.deezer.com';

const server = http.createServer((req, res) => {
  const target = new URL(req.url, BASE);
  const opts = {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };

  const proxy = https.request(target, opts, (pRes) => {
    res.writeHead(pRes.statusCode || 500, {
      ...pRes.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
    });
    pRes.pipe(res);
  });

  proxy.on('error', (err) => {
    res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ error: { message: err.message } }));
  });

  req.pipe(proxy);
});

server.listen(PORT, () => {
  console.log(`AuraWave proxy running on http://localhost:${PORT}`);
});
