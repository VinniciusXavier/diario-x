// Configuração do Diário X: qual IA monta a edição, para quem ela escreve e de onde vêm as notícias.
// Vale o config.json (pessoal, fora do Git); sem ele, o config.exemplo.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function carregarConfig() {
  const arquivo = ['config.json', 'config.exemplo.json'].map((f) => path.join(ROOT, f)).find((p) => fs.existsSync(p));
  if (!arquivo) throw new Error('Falta config.json (copie o config.exemplo.json).');
  const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  cfg.arquivo = path.basename(arquivo);
  cfg.ia = { provedor: 'antigravity', ...cfg.ia };
  cfg.edicao = { tamanho: 'completa', ...cfg.edicao };
  cfg.neuroos = cfg.neuroos === true; // botão "Salvar no NeuroOS": só para quem tem o NeuroOS
  cfg.cidade = cfg.cidade || '';
  cfg.fontes = { rss: [], google_noticias: [], github_buscas: [], github_releases: [], hacker_news: [], github_trending: true, hugging_face: true, ...cfg.fontes };
  return cfg;
}

// busca no Google Notícias como feed: pega qualquer portal que falou do assunto na última semana
export const googleNoticias = (termo) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${termo} when:7d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

// quantas matérias por seção em cada tamanho de edição ("completa" segue a skill)
export const TAMANHOS = {
  enxuta: { total: '15 a 20', inovacoes: '2 a 3', design: '2 a 3', resultados: '1 a 2', vozes: '2 a 3', classificados: '6 a 10' },
  normal: { total: '25 a 35', inovacoes: '3 a 5', design: '3 a 5', resultados: '2 a 3', vozes: '4 a 6', classificados: '12 a 18' },
  completa: { total: '45 a 55', inovacoes: '5 a 7', design: '5 a 7', resultados: '3 a 5', vozes: '8 a 10', classificados: '25 a 35' },
};
