// Fontes do Diário X: a pessoa sugere um site, a IA procura as referências da área, e tudo é conferido antes de entrar.
// Uso:
//   node fontes.mjs adicionar <site ou feed> [--tipo design] [--nome "Nome"]   acha o feed do site e põe no config.json
//   node fontes.mjs descobrir "tema"                                         a IA sugere; o script confere cada feed
//   node fontes.mjs aplicar                                                  põe no config.json o que a busca aprovou
//   node fontes.mjs testar                                                   mostra quais feeds do config estão quebrados
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, carregarConfig } from './config.mjs';

const USER_AGENT = 'DiarioX/1.0 (+personal reader)';
const TIPOS = ['oficial', 'imprensa', 'voz', 'gringo', 'comunidade', 'lancamento', 'design'];
const CAMINHOS_COMUNS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed/rss/', '/rss/', '/blog/feed', '/blog/rss.xml', '/feeds/posts/default'];
const SUGERIDAS = 'coleta/fontes-sugeridas.json';
const VERIFICADAS = 'coleta/fontes-verificadas.json';

const args = process.argv.slice(2);
const opcao = (nome) => (args.includes(nome) ? args[args.indexOf(nome) + 1] : undefined);

async function baixar(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { texto: await res.text(), url: res.url || url };
}

const ehFeed = (texto) => /<(rss|feed|rdf:RDF)[\s>]/i.test(texto.slice(0, 3000));
const tituloDe = (texto) => (texto.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const contarItens = (texto) => (texto.match(/<(item|entry)[\s>]/gi) || []).length;

// recebe um site ou um feed e devolve o feed que funciona: o próprio link, o <link rel="alternate"> da página
// ou um dos caminhos comuns (/feed, /rss.xml...)
async function acharFeed(endereco) {
  const tentar = async (url) => {
    try {
      const { texto, url: final } = await baixar(url);
      if (!ehFeed(texto)) return { html: texto, url: final };
      return contarItens(texto) ? { url: final, titulo: tituloDe(texto), itens: contarItens(texto) } : { erro: 'feed sem matérias' };
    } catch (err) {
      return { erro: err.message };
    }
  };
  const primeiro = await tentar(endereco);
  if (primeiro.itens !== undefined) return primeiro;
  const candidatos = [];
  for (const tag of primeiro.html?.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag) || !/application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) candidatos.push(new URL(href.replace(/&amp;/g, '&'), primeiro.url).toString());
  }
  const base = new URL(primeiro.url || endereco);
  candidatos.push(...CAMINHOS_COMUNS.map((c) => new URL(c, base.origin).toString()));
  for (const url of [...new Set(candidatos)]) {
    const r = await tentar(url);
    if (r.itens !== undefined) return r;
  }
  return { erro: primeiro.erro || 'nenhum feed RSS/Atom encontrado' };
}

function lerConfigPessoal() {
  const pessoal = path.join(ROOT, 'config.json');
  if (!fs.existsSync(pessoal)) fs.copyFileSync(path.join(ROOT, 'config.exemplo.json'), pessoal);
  return JSON.parse(fs.readFileSync(pessoal, 'utf-8'));
}

function salvarConfigPessoal(cfg) {
  fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

const chaveUrl = (u) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');

// junta as fontes novas no config.json sem repetir; devolve quantas entraram de cada tipo
function mesclar(novas) {
  const cfg = lerConfigPessoal();
  cfg.fontes = { rss: [], github_buscas: [], github_releases: [], hacker_news: [], ...cfg.fontes };
  const conta = { rss: 0, github_buscas: 0, github_releases: 0, hacker_news: 0 };
  const urls = new Set(cfg.fontes.rss.map((f) => chaveUrl(f.url)));
  for (const f of novas.rss || []) {
    if (urls.has(chaveUrl(f.url))) continue;
    urls.add(chaveUrl(f.url));
    cfg.fontes.rss.push(f);
    conta.rss++;
  }
  for (const campo of ['github_buscas', 'github_releases', 'hacker_news']) {
    const atuais = new Set(cfg.fontes[campo].map((v) => v.toLowerCase()));
    for (const v of novas[campo] || []) {
      if (atuais.has(v.toLowerCase())) continue;
      atuais.add(v.toLowerCase());
      cfg.fontes[campo].push(v);
      conta[campo]++;
    }
  }
  salvarConfigPessoal(cfg);
  return conta;
}

async function adicionar() {
  const endereco = args[1];
  if (!endereco) throw new Error('Diga o site: node fontes.mjs adicionar https://site.com');
  const tipo = opcao('--tipo') || 'imprensa';
  if (!TIPOS.includes(tipo)) throw new Error(`--tipo precisa ser um destes: ${TIPOS.join(', ')}`);
  const url = /^https?:\/\//i.test(endereco) ? endereco : `https://${endereco}`;
  const feed = await acharFeed(url);
  if (feed.erro) throw new Error(`${url}: ${feed.erro}`);
  const fonte = { nome: opcao('--nome') || feed.titulo || new URL(url).hostname, url: feed.url, tipo };
  const { rss } = mesclar({ rss: [fonte] });
  console.log(rss ? `✓ ${fonte.nome} — ${fonte.url} (${feed.itens} itens agora). Entrou no config.json como "${tipo}".`
    : `${fonte.nome} já estava no config.json.`);
}

async function descobrir() {
  const { pedirIA, NOME_IA, VIA_API } = await import('./ia.mjs');
  const cfg = carregarConfig();
  const tema = args.slice(1).filter((a) => !a.startsWith('--')).join(' ') || cfg.leitor;
  if (!tema) throw new Error('Diga o tema: node fontes.mjs descobrir "marketing digital" (ou preencha "leitor" no config.json)');
  const jaTem = cfg.fontes.rss.map((f) => f.url).join('\n');
  const pedido = [
    'Você monta a lista de fontes de um jornal diário personalizado (o Diário X).',
    `Tema e leitor: ${tema}`,
    'Liste as maiores referências e portais dessa área, as que um especialista acompanharia:',
    '- 15 a 25 feeds RSS/Atom: portais, blogs oficiais de empresas e ferramentas, especialistas, newsletters e comunidades. Misture português e outros idiomas.',
    '- 3 a 8 buscas de repositórios do GitHub, na sintaxe da busca (ex.: "topic:seo", "figma plugin in:name,description").',
    '- 0 a 6 repositórios "dono/nome" cujas versões novas valem notícia (ferramentas que o leitor usa). Só se existirem.',
    '- 3 a 6 palavras para buscar no Hacker News (em inglês).',
    `"tipo" de cada feed, um destes: ${TIPOS.join(', ')}. "idioma": "pt", "en", "ja"... `,
    'Só sites que existem de verdade. Se não tiver certeza do endereço exato do feed, ponha o endereço do site em "url": o script procura o feed na página e descarta o que não funcionar.',
    jaTem ? `Já estão no jornal (não repita):\n${jaTem}` : '',
    'Formato, só este JSON:',
    '{"rss":[{"nome":"","url":"","tipo":"","idioma":""}],"github_buscas":[],"github_releases":[],"hacker_news":[]}',
    VIA_API ? 'Responda só com o JSON, sem texto antes ou depois.'
      : `Abra os sites para confirmar os endereços. Escreva o resultado em ${SUGERIDAS} e não altere nenhum outro arquivo.`,
  ].filter(Boolean).join('\n');

  const alvo = path.join(ROOT, SUGERIDAS);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.rmSync(alvo, { force: true });
  console.log(`${NOME_IA} procurando fontes sobre: ${tema.slice(0, 120)}...`);
  const r = await pedirIA({ pedido, pedidoArq: 'coleta/pedido-fontes.txt', arquivo: SUGERIDAS, timeoutMs: 20 * 60_000 });
  if (!fs.existsSync(alvo)) throw new Error(`A IA não devolveu a lista (código ${r.code}): ${r.out.slice(-400)}`);
  const sugeridas = JSON.parse(fs.readFileSync(alvo, 'utf-8'));

  // confere tudo: feed que não abre e repositório que não existe ficam de fora
  const aprovadas = { rss: [], github_buscas: sugeridas.github_buscas || [], github_releases: [], hacker_news: sugeridas.hacker_news || [] };
  const feeds = await Promise.all((sugeridas.rss || []).map(async (f) => ({ f, feed: await acharFeed(f.url) })));
  for (const { f, feed } of feeds) {
    if (feed.erro) { console.log(`  ✗ ${f.nome} — ${f.url}: ${feed.erro}`); continue; }
    const fonte = { nome: f.nome, url: feed.url, tipo: TIPOS.includes(f.tipo) ? f.tipo : 'imprensa', ...(f.idioma && f.idioma !== 'en' ? { idioma: f.idioma } : {}) };
    aprovadas.rss.push(fonte);
    console.log(`  ✓ ${f.nome} — ${feed.url} (${feed.itens} itens)`);
  }
  for (const repo of sugeridas.github_releases || []) {
    const ok = await baixar(`https://api.github.com/repos/${repo}`).then(() => true, () => false);
    console.log(`  ${ok ? '✓' : '✗'} releases de ${repo}${ok ? '' : ': repositório não encontrado'}`);
    if (ok) aprovadas.github_releases.push(repo);
  }
  if (aprovadas.github_buscas.length) console.log(`  buscas no GitHub: ${aprovadas.github_buscas.join(' · ')}`);
  if (aprovadas.hacker_news.length) console.log(`  Hacker News: ${aprovadas.hacker_news.join(' · ')}`);

  fs.writeFileSync(path.join(ROOT, VERIFICADAS), JSON.stringify(aprovadas, null, 2) + '\n', 'utf-8');
  console.log(`\n${aprovadas.rss.length} de ${(sugeridas.rss || []).length} feeds funcionam. Para pôr no config.json: node fontes.mjs aplicar`);
}

function aplicar() {
  const arq = path.join(ROOT, VERIFICADAS);
  if (!fs.existsSync(arq)) throw new Error('Nada para aplicar: rode antes node fontes.mjs descobrir "tema"');
  const c = mesclar(JSON.parse(fs.readFileSync(arq, 'utf-8')));
  fs.rmSync(arq);
  console.log(`Entraram no config.json: ${c.rss} feeds, ${c.github_buscas} buscas do GitHub, ${c.github_releases} repositórios de releases, ${c.hacker_news} palavras do HN.`);
}

async function testar() {
  const { fontes } = carregarConfig();
  const resultados = await Promise.all(fontes.rss.map(async (f) => {
    try {
      const { texto } = await baixar(f.url);
      return ehFeed(texto) ? `  ✓ ${f.nome} (${contarItens(texto)} itens)` : `  ✗ ${f.nome} — ${f.url}: não é um feed`;
    } catch (err) {
      return `  ✗ ${f.nome} — ${f.url}: ${err.message}`;
    }
  }));
  console.log(resultados.join('\n'));
  const quebradas = resultados.filter((r) => r.includes('✗')).length;
  console.log(`\n${fontes.rss.length - quebradas} de ${fontes.rss.length} feeds funcionando.${quebradas ? ' Os quebrados podem ser trocados com node fontes.mjs adicionar <site>.' : ''}`);
}

const comandos = { adicionar, descobrir, aplicar, testar };
const comando = comandos[args[0]];
if (!comando) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf-8').split('\n').slice(0, 6).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(args[0] ? 1 : 0);
}
Promise.resolve().then(comando).catch((err) => { console.error(`Erro: ${err.message}`); process.exit(1); });
