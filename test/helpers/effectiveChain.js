'use strict';

/**
 * Cadena EFECTIVA de una ruta de un Express Router: los `router.use` para todo
 * el router registrados antes de ella (denegar por defecto, FedRAMP P1.1)
 * seguidos de los handles de la propia ruta. Devuelve null si la ruta no existe.
 *
 * Mirar solo `layer.route.stack` ya no basta: en los routers cerrados,
 * validateJWT y checkTokenVersion viven en un router.use.
 */
function effectiveChain(router, method, routePath) {
  const index = router.stack.findIndex(
    (l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()]
  );
  if (index === -1) return null;
  const routerLevel = router.stack
    .slice(0, index)
    .filter((l) => !l.route && l.regexp && l.regexp.fast_slash)
    .map((l) => l.handle);
  return [...routerLevel, ...router.stack[index].route.stack.map((l) => l.handle)];
}

module.exports = { effectiveChain };
