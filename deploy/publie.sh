#!/usr/bin/env bash
#
# Construit le musée et le publie sur le VPS. À lancer depuis la racine du
# dépôt, sur la machine de travail :
#
#   bash deploy/publie.sh
#
# L'infrastructure (nginx, certificats, reprise du nom) est posée une fois par
# install-edifice.sh ; ce script-ci ne fait que le contenu, et peut donc être
# relancé autant qu'on veut sans rien risquer.
#
# Le transfert passe par tar-sur-ssh et non rsync : le Git Bash de Windows n'a
# pas de rsync, et 21 Mo ne justifient pas d'en installer un. Le --delete de
# rsync est rendu par le rm -rf préalable — le dossier appartient à `deploy`,
# le contenu est régénérable à volonté, il n'y a rien à préserver dedans.
set -euo pipefail

HOTE=ubuntu@164.132.99.194
PORT=2007
CIBLE=/var/www/edifice/dist

echo "==> Construction"
npm run build

echo "==> Publication vers $HOTE:$CIBLE"
ssh -p "$PORT" "$HOTE" "sudo rm -rf '$CIBLE' && sudo install -d -o deploy -g deploy '$CIBLE'"
tar -czf - -C dist . | ssh -p "$PORT" "$HOTE" \
  "sudo tar -xzf - -C '$CIBLE' && sudo chown -R deploy:deploy '$CIBLE'"

echo "==> Vérification"
code=$(curl -s -o /dev/null -w '%{http_code}' https://164-132-99-194.sslip.io/)
[ "$code" = "200" ] || { echo "✖ le site répond $code"; exit 1; }
echo "✔ https://164-132-99-194.sslip.io/ répond 200"
