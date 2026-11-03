import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarConfig, googleNoticias } from './config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'DiarioX/1.0 (+personal reader)';

// Lê argumento --dias (padrão 2)
let dias = 2;
const idxDias = process.argv.indexOf('--dias');
if (idxDias !== -1 && process.argv[idxDias + 1]) {
  const parsed = Number(process.argv[idxDias + 1]);
  if (!Number.isNaN(parsed) && parsed > 0) dias = parsed;
}

// fontes e assuntos vêm do config.json (ou config.exemplo.json): cada pessoa escolhe o que quer acompanhar
const { fontes } = carregarConfig();
// cada busca no Google Notícias vira mais um feed (qualquer portal que falou do assunto)
const RSS_SOURCES = [
  ...fontes.rss,
  ...fontes.google_noticias.map((termo) => ({ nome: `Google Notícias: ${termo}`, url: googleNoticias(termo), tipo: 'imprensa', idioma: 'pt' }))
];
const GITHUB_QUERIES = fontes.github_buscas;
// novas versões das ferramentas do dia a dia (o que mudou, o que foi corrigido)
const RELEASE_REPOS = fontes.github_releases;
const HN_QUERIES = fontes.hacker_news;

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Normaliza URL sem parâmetros utm_* e sem barra final
function normalizeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) {
        u.searchParams.delete(key);
      }
    }
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

// Remove CDATA, tags HTML e decodifica entidades básicas
function cleanText(raw, maxLen = 280) {
  if (!raw) return '';
  let text = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '…'
  };
  text = text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|hellip);/gi, (m) => entities[m.toLowerCase()] || m);
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Segunda passagem caso entidades decodificadas tenham revelado tags HTML
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (maxLen && text.length > maxLen) {
    return text.slice(0, maxLen - 1).trimEnd() + '…';
  }
  return text;
}

async function fetchWithTimeout(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractTag(block, tagNames) {
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = block.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function extractLink(block) {
  // Atom: prioriza rel="alternate" ou link com href sem rel="self"
  const linkTags = [...block.matchAll(/<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link>)/gi)];
  for (const match of linkTags) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const relMatch = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : 'alternate';
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch && (rel === 'alternate' || !relMatch)) {
      return cleanText(hrefMatch[1], 0);
    }
    if (inner && inner.trim()) {
      return cleanText(inner, 0);
    }
  }
  // Fallback para qualquer href
  const anyHref = block.match(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/i);
  if (anyHref) return cleanText(anyHref[1], 0);
  const guid = extractTag(block, ['guid']);
  if (/^https?:\/\//i.test(cleanText(guid, 0))) return cleanText(guid, 0);
  return '';
}

function parseRssAtom(xml, fonte, tipo, cutoffMs, idioma = 'en') {
  const blocks = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) blocks.push(m[1]);
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) blocks.push(m[1]);

  const itens = [];
  for (const b of blocks) {
    const titulo = cleanText(extractTag(b, ['title']), 200);
    const url = extractLink(b);
    const rawDate = cleanText(extractTag(b, ['pubDate', 'published', 'updated', 'dc:date']), 0);
    const rawDesc = extractTag(b, ['description', 'summary', 'content:encoded', 'content']);

    if (!titulo || !url || !rawDate) continue;
    const dt = new Date(rawDate);
    if (Number.isNaN(dt.getTime()) || dt.getTime() < cutoffMs) continue;

    itens.push({
      fonte,
      tipo,
      titulo,
      url,
      data: dt.toISOString(),
      resumo: cleanText(rawDesc, 280),
      idioma
    });
  }
  return itens;
}

async function fetchRssSource(src, cutoffMs) {
  const xml = await fetchWithTimeout(src.url);
  const cutoff = src.dias ? Math.min(cutoffMs, Date.now() - src.dias * 86400 * 1000) : cutoffMs;
  return parseRssAtom(xml, src.nome, src.tipo, cutoff, src.idioma);
}

// GitHub Trending: o que está em alta agora, inclusive projeto antigo que voltou a bombar
async function fetchTrending(since) {
  const html = await fetchWithTimeout(`https://github.com/trending?since=${since}`, { 'User-Agent': 'Mozilla/5.0' });
  const out = [];
  for (const [, row] of html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)) {
    const repo = row.match(/<h2[\s\S]*?href="\/([^"/]+\/[^"/]+)"/)?.[1];
    if (!repo) continue;
    const desc = cleanText(row.match(/<p class="[^"]*color-fg-muted[^"]*">([\s\S]*?)<\/p>/)?.[1] || 'Sem descrição', 220);
    const total = row.match(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1] || '0';
    const ganho = row.match(/([\d,]+) stars (today|this week|this month)/);
    const lang = cleanText(row.match(/itemprop="programmingLanguage">([^<]+)/)?.[1] || '', 30);
    const periodo = { today: 'hoje', 'this week': 'na semana', 'this month': 'no mês' }[ganho?.[2]] || '';
    out.push({
      fonte: 'GitHub Trending',
      tipo: 'trending',
      titulo: cleanText(`${repo} — ${desc}`, 200),
      url: `https://github.com/${repo}`,
      data: new Date().toISOString(),
      resumo: cleanText(`★ ${total.replace(/,/g, '.')}${ganho ? ` · +${ganho[1].replace(/,/g, '.')} ${periodo}` : ''}${lang ? ` · ${lang}` : ''} · ${desc}`, 280),
      idioma: 'en',
      imagem: `https://opengraph.githubassets.com/1/${repo}`
    });
  }
  return out;
}

function githubHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchReleases(repo, cutoffMs) {
  const raw = await fetchWithTimeout(`https://api.github.com/repos/${repo}/releases?per_page=3`, githubHeaders());
  const out = [];
  for (const r of JSON.parse(raw)) {
    const dt = new Date(r.published_at);
    if (Number.isNaN(dt.getTime()) || dt.getTime() < cutoffMs || !r.html_url) continue;
    out.push({
      fonte: 'GitHub Releases',
      tipo: 'changelog',
      titulo: cleanText(`${repo} ${r.tag_name}${r.name && r.name !== r.tag_name ? ' — ' + r.name : ''}`, 200),
      url: r.html_url,
      data: dt.toISOString(),
      resumo: cleanText((r.body || '').replace(/[#*`>]/g, ' '), 280),
      idioma: 'en'
    });
  }
  return out;
}

// modelos e apps (spaces) em alta no Hugging Face
async function fetchHuggingFace(kind, cutoffMs) {
  const base = `https://huggingface.co/api/${kind}?limit=12&sort=`;
  let raw;
  try { raw = await fetchWithTimeout(base + 'trendingScore'); } catch { raw = await fetchWithTimeout(base + 'likes'); }
  const out = [];
  for (const m of JSON.parse(raw)) {
    const dt = new Date(m.lastModified || m.createdAt);
    if (!m.id || Number.isNaN(dt.getTime()) || dt.getTime() < cutoffMs) continue;
    out.push({
      fonte: kind === 'spaces' ? 'Hugging Face Spaces' : 'Hugging Face Modelos',
      tipo: 'modelo',
      titulo: m.id,
      url: `https://huggingface.co/${kind === 'spaces' ? 'spaces/' : ''}${m.id}`,
      data: dt.toISOString(),
      resumo: `♥ ${m.likes ?? 0} · ${m.pipeline_tag || m.sdk || kind}`,
      idioma: 'en'
    });
  }
  return out;
}

// og:image / twitter:image da página (vira a "foto" da matéria)
async function fetchOgImage(pageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    let html = '';
    while (html.length < 250000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      if (!/(property|name)\s*=\s*["'](og:image|twitter:image)(:src)?["']/i.test(tag)) continue;
      const c = tag.match(/content\s*=\s*["']([^"']+)["']/i);
      if (!c) continue;
      const abs = new URL(cleanText(c[1], 0), res.url || pageUrl).toString();
      if (abs.startsWith('https://')) return abs;
    }
  } catch {
    // sem imagem
  } finally {
    clearTimeout(timer);
  }
  return null;
}

async function addImages(itens) {
  const fila = itens.filter((it) => !it.imagem);
  let i = 0;
  const worker = async () => {
    while (i < fila.length) {
      const it = fila[i++];
      const img = await fetchOgImage(it.url);
      if (img) it.imagem = img;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

async function fetchGithubQuery(q, date14Str) {
  const headers = githubHeaders();
  const encodedQ = encodeURIComponent(`${q} created:>${date14Str}`);
  const url = `https://api.github.com/search/repositories?q=${encodedQ}&sort=stars&order=desc&per_page=15`;
  const raw = await fetchWithTimeout(url, headers);
  const json = JSON.parse(raw);
  const items = Array.isArray(json.items) ? json.items : [];
  const out = [];
  for (const repo of items) {
    if (!repo.html_url || !repo.created_at) continue;
    const dt = new Date(repo.created_at);
    if (Number.isNaN(dt.getTime())) continue;
    const desc = cleanText(repo.description || 'Sem descrição', 220);
    out.push({
      fonte: 'GitHub',
      tipo: 'repositorio',
      titulo: cleanText(`${repo.full_name} — ${desc}`, 200),
      url: repo.html_url,
      data: dt.toISOString(),
      resumo: cleanText(`★ ${repo.stargazers_count ?? 0} · ${desc}`, 280),
      idioma: 'en',
      imagem: `https://opengraph.githubassets.com/1/${repo.full_name}`
    });
  }
  return out;
}

async function fetchHnQuery(q, cutoffSec) {
  const url = `https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(q)}&numericFilters=created_at_i>${cutoffSec},points>60`;
  const raw = await fetchWithTimeout(url);
  const json = JSON.parse(raw);
  const hits = Array.isArray(json.hits) ? json.hits : [];
  const out = [];
  for (const hit of hits) {
    const dt = new Date(hit.created_at || (hit.created_at_i ? hit.created_at_i * 1000 : NaN));
    if (Number.isNaN(dt.getTime()) || dt.getTime() < cutoffSec * 1000) continue;
    const hnLink = `https://news.ycombinator.com/item?id=${hit.objectID}`;
    const itemUrl = hit.url || hnLink;
    const titulo = cleanText(hit.title || '', 200);
    if (!titulo) continue;
    out.push({
      fonte: 'Hacker News',
      tipo: 'comunidade',
      titulo,
      url: itemUrl,
      data: dt.toISOString(),
      resumo: cleanText(`▲ ${hit.points ?? 0} · ${hit.num_comments ?? 0} comentários · HN: ${hnLink}`, 280),
      idioma: 'en'
    });
  }
  return out;
}

function loadPublishedUrlsLast30Days() {
  const edicoesDir = path.join(ROOT, 'edicoes');
  const set = new Set();
  if (!fs.existsSync(edicoesDir)) return set;

  const cutoff30 = Date.now() - 30 * 86400 * 1000;
  for (const file of fs.readdirSync(edicoesDir)) {
    if (file === 'index.json' || !file.endsWith('.json')) continue;
    const fullPath = path.join(edicoesDir, file);
    try {
      const mBase = file.replace(/\.json$/, '');
      const fileDate = new Date(mBase + 'T00:00:00');
      if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff30) continue;
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      if (Array.isArray(data.itens)) {
        for (const it of data.itens) {
          if (it.fonte_url) set.add(normalizeUrl(it.fonte_url));
        }
      }
    } catch {
      // Ignora arquivos inválidos
    }
  }
  return set;
}

async function main() {
  const now = Date.now();
  const cutoffMs = now - dias * 86400 * 1000;
  const cutoffSec = Math.floor(cutoffMs / 1000);
  const date14Str = localDateStr(new Date(now - 14 * 86400 * 1000));
  const cutoff14Ms = now - 14 * 86400 * 1000;

  const tasks = [
    ...RELEASE_REPOS.map((r) => ({
      fonte: `Release (${r})`,
      promise: fetchReleases(r, cutoff14Ms)
    })),
    ...(fontes.github_trending ? [
      ...['daily', 'weekly', 'monthly'].map((s) => ({ fonte: `GitHub Trending (${s})`, promise: fetchTrending(s) })),
      { fonte: 'GitHub (stars:>300, 30 dias)', promise: fetchGithubQuery('stars:>300', localDateStr(new Date(now - 30 * 86400 * 1000))) }
    ] : []),
    ...(fontes.hugging_face ? [
      { fonte: 'Hugging Face Modelos', promise: fetchHuggingFace('models', cutoff14Ms) },
      { fonte: 'Hugging Face Spaces', promise: fetchHuggingFace('spaces', cutoff14Ms) }
    ] : []),
    ...RSS_SOURCES.map((s) => ({
      fonte: s.nome,
      promise: fetchRssSource(s, cutoffMs)
    })),
    ...GITHUB_QUERIES.map((q) => ({
      fonte: `GitHub (${q})`,
      grupo: 'GitHub',
      promise: fetchGithubQuery(q, date14Str)
    })),
    ...HN_QUERIES.map((q) => ({
      fonte: `Hacker News (${q})`,
      grupo: 'Hacker News',
      promise: fetchHnQuery(q, cutoffSec)
    }))
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.promise));
  const rawItens = [];
  const erros = [];

  results.forEach((res, idx) => {
    const task = tasks[idx];
    if (res.status === 'fulfilled') {
      rawItens.push(...res.value);
    } else {
      erros.push({
        fonte: task.fonte,
        erro: res.reason?.message || String(res.reason)
      });
    }
  });

  // Deduplica por URL normalizada e remove URLs já publicadas nos últimos 30 dias
  const publishedUrls = loadPublishedUrlsLast30Days();
  const seenUrls = new Set();
  const itens = [];

  for (const item of rawItens) {
    const norm = normalizeUrl(item.url);
    if (!norm || publishedUrls.has(norm) || seenUrls.has(norm)) continue;
    seenUrls.add(norm);
    itens.push(item);
  }

  // Ordena por data decrescente
  itens.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  await addImages(itens);

  const hojeStr = localDateStr();
  const coletaDir = path.join(ROOT, 'coleta');
  fs.mkdirSync(coletaDir, { recursive: true });
  const outFile = path.join(coletaDir, `${hojeStr}.json`);

  const payload = {
    geradoEm: new Date().toISOString(),
    dias,
    itens,
    erros
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf-8');

  // Resumo por fonte
  const counts = {};
  for (const s of RSS_SOURCES) counts[s.nome] = 0;
  counts['GitHub'] = 0;
  counts['Hacker News'] = 0;
  for (const it of itens) {
    counts[it.fonte] = (counts[it.fonte] || 0) + 1;
  }

  console.log(`=== Coleta ${hojeStr} (--dias ${dias}) -> ${itens.length} itens, ${itens.filter((it) => it.imagem).length} com imagem ===`);
  for (const [fonte, qtd] of Object.entries(counts)) {
    console.log(`  ${fonte}: ${qtd}`);
  }
  if (erros.length > 0) {
    console.log(`Erros (${erros.length}):`);
    for (const e of erros) console.log(`  [ERRO] ${e.fonte}: ${e.erro}`);
  } else {
    console.log('Erros: 0');
  }
}

main();
