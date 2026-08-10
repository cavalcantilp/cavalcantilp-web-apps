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
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const body = await res.json();
  if (body.status === 'error') throw new Error(body.message || 'erreur API');
  return body;
}

/**
 * Parcourt les valeurs en séquence (throttle entre chaque) et applique
 * handler. Une erreur sur une valeur n'interrompt pas les suivantes : elle est
 * collectée et renvoyée dans `failures`.
 */
export async function forEachStock(stocks, handler) {
  const failures = [];
  for (const stock of stocks) {
    try {
      await handler(stock);
    } catch (err) {
      failures.push(`${stock.symbol} (${err.message})`);
      console.warn(`${stock.symbol} : échec — ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  return failures;
}
