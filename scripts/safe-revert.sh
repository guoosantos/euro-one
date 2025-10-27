set -euo pipefail
last=$(ls -1d backups/deploy-* 2>/dev/null | tail -n1 || true)
[ -n "${last:-}" ] || { echo "❌ nenhum backup em backups/deploy-*"; exit 1; }
[ -d "$last/dist" ] || { echo "❌ backup sem dist: $last"; exit 1; }
echo "↩️  revertendo para $last"
sudo rsync -a --delete "$last/dist"/ /var/www/euro/web/
sudo systemctl reload nginx
echo "✅ revertido"
