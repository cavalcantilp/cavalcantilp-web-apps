#!/usr/bin/env node
/**
 * Récupère l'historique des dividendes des valeurs du CAC 40 et écrit
 * data/cac40-dividends.json, consommé par l'app /bourse.
 *
 * Lancé par .github/workflows/update-dividends.yml (cron quotidien).
 * La clé API vient de l'environnement (GitHub Secrets), jamais du dépôt.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCHANGE, apiGet, forEachStock, requireApiKey } from './lib/twelvedata.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONSTITUENTS_PATH = join(ROOT, 'data', 'cac40-constituents.json');
const OUTPUT_PATH = join(ROOT, 'data', 'cac40-dividends.json');

// Nombre d'années d'historique demandées.
const HISTORY_YEARS = 10;

function startDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - HISTORY_YEARS);
  return d.toISOString().slice(0, 10);
}

/** Dividendes d'un symbole, du plus récent au plus ancien. */
async function fetchDividends(symbol) {
  const body = await apiGet('/dividends', {
    symbol,
    exchange: EXCHANGE,
    start_date: startDate(),
  });

  const rows = Array.isArray(body.dividends) ? body.dividends : [];

  return rows
    .map((row) => ({
      ex_date: row.ex_date ?? null,
      payment_date: row.payment_date ?? row.ex_date ?? null,
      amount: Number(row.amount),
    }))
    .filter((d) => d.ex_date && Number.isFinite(d.amount) && d.amount > 0)
    .sort((a, b) => b.ex_date.localeCompare(a.ex_date));
}

async function main() {
  requireApiKey();

  const constituents = JSON.parse(await readFile(CONSTITUENTS_PATH, 'utf8'));

  // On repart du fichier existant : si un symbole échoue aujourd'hui, on
  // conserve ses dernières données connues plutôt que de les perdre.
  let previous = { stocks: [] };
  try {
    previous = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    // Première exécution : pas de fichier précédent, ce n'est pas une erreur.
  }
  const previousBySymbol = new Map((previous.stocks ?? []).map((s) => [s.symbol, s]));

  const bySymbol = new Map();
  let succeeded = 0;

  const failures = await forEachStock(constituents.stocks, async ({ symbol, name }) => {
    try {
      const dividends = await fetchDividends(symbol);
      bySymbol.set(symbol, { symbol, name, dividends });
      succeeded++;
      console.log(`${symbol} : ${dividends.length} dividende(s)`);
    } catch (err) {
      // On réinjecte les données précédentes si on en a, sinon une entrée vide
      // pour que la valeur reste listée dans l'app.
      bySymbol.set(symbol, previousBySymbol.get(symbol) ?? { symbol, name, dividends: [] });
      throw err;
    }
  });

  // Les valeurs jamais atteintes (arrêt anticipé) gardent leur état connu :
  // le fichier reste complet, aucune valeur ne disparaît de l'app.
  const stocks = constituents.stocks.map(({ symbol, name }) =>
    bySymbol.get(symbol) ?? previousBySymbol.get(symbol) ?? { symbol, name, dividends: [] }
  );

  // Un échec isolé est toléré (données précédentes conservées), mais si rien
  // n'a abouti c'est un problème de clé, de plan ou de quota : l'Action doit
  // échouer pour que le problème soit visible.
  if (succeeded === 0) {
    console.error('Aucune valeur récupérée — clé API, plan souscrit ou quota à vérifier.');
    process.exit(1);
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: 'twelvedata',
    currency: 'EUR',
    exchange: EXCHANGE,
    failures,
    stocks,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\nÉcrit ${OUTPUT_PATH} — ${stocks.length} valeurs, ${failures.length} échec(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
