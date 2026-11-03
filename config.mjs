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
  cfg.fontes = { rss: [], github_buscas: [], github_releases: [], hacker_news: [], github_trending: true, hugging_face: true, ...cfg.fontes };
  return cfg;
}
