# Backup pre-dark-refactor (2026-02-07)

## Snapshot de versão
- Data: 2026-02-07T00:44:30+00:00
- Branch atual: pr-669
- Commit base: 012c67e9e2e22c0beaa380ae7bef530c9c0e6852
- Tag criada: pre-dark-refactor-2026-02-07
- Branch criada: backup/dark-refactor-2026-02-07

## Backup de código (zip)
- Arquivo: /home/ubuntu/backups/euro-one_backup_pre-dark-refactor_2026-02-07.zip
- Origem: /home/ubuntu/euro-one (excluídos node_modules, dist/build, caches, logs e .env)

## Backup de banco (PostgreSQL)
- Dump: /home/ubuntu/backups/db_backup_pre-dark-refactor_2026-02-07.sql
- Smoke test de restore:
  - DB temporário: euro_one_backup_test_20260207
  - Restore aplicado e SELECT 1 executado com sucesso
  - DB temporário removido ao final

## Deploy atual (referência)
- Ambiente: rastreamento.eurosolucoes.tech (Nginx root /var/www/euro-one/dist)
- Commit: 012c67e9e2e22c0beaa380ae7bef530c9c0e6852
- Data: 2026-02-07T00:44:30+00:00

## Rollback (plano)
1. Voltar para a tag: `git checkout pre-dark-refactor-2026-02-07`
2. Rebuild do front: `npm run build --workspace client`
3. Publicar: `sudo rsync -a --delete /home/ubuntu/euro-one/client/dist/ /var/www/euro-one/dist/`
4. Recarregar Nginx: `sudo systemctl reload nginx`
5. Reiniciar backend: `pm2 restart euro-one-server`
