import test from 'node:test';
import assert from 'node:assert/strict';
import {NAVAL_SYMBOL_OPTIONS,NAVAL_ICON_SCALE,navalSymbolPath,navalSymbolFor} from '../js/naval-symbols.js';
import {initializeCatalog} from '../js/catalog-store.js';

test('five naval display markers round-trip through the catalog without altering combat attributes',()=>{
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  const catalog=initializeCatalog([]);
  const base=catalog.units.find(unit=>unit.branch==='navy');
  const paths=new Set();
  for(const [key] of NAVAL_SYMBOL_OPTIONS){
    const value=structuredClone(base);
    value.id='symbol-'+key; value.protected=false; value.naval.iconType=key;
    catalog.saveUnit(value);
    const saved=catalog.units.find(unit=>unit.id===value.id);
    assert.equal(navalSymbolFor({snapshot:saved}),key);
    const {iconType,...attributes}=saved.naval;
    const {iconType:old,...original}=base.naval;
    assert.deepEqual(attributes,original);
    for(let size=1;size<=5;size++){
      const path=navalSymbolPath(key,size);
      assert.ok(!/NaN|Infinity/.test(path));
      assert.ok(path.endsWith(' Z'));
    }
    paths.add(navalSymbolPath(key));
  }
  assert.equal(paths.size,5);
  const raw=catalog.exportJSON();catalog.importJSON(raw);
  for(const [key] of NAVAL_SYMBOL_OPTIONS)
    assert.equal(catalog.units.find(u=>u.id==='symbol-'+key).naval.iconType,key);
  assert.equal(navalSymbolFor({snapshot:{naval:{type:'BB'}}}),'combat');
  const before=catalog.exportJSON();
  assert.throws(()=>catalog.saveUnit({...base,id:'bad-symbol',protected:false,naval:{...base.naval,iconType:'invalid'}}),/マーク/);
  assert.equal(catalog.exportJSON(),before);
  assert.equal(NAVAL_ICON_SCALE/.5,.55);
});
