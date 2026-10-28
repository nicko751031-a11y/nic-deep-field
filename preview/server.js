// 靜態網站伺服器（給 Railway 或任何 Node 環境）
// 預設公開；設定 SITE_USER 與 SITE_PASSWORD 環境變數即啟用 HTTP Basic 認證。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const USER = process.env.SITE_USER || '';
const PASS = process.env.SITE_PASSWORD || '';
const EXPECTED = USER ? 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64') : null;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  if (EXPECTED && (req.headers.authorization || '') !== EXPECTED) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="arc", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('此頁面需要帳號密碼');
    return;
  }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT) || file.includes(path.sep + 'tools' + path.sep) || path.basename(file) === 'server.js') { res.writeHead(404); res.end('not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const immutable = urlPath.startsWith('/assets/') || urlPath.startsWith('/vendor/') || urlPath.startsWith('/data/');
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': immutable ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(process.env.PORT || 3000, () => console.log('ARC static server up on', process.env.PORT || 3000));
