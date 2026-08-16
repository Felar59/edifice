# -*- coding: utf-8 -*-
"""Retire un nom d'hôte d'une config nginx, proprement et en le prouvant.

Deux opérations, dans cet ordre :
  1. supprimer le bloc `server { … }` dont ce nom est le SEUL server_name
     (la redirection d'échafaudage) ;
  2. retirer le nom de la liste où il figure parmi d'autres (le bloc :80 qui
     répond aux défis ACME de tous les noms).

Chaque opération vérifie qu'elle a fait exactement une chose : une config
nginx qui dévie de ce qu'on croyait mérite un arrêt net, pas un rafistolage.
"""
import re
import sys

chemin, nom = sys.argv[1], sys.argv[2]
with open(chemin, encoding="utf-8") as f:
    texte = f.read()

blocs = re.split(r"(?=^server \{)", texte, flags=re.M)
gardes = [b for b in blocs if f"server_name {nom};" not in b]
assert len(gardes) == len(blocs) - 1, (
    "le bloc :443 du nom repris devait exister, et une seule fois"
)
texte = "".join(gardes)

apres, n = re.subn(
    rf"(server_name[^;]*) {re.escape(nom)}([^;]*;)", r"\1\2", texte
)
assert n == 1, f"le nom devait figurer dans exactement une liste, trouve {n} fois"

with open(chemin, "w", encoding="utf-8") as f:
    f.write(apres)
print(f"    {nom} : bloc dédié supprimé, alias retiré de la liste ACME")
