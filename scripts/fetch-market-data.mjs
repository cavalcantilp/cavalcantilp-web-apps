#!/usr/bin/env node
/**
 * Récupère cours et dividendes des valeurs du CAC 40 auprès de Yahoo Finance
 * et écrit data/cac40-dividends.json + data/prices/<TICKER>.json.
 *
 * Un seul appel par valeur couvre les deux jeux de données, là où l'ancien
 * fournisseur en demandait deux (dont un hors plan gratuit).
 *
 * Lancé par .github/workflows/update-market-data.yml (cron quotidien).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THROTTLE_MS, fetchChart, sleep } from './lib/yahoo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONSTITUENTS_PATH = join(ROOT, 'data', 'cac40-constituents.json');
const DIVIDENDS_PATH = join(ROOT, 'data', 'cac40-dividends.json');
const PRICES_DIR = join(ROOT, 'data', 'prices');

const HISTORY_YEARS = 10;

/**
 * Un cours par ligne, sans horodatage de génération : une synchro quotidienne
 * n'ajoute qu'une ligne, et le fichier ne change que si les cours ont bougé.
 */
function serializePrices({ symbol, name, currency, prices }) {
  const rows = prices.map(([d, c]) => `[${JSON.stringify(d)},${c}]`).join(',\n');
  return `{
"symbol": ${JSON.stringify(symbol)},
"name": ${JSON.stringify(name)},
"currency": ${JSON.stringify(currency)},
"exchange": "XPAR",
"prices": [
${rows}
]
}
`;
}

async function main() {
  const constituents = JSON.parse(await readFile(CONSTITUENTS_PATH, 'utf8'));
  await mkdir(PRICES_DIR, { recursive: true });

  // On repart des dividendes existants : une valeur en échec conserve ses
  // dernières données connues plutôt que de disparaître de l'app.
  let previous = { stocks: [] };
  try {
    previous = JSON.parse(await readFile(DIVIDENDS_PATH, 'utf8'));
  } catch { /* première exécution */ }
  const previousBySymbol = new Map((previous.stocks ?? []).map((s) => [s.symbol, s]));

  const since = new Date();
  since.setFullYear(since.getFullYear() - HISTORY_YEARS);

  const dividendsBySymbol = new Map();
  const failures = [];
  let succeeded = 0;

  for (const { symbol, name, yahoo } of constituents.stocks) {
    try {
      const { currency, prices, dividends } = await fetchChart(yahoo, since);
      if (prices.length === 0) throw new Error('aucun cours renvoyé');

      await writeFile(join(PRICES_DIR, `${symbol}.json`), serializePrices({ symbol, name, currency, prices }), 'utf8');
      // Le fichier de dividendes les stocke du plus récent au plus ancien,
      // ordre dans lequel l'app les affiche.
      dividendsBySymbol.set(symbol, { symbol, name, dividends: [...dividends].reverse() });
      succeeded++;
      console.log(`${symbol} : ${prices.length} cours, ${dividends.length} dividende(s)`);
    } catch (err) {
      failures.push(`${symbol} (${err.message})`);
      dividendsBySymbol.set(symbol, previousBySymbol.get(symbol) ?? { symbol, name, dividends: [] });
      console.warn(`${symbol} : échec — ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }

  const stocks = constituents.stocks.map(({ symbol, name }) =>
    dividendsBySymbol.get(symbol) ?? previousBySymbol.get(symbol) ?? { symbol, name, dividends: [] }
  );

  await writeFile(
    DIVIDENDS_PATH,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: 'yahoo-finance',
      currency: 'EUR',
      exchange: 'XPAR',
      failures,
      stocks,
    }, null, 2) + '\n',
    'utf8'
  );

  console.log(`\n${succeeded}/${constituents.stocks.length} valeurs récupérées, ${failures.length} échec(s).`);
  if (failures.length) console.log('Échecs :', failures.join(', '));

  // Rien n'a abouti : source indisponible ou format changé. L'Action doit
  // échouer pour que ce soit visible plutôt que de laisser les données figées.
  if (succeeded === 0) {
    console.error('Aucune valeur récupérée — source indisponible ou format de réponse modifié.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
