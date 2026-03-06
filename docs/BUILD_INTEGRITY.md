# Build Integrity

Este documento define as regras obrigatórias para impedir divergência entre código compilado e commit declarado.

## Regras obrigatórias

1. Build oficial só pode rodar com árvore Git limpa.
2. `gitSha` do `client/dist/version.json` deve ser sempre `git rev-parse HEAD`.
3. Override manual de `GIT_SHA` é proibido.
4. `hotfix` pode ser informado no fluxo oficial via ambiente.
5. Antes de publish, o artefato deve passar validação de integridade.

## Pipeline aplicado

O script `npm run build --workspace client` executa, em ordem:

1. `node ../scripts/build-integrity-precheck.js`
2. `bash ../scripts/prebuild-guard.sh`
3. `vite build`
4. `node ../scripts/write-build-version.js`
5. `node ../scripts/validate-build-integrity.js`

## O que cada etapa valida

### `build-integrity-precheck.js`

- `git diff --quiet`
- `git diff --cached --quiet`
- rejeita arquivos não rastreados
- se sujo, aborta com:
  - `ERRO: working tree suja, faça commit antes de buildar`

### `write-build-version.js`

- escreve `client/dist/version.json`
- `gitSha` vem exclusivamente de `git rev-parse HEAD`
- `builtAt` é gerado no build
- `hotfix` continua vindo de `BUILD_HOTFIX`/`HOTFIX` quando definido

### `validate-build-integrity.js`

- compara `version.json.gitSha` com `git rev-parse HEAD`
- falha se divergirem
- checa sanidade de conteúdo:
  - se bundle contém `trust-center`
  - e `HEAD` não contém arquivos compatíveis com Trust Center
  - aborta com:
    - `ERRO: bundle contém código fora do commit declarado`

## Comandos de verificação manual

### Verificar `gitSha` do build contra `HEAD`

```bash
HEAD_SHA="$(git rev-parse HEAD)"
BUILD_SHA="$(jq -r '.gitSha' client/dist/version.json)"
test "$HEAD_SHA" = "$BUILD_SHA"
```

### Rodar apenas validação de integridade pós-build

```bash
node scripts/validate-build-integrity.js
```
