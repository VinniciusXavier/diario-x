// Fontes do Diário X: a pessoa sugere um site, a IA procura as referências da área, e tudo é conferido antes de entrar.
// Uso:
//   node fontes.mjs adicionar <site ou feed> [--tipo design] [--nome "Nome"]   acha o feed do site e põe no config.json
//   node fontes.mjs descobrir "tema"                                         a IA sugere; o script confere cada feed
//   node fontes.mjs aplicar [--substituir]                                   põe no config.json o que a busca aprovou
//   node fontes.mjs testar                                                   mostra quais feeds do config estão quebrados
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, carregarConfig, googleNoticias } from './config.mjs';

const USER_AGENT = 'DiarioX/1.0 (+personal reader)';
const TIPOS = ['oficial', 'imprensa', 'voz', 'gringo', 'comunidade', 'lancamento', 'design', 'video'];
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

// junta as fontes novas no config.json sem repetir (ou troca as atuais por elas); devolve quantas entraram de cada tipo
function mesclar(novas, substituir = false) {
  const cfg = lerConfigPessoal();
  cfg.fontes = { rss: [], google_noticias: [], github_buscas: [], github_releases: [], hacker_news: [], ...cfg.fontes };
  if (substituir) {
    for (const campo of ['rss', 'google_noticias', 'github_buscas', 'github_releases', 'hacker_news']) cfg.fontes[campo] = [];
  }
  // trending do GitHub e Hugging Face seguem o que a busca concluiu sobre a pessoa
  if (typeof novas.tecnologia === 'boolean' && (substituir || novas.tecnologia)) {
    cfg.fontes.github_trending = novas.tecnologia;
    cfg.fontes.hugging_face = novas.tecnologia;
  }
  const conta = { rss: 0, google_noticias: 0, github_buscas: 0, github_releases: 0, hacker_news: 0 };
  const urls = new Set(cfg.fontes.rss.map((f) => chaveUrl(f.url)));
  for (const f of novas.rss || []) {
    if (urls.has(chaveUrl(f.url))) continue;
    urls.add(chaveUrl(f.url));
    cfg.fontes.rss.push(f);
    conta.rss++;
  }
  for (const campo of ['google_noticias', 'github_buscas', 'github_releases', 'hacker_news']) {
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
    `Quem vai ler e o que quer saber: ${tema}`,
    'Primeiro entenda a pessoa: profissão, mercado, cidade, idioma e o que ela faria com a notícia. Depois pense em onde',
    'alguém assim se informa de verdade e monte uma mistura variada, do jeito que fizer sentido para ela. Exemplos de lugar:',
    'portais de notícia gerais e do setor, sites de associações e órgãos do mercado, revistas especializadas, blogs de',
    'empresas e ferramentas que ela usa, especialistas, newsletters (Substack, Medium), canais do YouTube, subreddits,',
    'podcasts, imprensa local da cidade dela. Nada de seguir um molde: um dono de restaurante, uma advogada e um',
    'programador têm fontes completamente diferentes.',
    '',
    'Devolva:',
    '- "rss": 15 a 25 fontes com feed RSS/Atom. YouTube: https://www.youtube.com/feeds/videos.xml?channel_id=ID.',
    '  Reddit: https://www.reddit.com/r/NOME/.rss. Substack: https://NOME.substack.com/feed.',
    '- "google_noticias": 3 a 8 buscas no Google Notícias (palavras ou frases, no idioma da pessoa). Pega qualquer',
    '  portal de notícia sobre o assunto, então use para os temas centrais dela.',
    '- "tecnologia": true só se a pessoa trabalha com software/tecnologia e quer GitHub e Hacker News; senão false.',
    '- Só se "tecnologia" for true: "github_buscas" (sintaxe da busca do GitHub), "github_releases" ("dono/nome" de',
    '  ferramentas que ela usa) e "hacker_news" (palavras em inglês). Senão, listas vazias.',
    'LinkedIn, Instagram, Facebook, X e TikTok não têm feed aberto: não ponha esses links. Se uma pessoa ou empresa',
    'importante só publica lá, procure o blog, a newsletter ou o canal do YouTube dela.',
    `"tipo" de cada feed, um destes: ${TIPOS.join(', ')}. "idioma": "pt", "en", "es"...`,
    'Só sites que existem de verdade. Se não tiver certeza do endereço exato do feed, ponha o endereço do site em "url": o script procura o feed na página e descarta o que não funcionar.',
    jaTem ? `Já estão no jornal (não repita):\n${jaTem}` : '',
    'Formato, só este JSON:',
    '{"rss":[{"nome":"","url":"","tipo":"","idioma":""}],"google_noticias":[],"tecnologia":false,"github_buscas":[],"github_releases":[],"hacker_news":[]}',
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

  // confere tudo: feed que não abre, busca sem notícia e repositório que não existe ficam de fora
  const tec = sugeridas.tecnologia === true;
  const aprovadas = { rss: [], google_noticias: [], tecnologia: tec, github_buscas: tec ? sugeridas.github_buscas || [] : [], github_releases: [], hacker_news: tec ? sugeridas.hacker_news || [] : [] };
  for (const termo of sugeridas.google_noticias || []) {
    const r = await baixar(googleNoticias(termo)).then(({ texto }) => contarItens(texto), () => 0);
    console.log(`  ${r ? '✓' : '✗'} Google Notícias: "${termo}"${r ? ` (${r} notícias na semana)` : ': nada encontrado'}`);
    if (r) aprovadas.google_noticias.push(termo);
  }
  const feeds = await Promise.all((sugeridas.rss || []).map(async (f) => ({ f, feed: await acharFeed(f.url) })));
  for (const { f, feed } of feeds) {
    if (feed.erro) { console.log(`  ✗ ${f.nome} — ${f.url}: ${feed.erro}`); continue; }
    const fonte = { nome: f.nome, url: feed.url, tipo: TIPOS.includes(f.tipo) ? f.tipo : 'imprensa', ...(f.idioma && f.idioma !== 'en' ? { idioma: f.idioma } : {}) };
    aprovadas.rss.push(fonte);
    console.log(`  ✓ ${f.nome} — ${feed.url} (${feed.itens} itens)`);
  }
  for (const repo of tec ? sugeridas.github_releases || [] : []) {
    const ok = await baixar(`https://api.github.com/repos/${repo}`).then(() => true, () => false);
    console.log(`  ${ok ? '✓' : '✗'} releases de ${repo}${ok ? '' : ': repositório não encontrado'}`);
    if (ok) aprovadas.github_releases.push(repo);
  }
  if (aprovadas.github_buscas.length) console.log(`  buscas no GitHub: ${aprovadas.github_buscas.join(' · ')}`);
  if (aprovadas.hacker_news.length) console.log(`  Hacker News: ${aprovadas.hacker_news.join(' · ')}`);
  if (!tec) console.log('  GitHub e Hacker News: fora (não é o mundo desta pessoa)');

  fs.writeFileSync(path.join(ROOT, VERIFICADAS), JSON.stringify(aprovadas, null, 2) + '\n', 'utf-8');
  console.log(`\n${aprovadas.rss.length} de ${(sugeridas.rss || []).length} feeds funcionam, mais ${aprovadas.google_noticias.length} buscas no Google Notícias.`);
  console.log('Para usar: node fontes.mjs aplicar (soma às atuais) ou node fontes.mjs aplicar --substituir (troca as atuais)');
}

function aplicar() {
  const arq = path.join(ROOT, VERIFICADAS);
  if (!fs.existsSync(arq)) throw new Error('Nada para aplicar: rode antes node fontes.mjs descobrir "tema"');
  const c = mesclar(JSON.parse(fs.readFileSync(arq, 'utf-8')), args.includes('--substituir'));
  fs.rmSync(arq);
  console.log(`${args.includes('--substituir') ? 'Fontes trocadas' : 'Entraram no config.json'}: ${c.rss} feeds, ${c.google_noticias} buscas no Google Notícias, ` +
    `${c.github_buscas} buscas do GitHub, ${c.github_releases} repositórios de releases, ${c.hacker_news} palavras do HN.`);
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
