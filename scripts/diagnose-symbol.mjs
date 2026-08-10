#!/usr/bin/env node
/**
 * Essaie plusieurs façons de désigner une valeur d'Euronext Paris et affiche
 * celle que l'API accepte. Utilitaire de diagnostic ponctuel, pas appelé par
 * la synchronisation quotidienne.
 *
 * Volontairement économe : le plan gratuit n'autorise que 8 crédits/minute,
 * donc on teste une seule valeur et on espace les essais.
 */

import { API_BASE, API_KEY, requireApiKey, sleep } from './lib/twelvedata.mjs';

const SYMBOL = process.env.DIAG_SYMBOL || 'AI'; // Air Liquide
const DELAY_MS = 8000;

const variantes = [
  { label: "exchange=XPAR (actuel)", params: { symbol: SYMBOL, exchange: 'XPAR' } },
  { label: 'mic_code=XPAR', params: { symbol: SYMBOL, mic_code: 'XPAR' } },
  { label: 'exchange=Euronext', params: { symbol: SYMBOL, exchange: 'Euronext' } },
  { label: `symbol=${SYMBOL}.PA`, params: { symbol: `${SYMBOL}.PA` } },
  { label: 'sans place', params: { symbol: SYMBOL } },
];

requireApiKey();

for (const [i, { label, params }] of variantes.entries()) {
  const url = new URL('/time_series', API_BASE);
  for (const [k, v] of Object.entries({ ...params, interval: '1day', outputsize: 1 })) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', API_KEY);

  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    const nb = Array.isArray(body?.values) ? body.values.length : 0;

    if (res.ok && nb > 0) {
      const m = body.meta ?? {};
      console.log(`✅ ${label} → OK — ${nb} point(s), ${m.exchange ?? '?'} / ${m.mic_code ?? '?'} / ${m.currency ?? '?'}`);
      console.log(`   dernier point : ${body.values[0].datetime} clôture ${body.values[0].close}`);
    } else {
      console.log(`❌ ${label} → HTTP ${res.status} — ${body?.message ?? 'réponse vide'}`);
    }
  } catch (err) {
    console.log(`❌ ${label} → ${err.message}`);
  }

  if (i < variantes.length - 1) await sleep(DELAY_MS);
}
