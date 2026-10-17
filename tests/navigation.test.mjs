import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, reportsHash, orderReports, reportPage, parseReceipt, statusLink } from '../site/navigation.mjs';
import { report } from './fixtures.mjs';
const origin = 'https://uif-community-reports.freepig18.chatgpt.site';
test('filters, order and page round-trip without interpreting text as markup', () => {
 const filters={search:'game & <text>',system:'Nds',outcome:'Issues',environment:'Aroma',version:'1.0.6+abc',runtime:'NooDS'};
 const state=readRoute(reportsHash(filters,'game',3));assert.deepEqual(state.filters,filters);assert.equal(state.sort,'game');assert.equal(state.page,3);
});
test('invalid route options are bounded and do not become UI values',()=>{
 const state=readRoute('#reports?system=bad&outcome=bad&environment=bad&sort=bad&page=90000&search='+'x'.repeat(400));
 assert.equal(state.filters.system,'');assert.equal(state.filters.outcome,'');assert.equal(state.filters.environment,'');assert.equal(state.sort,'recent');assert.equal(state.page,800);assert.equal(state.filters.search.length,200);
});
test('report and status deep links remain distinct from filters',()=>{
 assert.equal(readRoute('#report/'+'A'.repeat(32)).reportId,'a'.repeat(32));
 assert.equal(readRoute('#status?receipt='+'B'.repeat(32)).receipt,'b'.repeat(32));assert.equal(readRoute('#unknown').view,'reports');
});
test('sorting is deterministic and never mutates source data',()=>{
 const a={report:report()},b={report:{...report(),reportId:'b'.repeat(32),gameName:'Another game',reportedAtUtc:'2026-10-17T00:00:00Z'}};
 const source=[a,b];assert.equal(orderReports(source,'recent')[0],b);assert.equal(orderReports(source,'game')[0],b);assert.equal(source[0],a);
 const offset={report:{...b.report,reportedAtUtc:'2026-10-16T23:00:00-02:00'}};
 assert.equal(orderReports([b,offset],'recent')[0],offset);
 const tied={report:{...b.report,reportId:'a'.repeat(32)}};
 assert.equal(orderReports([b,tied],'game')[0],tied);
});
test('pagination bounds page sizes, clamps stale pages and handles an empty registry',()=>{
 const rows=Array.from({length:63},(_,i)=>i);assert.equal(reportPage(rows,1).entries.length,25);
 assert.deepEqual(reportPage(rows,9),{entries:rows.slice(50),current:3,pages:3,start:51,end:63});assert.equal(reportPage([],8).current,1);assert.equal(reportPage([],1).start,0);
});
test('receipt input accepts only exact IDs and trusted status URLs',()=>{
 const id='c'.repeat(32);assert.equal(parseReceipt('  '+id.toUpperCase()+' ',origin),id);assert.equal(parseReceipt(origin+'/receipt/'+id,origin),id);
 const link=statusLink('https://zestyts.github.io/UInjectForge-Community/?ignored=1',id);assert.equal(parseReceipt(link,origin),id);assert.ok(!new URL(link).search);
 assert.equal(parseReceipt(link.replace('#status?receipt=', '#STATUS?RECEIPT='),origin),id);
 for(const input of ['123456','javascript:alert(1)','https://evil.test/receipt/'+id,origin+'/receipt/'+id+'?x=1','https://fake@uif-community-reports.freepig18.chatgpt.site/receipt/'+id])assert.throws(()=>parseReceipt(input,origin));
});
