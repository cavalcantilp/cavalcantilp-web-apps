#!/usr/bin/env node
/**
 * Récupère l'historique des dividendes des valeurs du CAC 40 et écrit
 * data/cac40-dividends.json, consommé par l'app /bourse.
 *
 * Lancé par .github/workflows/update-dividends.yml (cron quotidien).
 * La clé API vient de l'environnement (GitHub Secrets), jamais du dépôt.
 *
 * Changer de fournisseur = réécrire fetchDividends() uniquement : le reste
 * du script et le format de sortie ne dépendent pas de l'API choisie.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONSTITUENTS_PATH = join(ROOT, 'data', 'cac40-constituents.json');
const OUTPUT_PATH = join(ROOT, 'data', 'cac40-dividends.json');

const API_KEY = process.env.TWELVEDATA_API_KEY;
// Surchargeable pour les tests (API simulée) ou si l'on passe par un proxy.
const API_BASE = process.env.TWELVEDATA_API_BASE || 'https://api.twelvedata.com';
const EXCHANGE = 'XPAR';

// Nombre d'années d'historique demandées.
const HISTORY_YEARS = 10;

// Pause entre deux appels, pour rester sous la limite de débit du plan gratuit.
const THROTTLE_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Interroge le fournisseur pour un symbole donné.
 * Retourne un tableau [{ ex_date, payment_date, amount }] trié du plus récent
 * au plus ancien, ou lève une erreur si la réponse est inexploitable.
 *
 * >>> Seule fonction à réécrire en cas de changement de fournisseur. <<<
 */
async function fetchDividends(symbol) {
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - HISTORY_YEARS);

  const url = new URL('/dividends', API_BASE);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('exchange', EXCHANGE);
  url.searchParams.set('start_date', startDate.toISOString().slice(0, 10));
  url.searchParams.set('apikey', API_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const body = await res.json();

  // L'API répond 200 même sur erreur métier : le statut est dans le corps.
  if (body.status === 'error') throw new Error(body.message || 'erreur API');

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
  if (!API_KEY) {
    console.error('TWELVEDATA_API_KEY absent de l\'environnement.');
    process.exit(1);
  }

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

  const stocks = [];
  const failures = [];

  for (const { symbol, name } of constituents.stocks) {
    try {
      const dividends = await fetchDividends(symbol);
      stocks.push({ symbol, name, dividends, last_sync: new Date().toISOString() });
      console.log(`${symbol} : ${dividends.length} dividende(s)`);
    } catch (err) {
      const kept = previousBySymbol.get(symbol);
      failures.push(`${symbol} (${err.message})`);
      // On réinjecte les données précédentes si on en a, sinon une entrée vide
      // pour que la valeur reste listée dans l'app.
      stocks.push(kept ?? { symbol, name, dividends: [], last_sync: null });
      console.warn(`${symbol} : échec — ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }

  // Un échec isolé est toléré (données précédentes conservées), mais si tout
  // échoue c'est un problème de clé ou de quota : on veut que l'Action échoue.
  if (failures.length === constituents.stocks.length) {
    console.error('Tous les symboles ont échoué — clé API ou quota probablement en cause.');
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
