// Monta a edição do dia com a IA escolhida em config.json (Antigravity, Claude Code, Gemini CLI, Codex,
// qualquer API no formato da OpenAI ou um comando próprio).
// Uso: node rodar-edicao.mjs [--arquivo edicoes/teste.json] [--forcar] [--simular]
//   --simular: monta o pedido e mostra o comando da IA, sem rodar nada
// Agendado no Windows (tarefa "Diario X - edicao"): todo dia às 09:00 e também ao ligar o PC.
// Se a edição do dia já existe, não faz nada; então os dois gatilhos não duplicam.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, carregarConfig } from './config.mjs';
import { IA, MODELO, VIA_API, AGY, SKILL, PROVEDORES, NOME_IA, comandoAgente, rodar, pedirIA } from './ia.mjs';

const cfg = carregarConfig();
const TENTATIVAS = 3;

const args = process.argv.slice(2);
const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
const arquivo = args.includes('--arquivo') ? args[args.indexOf('--arquivo') + 1] : `edicoes/${hoje}.json`;
const forcar = args.includes('--forcar');
const simular = args.includes('--simular');

const PEDIDO_ARQ = `coleta/pedido-${hoje}.txt`;

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
const logPath = path.join(ROOT, 'logs', `${hoje}.log`);
const log = (msg) => {
  const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  console.log(linha);
  fs.appendFileSync(logPath, linha + '\n');
};

function numeroDaEdicao() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'edicoes', 'index.json'), 'utf-8'));
    const outros = (idx.edicoes || []).filter((e) => e.data !== hoje);
    return Math.max(0, ...outros.map((e) => e.numero || 0)) + 1;
  } catch {
    return 1;
  }
}

function prompt(erros, viaApi) {
  const base = [
    viaApi
      ? 'Você é o editor do Diário X. As regras editoriais, as seções, as quantidades e o formato estão na mensagem de sistema.'
      : `Você é o editor do Diário X. Leia por inteiro ${SKILL} e siga as regras editoriais, as seções, as quantidades e o formato.`,
    viaApi
      ? 'Você não abre páginas nem roda comandos: use só os itens da coleta listados no fim desta mensagem.'
      : `Hoje é ${hoje}. A coleta de hoje já está pronta em coleta/${hoje}.json (não rode coletar.mjs de novo).`,
    'Nunca copie itens das edições anteriores em edicoes/: todo link precisa ser novo (o validador recusa repetidos).',
    viaApi
      ? `Responda só com o JSON da edição (sem texto antes ou depois), com "data": "${hoje}" e "numero": ${numeroDaEdicao()}.`
      : `Escreva o arquivo ${arquivo} com "data": "${hoje}" e "numero": ${numeroDaEdicao()}.`,
    'Campos que o validador exige e costumam faltar: toda matéria de "vozes" precisa de "idioma" ("pt", "en", "ja"...), e "titulo_original" quando o idioma não for "pt".',
    viaApi
      ? 'Escolha os itens da coleta. Todo texto em português do Brasil.'
      : 'Escolha os itens da coleta; para completar (Anthropic, Google, Awwwards) abra a página oficial. Todo texto em português do Brasil.',
    'Regra inegociável: toda fonte_url veio da coleta ou de uma página que você abriu. Nunca invente link, data ou número.',
  ];
  if (cfg.leitor) base.push(`Perfil do leitor (vale no lugar do "Perfil do leitor" da skill; é para ele o "pra você"):\n${cfg.leitor}`);
  if (!viaApi) {
    base.push(`Só escreva ${arquivo}: não altere nenhum outro arquivo e não rode comandos (a validação roda depois, fora de você).`);
    base.push('No fim responda em 3 linhas: número, manchete e itens por categoria.');
  }
  if (erros) base.push(`A validação anterior falhou com estes erros; corrija ${viaApi ? 'a edição' : `o arquivo ${arquivo}`}:\n${erros}`);
  return base.join('\n');
}

// coleta em uma linha por item: cabe no contexto de modelos sem ferramentas
function coletaCompacta() {
  const { itens } = JSON.parse(fs.readFileSync(path.join(ROOT, 'coleta', `${hoje}.json`), 'utf-8'));
  return itens.map((it) => [it.url, it.tipo, it.fonte, it.data.slice(0, 10), it.idioma, it.titulo, (it.resumo || '').slice(0, 200)].join(' | ')).join('\n');
}

async function main() {
  if (!PROVEDORES.includes(IA.provedor)) {
    log(`Provedor "${IA.provedor}" desconhecido em ${cfg.arquivo}. Use: ${PROVEDORES.join(', ')}.`);
    process.exit(1);
  }
  if (simular) {
    fs.mkdirSync(path.join(ROOT, 'coleta'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, PEDIDO_ARQ), prompt('', VIA_API), 'utf-8');
    const [cmd, cmdArgs] = VIA_API ? ['POST', [`${IA.api?.url}/chat/completions`, MODELO]] : comandoAgente(PEDIDO_ARQ);
    console.log(`Config: ${cfg.arquivo} · IA: ${NOME_IA} · modelo: ${MODELO || '(padrão da IA)'}`);
    console.log(`Comando: ${cmd} ${cmdArgs.join(' ')}`);
    console.log(`Pedido gravado em ${PEDIDO_ARQ}`);
    return;
  }
  if (fs.existsSync(path.join(ROOT, arquivo)) && !forcar) {
    log(`${arquivo} já existe. Nada a fazer.`);
    return;
  }

  const dias = new Date().getDay() === 1 ? '3' : '2';
  log(`Coletando (--dias ${dias})...`);
  const coleta = await rodar(process.execPath, ['coletar.mjs', '--dias', dias], { timeoutMs: 10 * 60_000 });
  log(coleta.out.split('\n').slice(-3).join(' | '));
  if (coleta.code !== 0) { log('Coleta falhou. Parando.'); process.exit(1); }

  if (IA.provedor === 'antigravity') {
    // o plugin de telemetria da extensão Google Cloud Data tem um hook quebrado no Windows que trava todas as
    // ferramentas do agy; se uma atualização reinstalar, desliga antes de rodar
    await rodar(AGY, ['plugin', 'disable', 'googlecloudtools.datacloud_telemetry'], { timeoutMs: 30_000 });
  }

  let erros = '';
  for (let i = 1; i <= TENTATIVAS; i++) {
    log(`${NOME_IA} (${MODELO || 'modelo padrão'}), tentativa ${i}...`);
    const r = await pedirIA({
      pedido: VIA_API ? `${prompt(erros, true)}\n\nColeta de hoje (url | tipo | fonte | data | idioma | título | resumo):\n${coletaCompacta()}` : prompt(erros, false),
      pedidoArq: PEDIDO_ARQ,
      arquivo,
      sistema: fs.readFileSync(SKILL, 'utf-8'),
    });
    log(`IA saiu com código ${r.code}: ${r.out.slice(-600)}`);

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
