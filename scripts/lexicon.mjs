#!/usr/bin/env node
/**
 * Reads and enriches the stored lexicon (DEC-17).
 *
 * The app has no settings screen yet, and the terms that matter most — this
 * client's people, their systems, the three acronyms only they use — are the
 * ones no shipped list can contain. This is the surface for putting them in
 * until there is a screen for it, and it writes the same table the meeting path
 * reads, so a term added here is boosted in the next call.
 *
 *   node scripts/lexicon.mjs list [--client <name>]
 *   node scripts/lexicon.mjs add <term…> --scope account|client [--client <name>]
 *                                        [--category esn|tech-en|person|company|project]
 *   node scripts/lexicon.mjs rm <term> --scope account|client [--client <name>]
 *   node scripts/lexicon.mjs import <file> --scope … [--client …]   one term per line
 *
 *   --db <path>   default: the installed app's database for this platform
 *
 * Client-scoped terms only ever apply to that client's meetings. Account-scoped
 * terms apply to all of them, which is the right home for the ESN's own offers
 * and internal names and the wrong home for a client's staff.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

/** Where Electron's `app.getPath('userData')` lands, per platform. */
const defaultDb = () => {
  const home = os.homedir();
  const dir =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'sillage')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'sillage')
        : path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'sillage');
  return path.join(dir, 'sillage.db');
};

const parseArgs = (argv) => {
  const options = { command: argv[0], words: [], scope: null, client: '', category: 'project', db: null };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--scope') options.scope = next();
    else if (arg === '--client') options.client = next();
    else if (arg === '--category') options.category = next();
    else if (arg === '--db') options.db = path.resolve(next());
    else if (arg.startsWith('--')) throw new Error(`option inconnue: ${arg}`);
    else options.words.push(arg);
  }
  return options;
};

/**
 * `--client` implies the client scope. Requiring both would be a trap: the
 * mistake it invites is a client's staff filed account-wide, where they are
 * boosted in every other client's meetings.
 */
const resolveScope = (options) => {
  const scope = options.scope ?? (options.client ? 'client' : null);
  if (scope !== 'account' && scope !== 'client') {
    throw new Error('précisez --scope account|client (ou --client <nom>)');
  }
  if (scope === 'client' && !options.client.trim()) {
    throw new Error('--scope client demande --client <nom>');
  }
  return scope;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command || options.command === 'help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }

  const dbPath = options.db ?? defaultDb();
  if (!fs.existsSync(dbPath) && options.command === 'list') {
    console.error(`\n  ✗ aucune base à ${dbPath}\n`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const { Store } = await load('electron/modules/store/index.ts');
  const store = new Store(dbPath);

  if (options.command === 'list') {
    const terms = options.client ? store.lexicon.forClient(options.client) : store.lexicon.all();
    console.log('');
    if (terms.length === 0) console.log('  (lexique vide)');
    for (const t of terms) {
      const where = t.scope === 'client' ? `client:${t.scopeKey}` : 'compte';
      const heard = t.hits > 0 ? ` · ${t.hits}×` : '';
      const variants = t.variants.length > 0 ? ` ← ${t.variants.join(', ')}` : '';
      console.log(`  ${t.term.padEnd(24)} ${where.padEnd(20)} ${t.category}${heard}${variants}`);
    }
    console.log(`\n  ${terms.length} terme(s) · ${dbPath}\n`);
    store.close();
    return;
  }

  if (options.command === 'add' || options.command === 'import') {
    const scope = resolveScope(options);
    const words =
      options.command === 'import'
        ? fs
            .readFileSync(path.resolve(options.words[0]), 'utf8')
            .split('\n')
            .map((l) => l.replace(/#.*$/, '').trim())
            .filter(Boolean)
        : options.words;
    if (words.length === 0) throw new Error('aucun terme à ajouter');

    store.lexicon.addAll(
      words.map((term) => ({ term, category: options.category, scope, scopeKey: options.client })),
    );
    console.log(`\n  + ${words.length} terme(s) — ${scope}${options.client ? ` ${options.client}` : ''}\n`);
    store.close();
    return;
  }

  if (options.command === 'rm') {
    const scope = resolveScope(options);
    for (const term of options.words) store.lexicon.remove(scope, options.client, term);
    console.log(`\n  − ${options.words.length} terme(s)\n`);
    store.close();
    return;
  }

  throw new Error(`commande inconnue: ${options.command}`);
};

main().catch((err) => {
  console.error(`\n  ✗ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
