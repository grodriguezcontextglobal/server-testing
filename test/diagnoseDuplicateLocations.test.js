'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupDuplicates } = require('../mysql/scripts/diagnose-duplicate-locations');

const loc = (location_id, company_id, location_name) => ({ location_id, company_id, location_name });

test('agrupa por compañía y nombre normalizado; ignora los que no tienen copia', () => {
  const groups = groupDuplicates(
    [loc(26, 133, 'Washington, DC'), loc(122, 133, 'washington,  dc '), loc(31, 136, 'Washington, DC'), loc(5, 133, 'Alicante')],
    new Map(),
  );
  assert.equal(groups.length, 1, 'el mismo nombre en otra compañía no es duplicado');
  assert.deepEqual({ company_id: groups[0].company_id, canonical: groups[0].canonical, duplicates: groups[0].duplicates },
    { company_id: 133, canonical: 26, duplicates: [122] });
  assert.deepEqual(groups[0].variants, ['Washington, DC', 'washington,  dc ']);
});

test('la canónica es la más referenciada; en empate, el id más bajo', () => {
  const rows = [loc(33, 129, 'Fort Lauderdale'), loc(255, 129, 'Fort Lauderdale'), loc(129, 129, 'Fort Lauderdale')];
  assert.equal(groupDuplicates(rows, new Map([[255, 2], [33, 45]]))[0].canonical, 33);
  assert.equal(groupDuplicates(rows, new Map([[255, 9]]))[0].canonical, 255);
  assert.equal(groupDuplicates(rows, new Map())[0].canonical, 33);
});
