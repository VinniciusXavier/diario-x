# Prompt do Diário X para colar no Antigravity

Use quando quiser rodar a edição na mão (ou criar uma tarefa agendada dentro do Antigravity).
Funciona de qualquer dia: o prompt calcula a data e o número sozinho. Modelo: Gemini 3.8 Flash.
Pasta de trabalho: `C:\Users\vinni\Desktop\APPS IA\6 - Diario X`.

Agendar no Antigravity: crie uma tarefa agendada com este texto, horário 09:00, na pasta acima.
(O Windows já roda sozinho às 09:00 e ao ligar o PC; esta é a rota paralela, se quiser.)

---

```
Você é o editor do Diário X. Trabalhe na pasta C:\Users\vinni\Desktop\APPS IA\6 - Diario X.

1. Leia por inteiro C:\Users\vinni\.claude\skills\diario-x\SKILL.md e siga as regras editoriais,
   as seções, as quantidades e o formato.
2. Descubra a data de hoje (AAAA-MM-DD, fuso de Brasília) e o número da edição: último "numero" em
   edicoes/index.json + 1 (ignore a linha de hoje se já existir). Se edicoes/<hoje>.json já existe, pare e avise.
3. Rode: node coletar.mjs --dias 2   (segunda-feira: --dias 3). Isso grava coleta/<hoje>.json.
4. Escreva edicoes/<hoje>.json com "data" e "numero". Escolha os itens da coleta; para completar
   (Anthropic, Google, Awwwards) abra a página oficial. Todo texto em português do Brasil.
5. Regras inegociáveis:
   - toda fonte_url vem da coleta ou de uma página que você abriu; nunca invente link, data ou número;
   - nunca copie itens das edições anteriores: todo link precisa ser novo;
   - toda matéria de "vozes" precisa de "idioma" ("pt", "en", "ja"...), e "titulo_original" quando o idioma não for "pt".
6. Rode: node validar.mjs edicoes/<hoje>.json
   Se aparecer [ERRO], corrija o arquivo e rode de novo até dar OK. Não altere nenhum outro arquivo
   (o validar.mjs atualiza edicoes/index.json sozinho).
7. Responda em 3 linhas: número, manchete e itens por categoria.
```
