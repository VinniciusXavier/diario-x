import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Configurações principais
const PORT = Number(process.env.DIARIO_PORT) || 51810;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INBOX_DIR = process.env.NEUROOS_INBOX || 'C:\\Users\\vinni\\NeuroOS\\brain\\inbox';
const INBOX_FILE = path.join(INBOX_DIR, 'diario-x.jsonl');

// Garante que a pasta inbox exista no boot
fs.mkdirSync(INBOX_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readSavedUrls() {
  if (!fs.existsSync(INBOX_FILE)) return [];
  const content = fs.readFileSync(INBOX_FILE, 'utf-8');
  const urls = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.fonte_url) urls.push(obj.fonte_url);
    } catch {
      // Ignora linhas malformadas
    }
  }
  return urls;
}

const server = http.createServer((req, res) => {
  try {
    const rawUrl = req.url || '/';
    // Rejeita tentativas óbvias de path traversal antes da normalização da URL
    const rawPathname = rawUrl.split('?')[0];
    if (decodeURIComponent(rawPathname).includes('..')) {
      return sendJson(res, 403, { error: 'Acesso negado' });
    }

    const parsedUrl = new URL(rawUrl, `http://127.0.0.1:${PORT}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // Rota de saúde
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, app: 'diario-x' });
    }

    // Lista URLs salvas
    if (req.method === 'GET' && pathname === '/api/salvos') {
      return sendJson(res, 200, { urls: readSavedUrls() });
    }

    // Salva um item no inbox do NeuroOS
    if (req.method === 'POST' && pathname === '/api/salvar') {
      const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const origin = req.headers['origin'];
      const allowedOrigins = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];

      if (contentType !== 'application/json' || (origin && !allowedOrigins.includes(origin))) {
        return sendJson(res, 403, { error: 'Origem ou Content-Type não permitido' });
      }

      let body = '';
      let bytes = 0;
      let aborted = false;

      req.on('data', (chunk) => {
        if (aborted) return;
        bytes += chunk.length;
        if (bytes > 65536) {
          aborted = true;
          sendJson(res, 413, { error: 'Payload excede o limite de 64KB' });
          req.destroy();
          return;
        }
        body += chunk.toString('utf-8');
      });

      req.on('end', () => {
        if (aborted) return;
        try {
          const data = JSON.parse(body || '{}');
          const { titulo, resumo, pra_voce, categoria, fonte_nome, fonte_url, publicado_em, edicao } = data;

          if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
            return sendJson(res, 400, { error: 'Campo titulo é obrigatório' });
          }
          if (!fonte_url || typeof fonte_url !== 'string' || !/^https?:\/\/.+/i.test(fonte_url.trim())) {
            return sendJson(res, 400, { error: 'Campo fonte_url inválido (exige http/https)' });
          }

          const cleanUrl = fonte_url.trim();
          const savedUrls = readSavedUrls();
          if (savedUrls.includes(cleanUrl)) {
            return sendJson(res, 200, { status: 'already_saved' });
          }

          const id = 'dx_' + Date.now().toString(36);
          const record = {
            id,
            titulo: titulo.trim(),
            resumo: resumo ?? '',
            pra_voce: pra_voce ?? '',
            categoria: categoria ?? '',
            fonte_nome: fonte_nome ?? '',
            fonte_url: cleanUrl,
            publicado_em: publicado_em ?? '',
            edicao: edicao ?? '',
            salvoEm: new Date().toISOString(),
            tags: ['diario-x', categoria].filter(Boolean)
          };

          fs.appendFileSync(INBOX_FILE, JSON.stringify(record) + '\n', 'utf-8');
          return sendJson(res, 201, { status: 'saved', id });
        } catch {
          return sendJson(res, 400, { error: 'JSON inválido' });
        }
      });
      return;
    }

    // Arquivos estáticos permitidos
    if (req.method === 'GET') {
      const targetPath = pathname === '/' ? '/index.html' : pathname;
      const isIndex = targetPath === '/index.html';
      const isAsset = /^\/assets\/.+/.test(targetPath);
      const isEdicao = /^\/edicoes\/[^/]+\.json$/.test(targetPath);

      if (!isIndex && !isAsset && !isEdicao) {
        return sendJson(res, 404, { error: 'Rota não encontrada' });
      }

      const resolved = path.resolve(ROOT, '.' + targetPath);
      if (!resolved.startsWith(ROOT + path.sep)) {
        return sendJson(res, 403, { error: 'Acesso negado' });
      }

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return sendJson(res, 404, { error: 'Arquivo não encontrado' });
      }

      const ext = path.extname(resolved).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(resolved).pipe(res);
      return;
    }

    return sendJson(res, 405, { error: 'Método não permitido' });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Erro interno' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}`);
});
