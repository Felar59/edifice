/*
** L'environnement que le musée présente au jeu.
**
** `main(int ac, char **av, char **env)` prend trois arguments — le troisième est
** une extension POSIX que tout le monde utilise et que la norme C n'exige pas.
** Emscripten n'en passe que deux : le jeu voit un environnement nul, et comme il
** refuse de démarrer sans DISPLAY, il s'arrête à sa première ligne sans rien
** dire. C'est un garde-fou d'école, qui empêche de lancer le programme par
** mégarde sur une machine sans écran.
**
** Dans un navigateur, il y a un écran. On le lui dit.
**
** Le tableau est bâti ici plutôt que repris de la bibliothèque C : le `environ`
** d'emscripten n'est peuplé que si quelque chose l'a demandé, et le lire trop tôt
** promène le jeu dans une adresse qui ne lui appartient pas — il meurt alors sur
** un débordement de mémoire, dès sa deuxième ligne, sans plus d'explication que
** la première fois.
*/

static char DISPLAY[] = "DISPLAY=:0";
static char *TABLE[2];

char **edifice_environ(void)
{
    TABLE[0] = DISPLAY;
    TABLE[1] = 0;
    return TABLE;
}
