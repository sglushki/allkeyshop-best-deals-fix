import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rewriteCatalogueUrl } from '../src/rewrite-catalogue-url.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(root, 'src', 'userscript.template.js');
const outputPath = path.join(root, 'allkeyshop-best-deals-fix.user.js');

const template = await readFile(templatePath, 'utf8');
const helper = rewriteCatalogueUrl
  .toString()
  .replace(/^function rewriteCatalogueUrl/, 'function rewriteCatalogueUrl');

const output = template.replace('/*__REWRITE_CATALOGUE_URL__*/', helper);

if (output === template) {
  throw new Error('Build placeholder was not found in userscript.template.js');
}

await writeFile(
  outputPath,
  `// GENERATED FILE — edit src/* and run npm run build.\n${output}`,
  'utf8'
);

console.log(`Built ${path.relative(root, outputPath)}`);
