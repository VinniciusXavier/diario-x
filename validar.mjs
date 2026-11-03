import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CATEGORIAS_VALIDAS = new Set(['inovacoes', 'design', 'vozes', 'resultados', 'classificados', 'skills', 'gringos']); // skills/gringos: edições antigas
const GRUPOS_CLASSIFICADOS = new Set(['skills', 'mcp', 'agentes', 'memoria', 'design', 'ferramentas']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return String(raw).trim().replace(/\/+$/, '');
  }
}

async function checkUrlReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'DiarioX/1.0 (+validator)' }
    });
    if (res.status === 403 || res.status === 429) {
      return { ok: true, warning: `Aviso HTTP ${res.status} em ${url}` };
    }
    if (res.status >= 400) {
      return { ok: false, error: `Status HTTP ${res.status} em ${url}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Falha ao acessar ${url}: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOgImage(pageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(pageUrl, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'DiarioX/1.0 (+validator)' } });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 250000);
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      if (!/(property|name)\s*=\s*["'](og:image|twitter:image)(:src)?["']/i.test(tag)) continue;
      const c = tag.match(/content\s*=\s*["']([^"']+)["']/i);
      if (!c) continue;
      const abs = new URL(c[1].replace(/&amp;/g, '&'), res.url || pageUrl).toString();
      if (abs.startsWith('https://')) return abs;
    }
  } catch {
    // sem foto
  } finally {
    clearTimeout(timer);
  }
  return null;
}

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    console.error('Erro: informe o caminho (ex: node validar.mjs edicoes/AAAA-MM-DD.json)');
    process.exit(1);
  }

  const targetPath = path.resolve( process.cwd(), targetArg );
  if (!fs.existsSync(targetPath)) {
    console.error(`Erro: arquivo não encontrado (${targetArg})`);
    process.exit(1);
  }

  const erros = [];
  const avisos = [];
  let edicao;

  try {
    edicao = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  } catch (err) {
    console.error(`Erro ao ler JSON: ${err.message}`);
    process.exit(1);
  }

  if (!edicao.data || !DATE_RE.test(edicao.data)) {
    erros.push('Campo "data" inválido (esperado AAAA-MM-DD)');
  }
  if (!Number.isInteger(edicao.numero)) {
    erros.push('Campo "numero" deve ser um inteiro');
  }
  if (typeof edicao.editorial !== 'string' || !edicao.editorial.trim()) {
    erros.push('Campo "editorial" deve ser uma string não vazia');
  }
  if (!Array.isArray(edicao.itens) || edicao.itens.length === 0) {
    erros.push('Campo "itens" deve ser um array não vazio');
  }

  // Carrega URLs da coleta correspondente para evitar chamadas HTTP desnecessárias
  const coletaUrls = new Set();
  const coletaImagens = new Map(); // url normalizada -> imagem
  if (edicao.data && DATE_RE.test(edicao.data)) {
    const coletaPath = path.join(ROOT, 'coleta', `${edicao.data}.json`);
    if (fs.existsSync(coletaPath)) {
      try {
        const coleta = JSON.parse(fs.readFileSync(coletaPath, 'utf-8'));
        for (const it of coleta.itens || []) {
          if (it.url) {
            coletaUrls.add(it.url.trim());
            coletaUrls.add(normalizeUrl(it.url));
            if (it.imagem) coletaImagens.set(normalizeUrl(it.url), it.imagem);
          }
        }
      } catch {
        // Ignora erro na leitura da coleta
      }
    }
  }

  // Links já publicados em outras edições (impede copiar a edição anterior)
  const urlsAntigas = new Map(); // url normalizada -> arquivo
  const edDir = path.join(ROOT, 'edicoes');
  for (const file of fs.existsSync(edDir) ? fs.readdirSync(edDir) : []) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file) || path.join(edDir, file) === targetPath) continue;
    try {
      for (const it of JSON.parse(fs.readFileSync(path.join(edDir, file), 'utf-8')).itens || []) {
        if (it.fonte_url) urlsAntigas.set(normalizeUrl(it.fonte_url), file);
      }
    } catch {
      // ignora edição ilegível
    }
  }

  // edição com seções próprias (perfil fora de tecnologia) aceita só os ids delas
  const categoriasValidas = Array.isArray(edicao.secoes) && edicao.secoes.length
    ? new Set(edicao.secoes.map((s) => s.id))
    : CATEGORIAS_VALIDAS;
  if (Array.isArray(edicao.secoes) && edicao.secoes.some((s) => !s?.id || !s?.nome)) {
    erros.push('Campo "secoes": cada seção precisa de "id" e "nome"');
  }

  const ids = new Set();
  const urls = new Set();
  const urlsParaTestar = [];

  for (const [i, item] of (edicao.itens || []).entries()) {
    const prefix = `itens[${i}]`;
    for (const campo of ['id', 'titulo', 'resumo', 'pra_voce', 'categoria', 'fonte_nome', 'fonte_url', 'publicado_em']) {
      if (typeof item[campo] !== 'string' || !item[campo].trim()) {
        erros.push(`${prefix}: campo "${campo}" obrigatório`);
      }
    }

    if (item.id) {
      if (ids.has(item.id)) erros.push(`${prefix}: id duplicado "${item.id}"`);
      ids.add(item.id);
    }

    if (item.categoria && !categoriasValidas.has(item.categoria)) {
      erros.push(`${prefix}: categoria inválida "${item.categoria}"`);
    }

    if (item.imagem !== undefined) {
      if (typeof item.imagem !== 'string' || !/^https:\/\//i.test(item.imagem.trim())) {
        erros.push(`${prefix}: campo "imagem" deve ser uma URL https válida`);
      }
    }

    if (item.idioma !== undefined && (typeof item.idioma !== 'string' || !item.idioma.trim())) {
      erros.push(`${prefix}: campo "idioma" inválido`);
    }

    if (item.titulo_original !== undefined && (typeof item.titulo_original !== 'string' || !item.titulo_original.trim())) {
      erros.push(`${prefix}: campo "titulo_original" inválido`);
    }

    // vozes: idioma sempre; título original só quando o texto não é em português
    if (item.categoria === 'vozes' || item.categoria === 'gringos') {
      if (typeof item.idioma !== 'string' || !item.idioma.trim()) {
        erros.push(`${prefix}: campo "idioma" obrigatório para categoria "${item.categoria}"`);
      } else if (item.idioma !== 'pt' && (typeof item.titulo_original !== 'string' || !item.titulo_original.trim())) {
        erros.push(`${prefix}: campo "titulo_original" obrigatório para texto em "${item.idioma}"`);
      }
    }

    if (item.categoria === 'classificados') {
      if (!GRUPOS_CLASSIFICADOS.has(item.grupo)) {
        erros.push(`${prefix}: classificado precisa de "grupo" (${[...GRUPOS_CLASSIFICADOS].join(', ')})`);
      }
      for (const campo of ['estrelas', 'em_alta']) {
        if (item[campo] !== undefined && (typeof item[campo] !== 'string' || !item[campo].trim())) {
          erros.push(`${prefix}: campo "${campo}" deve ser texto (ex.: "36,9 mil", "+2,2 mil hoje")`);
        }
      }
    }

    if (item.publicado_em && !DATE_RE.test(item.publicado_em)) {
      erros.push(`${prefix}: publicado_em inválido "${item.publicado_em}" (esperado AAAA-MM-DD)`);
    }

    if (item.fonte_url) {
      const norm = normalizeUrl(item.fonte_url);
      if (urls.has(norm)) erros.push(`${prefix}: fonte_url duplicada "${item.fonte_url}"`);
      urls.add(norm);
      if (urlsAntigas.has(norm)) erros.push(`${prefix}: fonte_url já saiu em ${urlsAntigas.get(norm)} "${item.fonte_url}"`);

      if (!coletaUrls.has(item.fonte_url.trim()) && !coletaUrls.has(norm)) {
        urlsParaTestar.push(item.fonte_url.trim());
      }
    }
  }

  if (typeof edicao.manchete !== 'string' || !ids.has(edicao.manchete)) {
    erros.push('Campo "manchete" deve referenciar o id de um item existente');
  }

  // "Skill para testar hoje": aponta para um item e traz 2–4 passos curtos
  if (edicao.teste_do_dia !== undefined) {
    const t = edicao.teste_do_dia;
    if (!t || !ids.has(t.item)) erros.push('teste_do_dia.item deve referenciar o id de um item existente');
    if (!Array.isArray(t?.passos) || t.passos.length < 2 || t.passos.length > 4 || t.passos.some((p) => typeof p !== 'string' || !p.trim())) {
      erros.push('teste_do_dia.passos deve ter de 2 a 4 textos');
    }
  }

  // Verifica URLs que não estavam na coleta do dia
  if (urlsParaTestar.length > 0) {
    const checks = await Promise.all(urlsParaTestar.map((u) => checkUrlReachable(u)));
    for (const c of checks) {
      if (c.warning) avisos.push(c.warning);
      if (!c.ok && c.error) erros.push(c.error);
    }
  }

  if (avisos.length > 0) {
    for (const av of avisos) console.warn(`[AVISO] ${av}`);
  }

  if (erros.length > 0) {
    for (const er of erros) console.error(`[ERRO] ${er}`);
    process.exit(1);
  }

  // Preenche a foto de cada matéria: primeiro da coleta, senão og:image da própria página
  let fotos = 0;
  await Promise.all(edicao.itens.map(async (item) => {
    if (item.imagem) return;
    const img = coletaImagens.get(normalizeUrl(item.fonte_url)) || (await fetchOgImage(item.fonte_url));
    if (img) { item.imagem = img; fotos++; }
  }));
  if (fotos) {
    fs.writeFileSync(targetPath, JSON.stringify(edicao, null, 2) + '\n', 'utf-8');
    console.log(`Fotos preenchidas: ${fotos}`);
  }

  // Reconstrói edicoes/index.json ordenado por data desc
  const edicoesDir = path.join(ROOT, 'edicoes');
  fs.mkdirSync(edicoesDir, { recursive: true });
  const listaEdicoes = [];

  for (const file of fs.readdirSync(edicoesDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    try {
      const dados = JSON.parse(fs.readFileSync(path.join(edicoesDir, file), 'utf-8'));
      const itemManchete = (dados.itens || []).find((x) => x.id === dados.manchete);
      listaEdicoes.push({
        data: dados.data,
        numero: dados.numero,
        manchete_titulo: itemManchete ? itemManchete.titulo : '',
        total: Array.isArray(dados.itens) ? dados.itens.length : 0
      });
    } catch {
      // Ignora arquivo inválido
    }
  }

  listaEdicoes.sort((a, b) => b.data.localeCompare(a.data));
  fs.writeFileSync(
    path.join(edicoesDir, 'index.json'),
    JSON.stringify({ edicoes: listaEdicoes }, null, 2),
    'utf-8'
  );

  console.log('OK');
}

main();
