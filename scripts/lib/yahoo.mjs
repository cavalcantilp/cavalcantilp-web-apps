/**
 * Client pour l'endpoint « chart » public de Yahoo Finance.
 *
 * Retenu après l'échec de Twelve Data : son plan gratuit refuse /dividends
 * (403, réservé aux offres payantes) et plafonne à 8 appels/minute. Yahoo
 * renvoie cours ET dividendes en une seule requête, sans clé ni quota déclaré.
 *
 * En contrepartie c'est une API non documentée : elle peut changer sans
 * préavis. Les scripts appelants doivent donc traiter un échec comme normal et
 * conserver les données précédentes plutôt que de les écraser.
 *
 * ⚠️ NE FONCTIONNE PAS depuis un runner GitHub : Yahoo répond 429 dès la
 * première requête, avant tout volume — ce sont les adresses IP de centres de
 * données qui sont refusées, pas notre cadence. Ce code reste valide et tourne
 * correctement depuis une connexion ordinaire ; seul le lieu d'exécution pose
 * problème. Ralentir les appels ne changerait rien.
 */

const API_BASE = process.env.YAHOO_API_BASE || 'https://query1.finance.yahoo.com';

// Yahoo rejette les requêtes sans navigateur identifiable.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Sans quota publié, on reste courtois : ~2 appels/seconde.
export const THROTTLE_MS = Number(process.env.YAHOO_THROTTLE_MS ?? 500);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cours de clôture et dividendes d'une valeur depuis `since` (Date).
 * Retourne { currency, prices: [[date, close]], dividends: [{ex_date, amount}] },
 * les deux triés du plus ancien au plus récent.
 */
export async function fetchChart(yahooSymbol, since) {
  const url = new URL(`/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`, API_BASE);
  url.searchParams.set('period1', Math.floor(since.getTime() / 1000));
  url.searchParams.set('period2', Math.floor(Date.now() / 1000));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'div');

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });

  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* réponse non JSON : on garde le texte */ }

  // L'erreur peut arriver en statut HTTP ou dans chart.error, selon le cas.
  const apiError = body?.chart?.error;
  if (!res.ok || apiError) {
    const detail = apiError?.description || apiError?.code || body?.message || text.trim().slice(0, 200);
    const err = new Error(`HTTP ${res.status} — ${detail || res.statusText}`);
    err.status = res.status;
    throw err;
  }

  const result = body?.chart?.result?.[0];
  if (!result) throw new Error('réponse sans résultat');

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const prices = timestamps
    .map((ts, i) => [toIsoDate(ts), closes[i]])
    // Yahoo insère des null les jours sans cotation : on les écarte.
    .filter(([date, close]) => date && Number.isFinite(close) && close > 0)
    .map(([date, close]) => [date, Math.round(close * 100) / 100]);

  const dividends = Object.values(result.events?.dividends ?? {})
    .map((d) => ({ ex_date: toIsoDate(d.date), amount: Number(d.amount) }))
    .filter((d) => d.ex_date && Number.isFinite(d.amount) && d.amount > 0)
    .sort((a, b) => a.ex_date.localeCompare(b.ex_date));

  return { currency: result.meta?.currency ?? 'EUR', prices, dividends };
}

function toIsoDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}
