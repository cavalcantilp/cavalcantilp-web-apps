#!/usr/bin/env node
/**
 * Récupère l'historique des cours de clôture des valeurs du CAC 40 et écrit
 * un fichier par valeur dans data/prices/, consommé par le graphique de /bourse.
 *
 * Un fichier par valeur, et non un fichier commun : le navigateur ne télécharge
 * que la valeur affichée (~75 Ko) au lieu de plusieurs Mo, et les diffs git
 * restent lisibles valeur par valeur.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCHANGE, apiGet, forEachStock, requireApiKey } from './lib/twelvedata.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONSTITUENTS_PATH = join(ROOT, 'data', 'cac40-constituents.json');
const OUTPUT_DIR = join(ROOT, 'data', 'prices');

const HISTORY_YEARS = 10;
// Plafond de points renvoyés par l'API : 10 ans de séances en font ~2 550.
const OUTPUT_SIZE = 5000;

function startDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - HISTORY_YEARS);
  return d.toISOString().slice(0, 10);
}

/**
 * Cours de clôture d'un symbole, du plus ancien au plus récent.
 * Format compact [date, clôture] : sur ~2 500 points, les noms de champs
 * répétés d'un format objet pèseraient plus lourd que les données elles-mêmes.
 */
async function fetchPrices(symbol) {
  const body = await apiGet('/time_series', {
    symbol,
    exchange: EXCHANGE,
    interval: '1day',
    start_date: startDate(),
    outputsize: OUTPUT_SIZE,
    order: 'ASC',
  });

  const rows = Array.isArray(body.values) ? body.values : [];

  return rows
    .map((row) => [String(row.datetime ?? '').slice(0, 10), Number(row.close)])
    .filter(([date, close]) => date && Number.isFinite(close) && close > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Un cours par ligne, et pas d'horodatage de génération dans le fichier.
 * Ainsi une synchro quotidienne n'ajoute qu'une ligne au lieu de réécrire tout
 * le fichier, et un fichier ne change que si les cours ont réellement bougé.
 * La fraîcheur se lit sur la date du dernier point.
 */
function serialize({ symbol, name, prices }) {
  const rows = prices.map(([d, c]) => `[${JSON.stringify(d)},${c}]`).join(',\n');
  return `{
"symbol": ${JSON.stringify(symbol)},
"name": ${JSON.stringify(name)},
"currency": "EUR",
"exchange": ${JSON.stringify(EXCHANGE)},
"prices": [
${rows}
]
}
`;
}

async function main() {
  requireApiKey();

  const constituents = JSON.parse(await readFile(CONSTITUENTS_PATH, 'utf8'));
  await mkdir(OUTPUT_DIR, { recursive: true });

  let written = 0;

  const failures = await forEachStock(constituents.stocks, async ({ symbol, name }) => {
    const outPath = join(OUTPUT_DIR, `${symbol}.json`);
    const prices = await fetchPrices(symbol);

    // Un fichier vide écrasant un historique valide serait une régression
    // silencieuse : on préfère garder l'existant et signaler l'anomalie.
    if (prices.length === 0) throw new Error('aucun cours renvoyé');

    await writeFile(outPath, serialize({ symbol, name, prices }), 'utf8');
    written++;
    console.log(`${symbol} : ${prices.length} cours`);
  });

  if (written === 0) {
    console.error('Aucune valeur récupérée — clé API ou quota probablement en cause.');
    process.exit(1);
  }

  console.log(`\nÉcrit ${written} fichier(s) dans ${OUTPUT_DIR}, ${failures.length} échec(s).`);
  if (failures.length) console.log('Échecs :', failures.join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
