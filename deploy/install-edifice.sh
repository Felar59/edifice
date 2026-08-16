#!/usr/bin/env bash
#
# Installe Édifice sur le VPS, à côté d'emoji-art et de la vallée, sans les
# toucher. À lancer EN ROOT sur le serveur, avec nginx-edifice.conf à côté.
#
#   sudo bash install-edifice.sh
#
# Ce qu'il fait, et pourquoi c'est tout ce qu'il fait :
#   1. crée /var/www/edifice/dist, propriété de `deploy` — le même utilisateur
#      que les autres sites, pour que le rsync de mise à jour n'ait jamais
#      besoin de root ;
#   2. retire le nom 164-132-99-194.sslip.io de picturetodmc — il n'y servait
#      qu'une redirection d'échafaudage — après sauvegarde datée de sa config ;
#   3. pose la config d'Édifice, vérifie la syntaxe, recharge nginx ;
#   4. vérifie que le renouvellement des certificats passe toujours à blanc.
#      Ce point n'est pas du zèle : le nom repris est un SAN de DEUX
#      certificats, et un webroot cassé ne se voit que soixante jours plus
#      tard, quand tout expire en silence.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "✖ Lance ce script en root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/nginx-edifice.conf" ] || { echo "✖ nginx-edifice.conf introuvable à côté du script."; exit 1; }

PDMC=/etc/nginx/sites-available/picturetodmc
SSLIP=164-132-99-194.sslip.io

echo "==> 1/4  Racine web /var/www/edifice/dist (propriété deploy)"
install -d -o deploy -g deploy /var/www/edifice/dist

echo "==> 2/4  Reprise du nom $SSLIP (sauvegarde de picturetodmc d'abord)"
cp -a "$PDMC" "$PDMC.avant-edifice.$(date +%Y%m%d-%H%M%S)"
# Deux retouches, dans le bon ordre : d'abord le bloc :443 entier — celui dont
# le nom repris est le SEUL nom — puis le nom retiré de la liste du bloc :80,
# où il figure parmi d'autres. L'ordre compte : dans l'autre sens, le premier
# motif attraperait les deux lignes. Le script python vit dans un fichier à
# part plutôt qu'ici même : un heredoc a déjà mangé ses antislashs une fois.
python3 "$HERE/reprend-le-nom.py" "$PDMC" "$SSLIP"

echo "==> 3/4  Config nginx d'Édifice"
cp "$HERE/nginx-edifice.conf" /etc/nginx/sites-available/edifice
ln -sf /etc/nginx/sites-available/edifice /etc/nginx/sites-enabled/edifice
nginx -t
systemctl reload nginx

echo "==> 4/4  Le renouvellement des certificats passe-t-il toujours ?"
certbot renew --dry-run --quiet && echo "    renouvellement : OK"

echo "✔ Terminé. Le musée attend son contenu dans /var/www/edifice/dist"
