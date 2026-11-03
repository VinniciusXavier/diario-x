import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT, carregarConfig, TAMANHOS } from './config.mjs';

// Configurações principais
const PORT = Number(process.env.DIARIO_PORT) || 51810;
const INBOX_DIR = process.env.NEUROOS_INBOX || path.join(os.homedir(), 'NeuroOS', 'brain', 'inbox');
const INBOX_FILE = path.join(INBOX_DIR, 'diario-x.jsonl');
const CONFIG_PESSOAL = path.join(ROOT, 'config.json');
const PROVEDORES = ['antigravity', 'claude', 'gemini', 'codex', 'api', 'comando'];

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

// POST só da própria página e em JSON: outro site aberto no navegador não consegue mexer no config nem rodar a IA
function lerCorpo(req, res, aoReceber) {
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
    let data;
    try { data = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
    aoReceber(data);
  });
}

// o que a página precisa saber da configuração (sem nada além do nome da variável da chave)
function configPublica() {
  const cfg = carregarConfig();
  const configurado = fs.existsSync(CONFIG_PESSOAL);
  return {
    configurado,
    neuroos: cfg.neuroos,
    cidade: cfg.cidade,
    leitor: configurado ? cfg.leitor || '' : '', // na primeira vez o campo vem vazio, não com o texto de exemplo
    tamanho: cfg.edicao.tamanho,
    tamanhos: TAMANHOS,
    ia: { provedor: cfg.ia.provedor, modelo: cfg.ia.modelo || '', api_url: cfg.ia.api?.url || '', chave_env: cfg.ia.api?.chave_env || '' },
    provedores: PROVEDORES,
    feeds: cfg.fontes.rss.length,
    buscas: cfg.fontes.google_noticias.length,
  };
}

function salvarConfig(d) {
  if (!fs.existsSync(CONFIG_PESSOAL)) fs.copyFileSync(path.join(ROOT, 'config.exemplo.json'), CONFIG_PESSOAL);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PESSOAL, 'utf-8'));
  delete cfg._ajuda;
  if (typeof d.leitor === 'string') cfg.leitor = d.leitor.trim().slice(0, 3000);
  if (typeof d.cidade === 'string') cfg.cidade = d.cidade.trim().slice(0, 60);
  if (TAMANHOS[d.tamanho]) cfg.edicao = { ...cfg.edicao, tamanho: d.tamanho };
  if (d.ia && PROVEDORES.includes(d.ia.provedor)) {
    cfg.ia = { ...cfg.ia, provedor: d.ia.provedor, modelo: String(d.ia.modelo || '').trim().slice(0, 120) };
    if (d.ia.provedor === 'api') {
      cfg.ia.api = { url: String(d.ia.api_url || '').trim().slice(0, 300), chave_env: String(d.ia.chave_env || '').trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 80) };
    }
  }
  fs.writeFileSync(CONFIG_PESSOAL, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

// busca de fontes com a IA: demora minutos, então roda em segundo plano e a página consulta o andamento
const busca = { rodando: false, saida: '', codigo: null };
function rodarFontes(fontesArgs) {
  busca.rodando = true;
  busca.saida = '';
  busca.codigo = null;
  const child = spawn(process.execPath, ['fontes.mjs', ...fontesArgs], { cwd: ROOT, windowsHide: true });
  child.stdout.on('data', (d) => { busca.saida += d; });
  child.stderr.on('data', (d) => { busca.saida += d; });
  child.on('close', (code) => { busca.rodando = false; busca.codigo = code; });
  child.on('error', (err) => { busca.rodando = false; busca.codigo = -1; busca.saida += err.message; });
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

    // só atende pelo próprio endereço (barra site de fora que tenta se passar por localhost)
    if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) {
      return sendJson(res, 403, { error: 'Host não permitido' });
    }

    // Rota de saúde
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, app: 'diario-x' });
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, configPublica());
    }

    if (req.method === 'POST' && pathname === '/api/config') {
      return lerCorpo(req, res, (d) => { salvarConfig(d); sendJson(res, 200, configPublica()); });
    }

    if (req.method === 'GET' && pathname === '/api/fontes') {
      return sendJson(res, 200, { ...busca, aprovadas: fs.existsSync(path.join(ROOT, 'coleta', 'fontes-verificadas.json')) });
    }

    if (req.method === 'POST' && pathname === '/api/fontes') {
      return lerCorpo(req, res, (d) => {
        if (busca.rodando) return sendJson(res, 409, { error: 'Já tem uma busca rodando' });
        if (d.acao === 'aplicar') rodarFontes(['aplicar', ...(d.substituir ? ['--substituir'] : [])]);
        else rodarFontes(['descobrir', String(d.tema || '').slice(0, 300)].filter(Boolean));
        sendJson(res, 202, { ok: true });
      });
    }

    // Lista URLs salvas e salva um item no inbox do NeuroOS (só com "neuroos": true no config)
    if (pathname === '/api/salvos' || pathname === '/api/salvar') {
      if (!carregarConfig().neuroos) return sendJson(res, 404, { error: 'NeuroOS desligado no config' });
      fs.mkdirSync(INBOX_DIR, { recursive: true });
    }

    if (req.method === 'GET' && pathname === '/api/salvos') {
      return sendJson(res, 200, { urls: readSavedUrls() });
    }

    if (req.method === 'POST' && pathname === '/api/salvar') {
      return lerCorpo(req, res, (data) => {
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
      });
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
