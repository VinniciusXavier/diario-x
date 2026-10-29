---
name: diario-x
description: Monta a edição do dia do Diário X, o jornal pessoal de IA do Vinicius (inovações e novas versões, design com IA e sites premiados, skills/MCPs, autores de fora traduzidos e classificados de repositórios do GitHub), com fonte verificada em cada item e um "pra você" ligado à rotina dele. Use quando ele pedir "Diário X", "edição de hoje", "jornal de IA", "o que saiu de IA hoje", ou quando a tarefa agendada diario-x-manha rodar.
---

# Diário X — agente editor

Projeto: `C:\Users\vinni\Desktop\APPS IA\6 - Diario X\` (abre com `Diario-X.bat`, porta 51810).
Saída: `edicoes/AAAA-MM-DD.json`. Botão "Salvar no NeuroOS" grava em `C:\Users\vinni\NeuroOS\brain\inbox\diario-x.jsonl`.

**Limite:** uma edição = no máximo 30 min de trabalho. Pronto = `node validar.mjs` diz OK.

## O que o leitor quer (e o que não quer)

Quer o que **muda o dia dele e o coloca na frente**: modelo novo, versão nova de ferramenta que ele usa (Claude Code,
Gemini CLI, Ollama), correção de bug relevante, recurso novo, site premiado, design feito com IA que virou referência,
skill/MCP/repositório útil, e o que gente de fora (EUA, Japão, China, Europa) está escrevendo e fazendo.

**Não quer:** notícia corporativa (IPO, investimento, demissão, processo, política, briga de empresa, números de
mercado). Só entra se mudar preço, limite ou disponibilidade de uma ferramenta que ele usa — e aí o título fala disso.

## Passo a passo

1. **Coletar (custo zero de IA):** `node coletar.mjs --dias 2` (segunda-feira: `--dias 3`). Gera
   `coleta/AAAA-MM-DD.json`: feeds oficiais, vozes de fora (Simon Willison, Latent Space/AINews, Karpathy, Mollick,
   Addy Osmani, dev.to), Japão (Zenn, Qiita), Product Hunt, design (Figma, Awwwards, Dribbble, Muzli, Smashing),
   releases (claude-code, gemini-cli, codex, ollama), Hugging Face em alta, GitHub e Hacker News. Já vem com `imagem`
   e `idioma`, sem links publicados nos últimos 30 dias.
2. **Pré-filtro (economia):** peça ao Antigravity (`antigravity_delegar_tarefa`, `gemini-3.8-flash-medium`,
   somenteLeitura) para ler a coleta e devolver os ~50 itens mais relevantes para o perfil abaixo, como linhas
   `tipo | fonte | data | idioma | título | url`. Se falhar, liste você mesmo com um `node -e` compacto.
3. **Completar o que não tem feed** (WebFetch na página oficial, nunca agregador duvidoso):
   - Awwwards Site do Dia: https://www.awwwards.com/websites/sites_of_the_day/ (abra a página do site para saber técnica)
   - Anthropic: https://www.anthropic.com/news · Google Gemini/AI Studio: https://blog.google/technology/ai/
   - Moonshot Kimi, DeepSeek, Qwen, MiniMax: só se houver lançamento real na janela (Latent Space/AINews costuma trazer)
4. **Ler antes de escrever.** Para cada item escolhido de fora ou com resumo vazio (releases, repositórios), abra a
   página com WebFetch e extraia os fatos. Para texto em japonês, chinês etc., peça a tradução do título e um resumo
   em português no próprio prompt do WebFetch.
5. **Escrever** `edicoes/AAAA-MM-DD.json` (formato abaixo). `numero` = último número em `edicoes/index.json` + 1.
6. **Validar:** `node validar.mjs edicoes/AAAA-MM-DD.json`. Corrija até dar OK. Ele confere links, preenche a foto
   (`imagem`) de cada matéria sozinho e atualiza o índice.

## Seções (campo `categoria`) e quantidades

| categoria | o que entra | qtd |
|---|---|---|
| `inovacoes` | modelos novos, versões de ferramentas (o que mudou/corrigiu), recursos novos, correções de falhas | 5–7 |
| `design` | Site do Dia do Awwwards, design feito com IA, ferramentas de design com IA, modelos de imagem, cases (pode ser traduzido) | 5–7 |
| `resultados` | "Quem fez e deu certo": casos reais **com número** (custo, tempo, %, antes/depois) de quem usou IA, agente ou skill. Sem número na fonte, não entra. Bom lugar para TabNews, Zenn e posts de bastidor | 3–5 |
| `vozes` | especialistas e devs de IA: Fabio Akita, TabNews, Simon Willison, Armin Ronacher, Peter Steinberger, Hamel Husain, Thorsten Ball, Raschka, Interconnects, Zenn/Qiita (Japão). Foco em como estão usando agentes. `idioma` sempre; `titulo_original` quando não for português | 8–10 |
| `classificados` | repositórios em alta, **inclusive antigos que voltaram a bombar** (GitHub Trending diário/semanal/mensal da coleta) | 25–35 |

A aba **24 horas mostra a edição do dia inteira** (Semana e Mês somam as anteriores): a edição precisa ser cheia, 45–55 itens.

### Classificados

- `grupo` obrigatório: `skills`, `design` (design & mídia), `memoria` (memória & contexto), `agentes`, `mcp`, `ferramentas`. Tente ter ao menos 3 por grupo.
- `titulo` = "nome — o que é, em português". `resumo` = 1–2 frases com o que faz e como instala/usa (abra o README com WebFetch dos principais). `pra_voce` = 1 frase curta.
- `estrelas` (ex.: "36,9 mil") e `em_alta` (ex.: "+2,2 mil hoje", "+5,5 mil na semana") vêm do resumo da coleta (`★ total · +N período`). Sem ganho conhecido, omita `em_alta`.
- Priorize o que ele usa ou pode usar já: Claude Code, design/LP, vídeo/motion, memória de agentes, social media.

## Perfil do leitor (para escolher e escrever o "pra você")

Vinicius, designer pleno PJ na V4 Company: landing pages de alta conversão, Estruturação Estratégica, WordPress/
Elementor/Greatpages, Figma. Constrói o NeuroOS (segundo cérebro em Electron + React) e usa Claude Code com skills
próprias (motion, xavier-sm, carrossel), Antigravity/Gemini, MCPs (VectorCraft, PhotoCraft,
EffectCraft, FilmCraft, VoiceStudio). Cria conteúdo gamer (Fortnite) para TikTok, é chefe escoteiro (GEFI), tem um
RPG em 3D (Dossiê 1880). Não lê inglês nem japonês: tudo em português. Tende a rabbit hole: o "pra você" termina em
ação pequena e concreta ("teste em 20 minutos…"), nunca em "vale estudar".

## Regras editoriais

- **Nada inventado.** Toda `fonte_url` veio da coleta ou de uma página que você abriu. Número, data e nome só se
  estavam na fonte. Sem URL verificada, sem item.
- Português do Brasil, frases curtas. `titulo` ≤ 90 caracteres e diz o que muda ("X corrige Y", "X faz Z").
  `resumo` 1–3 frases com fatos. `pra_voce` 1–2 frases.
- Texto estrangeiro (em `vozes` ou `design`): `idioma` ("en", "ja", "zh"…) e `titulo_original` (exato, copiado da fonte); `titulo` é a
  tradução. `fonte_nome` com o país, ex.: "Zenn (Japão)".
- `publicado_em` = data real (AAAA-MM-DD). As abas 24h/Semana/Mês filtram por ela.
- `manchete` = a inovação mais importante do dia (nunca notícia corporativa). `editorial` = 4–5 frases: fato →
  tensão → leitura → direção, terminando numa ação de até 30 minutos.
- Não repetir url de edições anteriores (a coleta já filtra; confira os extras do passo 3).

## Formato

```json
{
  "data": "AAAA-MM-DD",
  "numero": 2,
  "manchete": "id-do-item",
  "editorial": "Fato. Tensão. Leitura. Direção.",
  "teste_do_dia": { "item": "id-de-um-classificado", "passos": ["Instale: ...", "Rode: ...", "Compare e anote no NeuroOS ..."] },
  "itens": [
    { "id": "slug-curto", "titulo": "", "resumo": "", "pra_voce": "", "categoria": "inovacoes",
      "fonte_nome": "", "fonte_url": "https://...", "publicado_em": "AAAA-MM-DD" },
    { "id": "zenn-x", "titulo": "tradução", "titulo_original": "原題", "idioma": "ja", "categoria": "vozes", "...": "..." }
  ]
}
```

`imagem` é opcional: o validador preenche.

## Arquivos do projeto

- `coletar.mjs` — fontes em `RSS_SOURCES`, `GITHUB_QUERIES`, `RELEASE_REPOS` e `HN_QUERIES`.
- `validar.mjs` — confere formato, ids e links, preenche fotos e reescreve `edicoes/index.json`.
- `server.mjs` — serve o site e recebe o "Salvar no NeuroOS".
- `index.html` — o jornal (abas 24h/Semana/Mês, cadernos, classificados, fotos animadas, salvar).

## Skill para testar hoje (`teste_do_dia`)

Escolha **um** classificado (skill, MCP ou ferramenta) que dê para testar em 30 minutos e que tenha a ver com o dia
dele (LP, design, vídeo, NeuroOS, conteúdo). `passos` = 2 a 4 frases curtas, só com comandos que estão no README
(instalação e uso). O último passo sempre fecha com "anote no NeuroOS o resultado". Não repita a skill de ontem.

## Visual (não mexer sem pedir)

O site segue a revisão da skill `impeccable` (crítica em `.impeccable/critique/`): 3 famílias (gótica só no nome,
Source Serif 4, Manrope), escala fixa de 6 tamanhos, vermelho só no "Pra você" e no salvar da manchete, seções com
destaque + 3 e "ver mais", classificados com 3 por grupo. O agente só escreve o JSON; não altere `index.html`.
