# Diário X

Jornal pessoal de IA, local: todo dia um agente monta uma edição com 45–55 matérias em português,
cada uma com fonte verificada e um "pra você". Visual de jornal clássico e moderno.

- **Inovações:** modelos novos, versões e correções de ferramentas
- **Design com IA:** Awwwards e referências
- **Quem fez e deu certo:** resultados com número
- **Vozes do ramo:** especialistas traduzidos (Akita, Simon Willison, Zenn…)
- **Classificados:** repositórios do GitHub em alta, por tipo
- **Skill para testar hoje**

Cada matéria tem "Salvar no NeuroOS" (grava em `NeuroOS\brain\inbox\diario-x.jsonl`).

## Rodar

Node 18+, sem dependências.

```bash
node server.mjs          # http://127.0.0.1:51810 (ou Diario-X.bat)
```

## Edição do dia

```bash
node rodar-edicao.mjs    # coleta → Antigravity (agy, Gemini 3.8 Flash) escreve → validar.mjs
```

| Arquivo | O que faz |
|---|---|
| `coletar.mjs` | RSS, GitHub (busca, trending, releases), Hugging Face, HN; sem IA |
| `rodar-edicao.mjs` | orquestra a edição com o Antigravity, até 3 tentativas |
| `validar.mjs` | confere formato, links e repetição; preenche fotos; reescreve `edicoes/index.json` |
| `server.mjs` | serve o site e recebe o "Salvar" |
| `index.html` | o jornal (abas Hoje/Semana/Mês) |
| `instalar-agendamento.ps1` | agenda `rodar-edicao.mjs` às 07:00 no Windows |

Regras editoriais do agente: skill `diario-x` (`~/.claude/skills/diario-x/SKILL.md`).
