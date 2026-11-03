// Monta a edição do dia com o Antigravity (agy CLI), sem depender da conta do Claude.
// Uso: node rodar-edicao.mjs [--arquivo edicoes/teste.json] [--forcar]
// Agendado no Windows (tarefa "Diario X - edicao"): todo dia às 09:00 e também ao ligar o PC.
// Se a edição do dia já existe, não faz nada; então os dois gatilhos não duplicam.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AGY = [path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'), 'agy'].find((p) => p === 'agy' || fs.existsSync(p));
const MODELO = process.env.DIARIO_MODELO || 'gemini-3.8-flash-medium';
// a skill instalada no Claude Code tem prioridade; sem ela, vale a cópia do repositório
const SKILL = [path.join(os.homedir(), '.claude', 'skills', 'diario-x', 'SKILL.md'), path.join(ROOT, 'docs', 'SKILL-diario-x.md')].find((p) => fs.existsSync(p));
const TENTATIVAS = 3;

const args = process.argv.slice(2);
const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
const arquivo = args.includes('--arquivo') ? args[args.indexOf('--arquivo') + 1] : `edicoes/${hoje}.json`;
const forcar = args.includes('--forcar');

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
const logPath = path.join(ROOT, 'logs', `${hoje}.log`);
const log = (msg) => {
  const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  console.log(linha);
  fs.appendFileSync(logPath, linha + '\n');
};

function rodar(cmd, cmdArgs, { timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, out: out.trim() }); });
    child.on('error', (err) => { if (timer) clearTimeout(timer); resolve({ code: -1, out: err.message }); });
  });
}

function numeroDaEdicao() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'edicoes', 'index.json'), 'utf-8'));
    const outros = (idx.edicoes || []).filter((e) => e.data !== hoje);
    return Math.max(0, ...outros.map((e) => e.numero || 0)) + 1;
  } catch {
    return 1;
  }
}

function prompt(erros) {
  const base = [
    `Você é o editor do Diário X. Leia por inteiro ${SKILL} e siga as regras editoriais, as seções, as quantidades e o formato.`,
    `Hoje é ${hoje}. A coleta de hoje já está pronta em coleta/${hoje}.json (não rode coletar.mjs de novo).`,
    'Nunca copie itens das edições anteriores em edicoes/: todo link precisa ser novo (o validador recusa repetidos).',
    `Escreva o arquivo ${arquivo} com "data": "${hoje}" e "numero": ${numeroDaEdicao()}.`,
    'Campos que o validador exige e costumam faltar: toda matéria de "vozes" precisa de "idioma" ("pt", "en", "ja"...), e "titulo_original" quando o idioma não for "pt".',
    'Escolha os itens da coleta; para completar (Anthropic, Google, Awwwards) abra a página oficial. Todo texto em português do Brasil.',
    'Regra inegociável: toda fonte_url veio da coleta ou de uma página que você abriu. Nunca invente link, data ou número.',
    `Só escreva ${arquivo}: não altere nenhum outro arquivo e não rode comandos (a validação roda depois, fora de você).`,
    'No fim responda em 3 linhas: número, manchete e itens por categoria.',
  ];
  if (erros) base.push(`A validação anterior falhou com estes erros; corrija o arquivo ${arquivo}:\n${erros}`);
  return base.join('\n');
}

async function main() {
  if (fs.existsSync(path.join(ROOT, arquivo)) && !forcar) {
    log(`${arquivo} já existe. Nada a fazer.`);
    return;
  }

  const dias = new Date().getDay() === 1 ? '3' : '2';
  log(`Coletando (--dias ${dias})...`);
  const coleta = await rodar(process.execPath, ['coletar.mjs', '--dias', dias], { timeoutMs: 10 * 60_000 });
  log(coleta.out.split('\n').slice(-3).join(' | '));
  if (coleta.code !== 0) { log('Coleta falhou. Parando.'); process.exit(1); }

  // o plugin de telemetria da extensão Google Cloud Data tem um hook quebrado no Windows que trava todas as
  // ferramentas do agy; se uma atualização reinstalar, desliga antes de rodar
  await rodar(AGY, ['plugin', 'disable', 'googlecloudtools.datacloud_telemetry'], { timeoutMs: 30_000 });

  let erros = '';
  for (let i = 1; i <= TENTATIVAS; i++) {
    log(`Antigravity (${MODELO}), tentativa ${i}...`);
    const agy = await rodar(AGY, ['-p', prompt(erros), '--model', MODELO, '--dangerously-skip-permissions', '--sandbox', '--add-dir', path.dirname(SKILL)], { timeoutMs: 45 * 60_000 });
    log(`agy saiu com código ${agy.code}: ${agy.out.slice(-600)}`);

    if (!fs.existsSync(path.join(ROOT, arquivo))) { erros = `O arquivo ${arquivo} não foi criado.`; continue; }
    const val = await rodar(process.execPath, ['validar.mjs', arquivo], { timeoutMs: 5 * 60_000 });
    if (val.code === 0) { log(`Validação OK. ${val.out.split('\n').pop()}`); return; }
    erros = val.out.split('\n').filter((l) => l.includes('[ERRO]')).slice(0, 40).join('\n') || val.out.slice(-2000);
    log(`Validação falhou:\n${erros}`);
  }
  // tira o arquivo inválido do caminho para o backup do Claude não achar que a edição já saiu
  const alvo = path.join(ROOT, arquivo);
  if (fs.existsSync(alvo)) fs.renameSync(alvo, path.join(path.dirname(alvo), `rascunho-${path.basename(alvo)}`));
  log('Não ficou pronta (rascunho guardado em edicoes/). A tarefa do Claude (backup das 09:00) tenta de novo.');
  process.exit(1);
}

main();
