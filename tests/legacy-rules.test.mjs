import test from 'node:test';
import assert from 'node:assert/strict';
import {runRangeRegression} from '../tactical-map/simulation-range-regression.js?v=aviation-deck-1';
import {runEquipmentRegressionTests} from '../tactical-map/simulation-equipment-regression.js?v=aviation-deck-1';
test('original range rule regressions remain part of the full suite',async t=>{const r=runRangeRegression();for(const row of r.results)await t.test(row.name,()=>assert.equal(row.passed,true,row.error));});
test('original equipment damage, repair and sinking regressions remain part of the full suite',async t=>{const original=console.table;let r;try{console.table=()=>{};r=runEquipmentRegressionTests();}finally{console.table=original;}for(const row of r.results)await t.test(row.name,()=>assert.equal(row.passed,true,row.error));});
