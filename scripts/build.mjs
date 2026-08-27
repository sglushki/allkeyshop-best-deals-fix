import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(root, 'src', 'userscript.template.js');
const helpersPath = path.join(root, 'src', 'catalogue-ranking.mjs');
const outputPath = path.join(root, 'allkeyshop-best-deals-fix.user.js');

const [template, helperModule] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(helpersPath, 'utf8'),
]);

const helpers = helperModule.replace(/^export\s+/gm, '');
const output = template.replace('/*__CATALOGUE_HELPERS__*/', helpers);

if (output === template) {
  throw new Error('Build placeholder was not found in userscript.template.js');
}

await writeFile(
  outputPath,
  `// GENERATED FILE — edit src/* and run npm run build.\n${output}`,
  'utf8'
);

console.log(`Built ${path.relative(root, outputPath)}`);
