# Euro One — Codex Runbook (Terminal)

## Repo obrigatório
- Sempre operar somente em: /home/ubuntu/euro-one.replaced-20260304-201722
- Nunca operar em /home/ubuntu/euro-one (origin local), /tmp/*, ou repos backup.

## Fluxo obrigatório para QUALQUER melhoria (do 0 ao deploy)
### 0) Preflight (SEMPRE antes de codar)
Execute:
- cd /home/ubuntu/euro-one.replaced-20260304-201722
- git fetch origin
- git checkout main
- git reset --hard origin/main
- git clean -fd
- git status -sb
- git rev-parse HEAD
- git log -1 --oneline

Se houver qualquer coisa diferente do esperado, ABORTAR e reportar.

### 1) Branch
- Criar branch nova a partir do main atualizado:
  BRANCH="feat/<slug>-$(date +%Y%m%d-%H%M)"
  git checkout -b "$BRANCH"

### 2) Implementar
- Fazer as alterações solicitadas no source.
- Rodar lint/test/build do projeto quando existir.

### 3) Commit + Push
- git add -A
- git commit -m "<mensagem objetiva>"
- git push -u origin "$BRANCH"

### 4) PR + Merge (automático)
- Garantir gh autenticado (se necessário: gh auth login)
- Criar PR:
  gh pr create --base main --head "$BRANCH" --title "<titulo>" --body "<descricao>"
- Merge com squash e deletar branch:
  gh pr merge --squash --delete-branch --admin

### 5) Pós-merge: garantir HEAD do main
- git checkout main
- git pull --ff-only origin main
- MAIN_SHA=$(git rev-parse HEAD)

### 6) Build TGZ (obrigatório)
- Gerar um .tgz de release do front (sem patch em dist).
- O TGZ final deve ser colocado em /home/ubuntu/backups/euro-one-front/ (OFFICIAL_FRONT_BUILD.*.tgz)
- Confirmar que o TGZ contém version.json e que version.json.gitSha == MAIN_SHA.

### 7) Deploy (sempre o correto)
- Publicar SOMENTE via:
  sudo publish-front-next /caminho/exato/do/tgz
- Nunca usar publish-front-line-a.sh (bloqueado).
- Nunca usar publish-front (00h22 rollback) a não ser que o usuário peça explicitamente rollback.

### 8) Validar produção
- curl -fsSL https://rastreamento.eurosolucoes.tech/version.json
- Confirmar gitSha == MAIN_SHA e hotfix/builtAt correspondem ao TGZ publicado.

## Output final obrigatório
Sempre reportar:
- PR link
- MAIN_SHA
- caminho do TGZ publicado
- version.json em produção
