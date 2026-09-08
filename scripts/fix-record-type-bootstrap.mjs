import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'scripts/apply-record-type-selector.mjs';
let source = readFileSync(path, 'utf8');
const from = '  return \\`${RECORD_TYPE_SELECTOR_PREFIX}\\${payload}\\`;';
const to = '  return RECORD_TYPE_SELECTOR_PREFIX + payload;';
if (!source.includes(from)) throw new Error('bootstrap literal target not found');
source = source.replace(from, to);
writeFileSync(path, source);
unlinkSync('scripts/fix-record-type-bootstrap.mjs');
