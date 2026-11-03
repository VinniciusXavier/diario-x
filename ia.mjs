// Fala com a IA escolhida no config.json. Usado pela edição do dia (rodar-edicao.mjs) e pela busca de fontes (fontes.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT, carregarConfig } from './config.mjs';

const cfg = carregarConfig();
export const IA = cfg.ia;
export const MODELO = process.env.DIARIO_MODELO || IA.modelo || '';
export const VIA_API = IA.provedor === 'api';
export const AGY = [path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'), 'agy'].find((p) => p === 'agy' || fs.existsSync(p));
// a skill instalada no Claude Code tem prioridade; sem ela, vale a cópia do repositório
export const SKILL = [path.join(os.homedir(), '.claude', 'skills', 'diario-x', 'SKILL.md'), path.join(ROOT, 'docs', 'SKILL-diario-x.md')].find((p) => fs.existsSync(p));

// como chamar cada IA que trabalha como agente (lê arquivos, abre páginas e grava o resultado sozinha);
// o pedido completo vai num arquivo e a IA recebe só uma frase curta e sem aspas, que passa em qualquer shell
const AGENTES = {
  antigravity: (p) => [AGY, ['-p', p, ...(MODELO ? ['--model', MODELO] : []), '--dangerously-skip-permissions', '--sandbox', '--add-dir', path.dirname(SKILL)]],
  claude: (p) => ['claude', ['-p', p, ...(MODELO ? ['--model', MODELO] : []), '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Edit,WebFetch,WebSearch', '--add-dir', path.dirname(SKILL)]],
  gemini: (p) => ['gemini', ['-p', p, ...(MODELO ? ['-m', MODELO] : []), '--yolo', '--include-directories', path.dirname(SKILL)]],
  codex: (p) => ['codex', ['exec', '--full-auto', ...(MODELO ? ['-m', MODELO] : []), p]],
  // "comando": "meu-cli", "args": ["--modelo", "{modelo}", "{pedido}"]
  comando: (p) => [IA.comando, (IA.args || ['{pedido}']).map((a) => a.replace('{pedido}', p).replace('{modelo}', MODELO).replace('{pasta_skill}', path.dirname(SKILL)))],
};
export const PROVEDORES = [...Object.keys(AGENTES), 'api'];
export const NOME_IA = { antigravity: 'Antigravity', claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex', comando: IA.comando, api: `API ${IA.api?.url}` }[IA.provedor];

export function comandoAgente(pedidoArq) {
  return AGENTES[IA.provedor](`Leia por inteiro o arquivo ${pedidoArq} e siga as instruções dele.`);
}

export function rodar(cmd, cmdArgs, { timeoutMs = 0 } = {}) {
  // no Windows, CLIs do npm (claude, gemini, codex) são .cmd e só abrem pelo shell
  const shell = process.platform === 'win32' && !/\.exe$/i.test(cmd);
  const linha = [cmd, ...cmdArgs].map((a) => (/[\s&|<>^]/.test(a) ? `"${a}"` : a)).join(' ');
  return new Promise((resolve) => {
    const opcoes = { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
    const child = shell ? spawn(linha, { ...opcoes, shell }) : spawn(cmd, cmdArgs, opcoes);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, out: out.trim() }); });
    child.on('error', (err) => { if (timer) clearTimeout(timer); resolve({ code: -1, out: err.message }); });
  });
}

// modo agente: grava o pedido e deixa a IA escrever `arquivo`; modo API: a resposta (JSON) vira `arquivo`
export async function pedirIA({ pedido, pedidoArq, arquivo, sistema = '', timeoutMs = 45 * 60_000 }) {
  if (VIA_API) return chamarApi({ sistema, usuario: pedido, arquivo, timeoutMs });
  fs.mkdirSync(path.dirname(path.join(ROOT, pedidoArq)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, pedidoArq), pedido, 'utf-8');
  const [cmd, cmdArgs] = comandoAgente(pedidoArq);
  return rodar(cmd, cmdArgs, { timeoutMs });
}

async function chamarApi({ sistema, usuario, arquivo, timeoutMs }) {
  const { url, chave_env } = IA.api || {};
  if (!url) return { code: -1, out: 'Falta "ia.api.url" no config.' };
  const chave = chave_env ? process.env[chave_env] : '';
  if (chave_env && !chave) return { code: -1, out: `A variável de ambiente ${chave_env} está vazia.` };
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(chave ? { Authorization: `Bearer ${chave}` } : {}) },
      body: JSON.stringify({
        model: MODELO,
        messages: [...(sistema ? [{ role: 'system', content: sistema }] : []), { role: 'user', content: usuario }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { code: res.status, out: JSON.stringify(json).slice(0, 600) };
    const conteudo = json.choices?.[0]?.message?.content || '';
    const ini = conteudo.indexOf('{');
    const fim = conteudo.lastIndexOf('}');
    if (ini === -1 || fim <= ini) return { code: 1, out: `Resposta sem JSON: ${conteudo.slice(0, 300)}` };
    fs.writeFileSync(path.join(ROOT, arquivo), conteudo.slice(ini, fim + 1) + '\n', 'utf-8');
    return { code: 0, out: `resposta recebida (${fim - ini + 1} caracteres)` };
  } catch (err) {
    return { code: -1, out: err.message };
  }
}
