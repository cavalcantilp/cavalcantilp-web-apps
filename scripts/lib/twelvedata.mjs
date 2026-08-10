/**
 * Petit client pour l'API de données de marché, partagé par les scripts de
 * synchronisation (dividendes et cours).
 *
 * Changer de fournisseur = réécrire ce fichier uniquement : les scripts
 * appelants ne connaissent que apiGet() et le format qu'ils en attendent.
 */

export const API_KEY = process.env.TWELVEDATA_API_KEY;
// Surchargeable pour les tests (API simulée) ou si l'on passe par un proxy.
export const API_BASE = process.env.TWELVEDATA_API_BASE || 'https://api.twelvedata.com';
export const EXCHANGE = 'XPAR';

// Pause entre deux appels, pour rester sous la limite de débit du plan gratuit.
export const THROTTLE_MS = Number(process.env.TWELVEDATA_THROTTLE_MS ?? 1000);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function requireApiKey() {
  if (!API_KEY) {
    console.error("TWELVEDATA_API_KEY absent de l'environnement.");
    process.exit(1);
  }
}

/**
 * Appelle un endpoint et retourne le corps JSON.
 * Lève une erreur sur échec HTTP comme sur erreur métier : l'API répond 200
 * même quand elle refuse la requête, le statut réel est dans le corps.
 */
export async function apiGet(path, params) {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', API_KEY);

  const res = await fetch(url);

  // On lit toujours le corps, y compris sur échec HTTP : c'est là que l'API
  // explique le refus (endpoint hors plan, quota dépassé, clé invalide…).
  // Sans ça, un 403 ne dit pas ce qu'il faut corriger.
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* réponse non JSON : on garde le texte brut */ }

  if (!res.ok) {
    const detail = body?.message || text.trim().slice(0, 300) || res.statusText;
    const err = new Error(`HTTP ${res.status} — ${detail}`);
    err.status = res.status;
    throw err;
  }

  if (body?.status === 'error') {
    const err = new Error(body.message || 'erreur API');
    err.status = body.code;
    throw err;
  }
  return body;
}

/**
 * Parcourt les valeurs en séquence (throttle entre chaque) et applique
 * handler. Une erreur sur une valeur n'interrompt pas les suivantes : elle est
 * collectée et renvoyée dans `failures`.
 */
// Refus qui ne dépendent pas du symbole : clé invalide, endpoint hors plan,
// quota épuisé. Inutile de réessayer les 39 valeurs suivantes.
const FATAL_STATUSES = new Set([401, 403, 429]);

export async function forEachStock(stocks, handler) {
  const failures = [];
  for (const [i, stock] of stocks.entries()) {
    try {
      await handler(stock);
    } catch (err) {
      failures.push(`${stock.symbol} (${err.message})`);
      console.warn(`${stock.symbol} : échec — ${err.message}`);

      // Si la toute première valeur est refusée pour une raison globale, on
      // s'arrête net : le message est déjà lisible, insister n'apprend rien.
      if (i === 0 && FATAL_STATUSES.has(err.status)) {
        console.error(
          `\nArrêt : l'API refuse la requête (HTTP ${err.status}). ` +
          `Vérifiez la clé, le plan souscrit et le quota — les autres valeurs échoueraient de la même façon.`
        );
        return failures;
      }
    }
    await sleep(THROTTLE_MS);
  }
  return failures;
}
