// Excel is a presentation layer. Parsing, identity, scenarios and statistics run in C++.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const locations=[process.env.ONETYPE_ARTIFACT_MODULES,path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node')].filter(Boolean);
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool',{paths:locations})).href);
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/export-engine.mjs result.json workbook.xlsx');
const run=JSON.parse(await fs.readFile(input,'utf8'));
const wb=Workbook.create();
const summary=wb.worksheets.add('Results'),products=wb.worksheets.add('Products'),evidence=wb.worksheets.add('Evidence'),sources=wb.worksheets.add('Sources');
const unmatched=run.quarantine.length?wb.worksheets.add('Unmatched'):null;
const previews=path.join(path.dirname(output),'previews');await fs.mkdir(previews,{recursive:true});
const ink='#24354B',navy='#243D62',muted='#627084';
const write=(sh,address,v)=>sh.getRange(address).values=[[v]];
const formula=(sh,address,f)=>sh.getRange(address).formulas=[[f]];
const safe=v=>typeof v==='string'&&v.trimStart().startsWith('=')?"'"+v:v;
const value=v=>v===null||v===undefined?null:typeof v==='object'?JSON.stringify(v):safe(v);
function base(sh,range,title){sh.showGridLines=false;sh.getRange(range).format={font:{name:'Arial',size:10,color:ink},verticalAlignment:'center',rowHeight:21};write(sh,'A2',title);sh.getRange('A2').format.font={name:'Arial',size:15,bold:true,color:ink};}
function header(sh,range){sh.getRange(range).format={fill:navy,font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},horizontalAlignment:'center',verticalAlignment:'center',wrapText:true,rowHeight:36,borders:{insideVertical:{style:'thin',color:'#FFFFFF'}}};}
function note(sh,address,text){write(sh,address,text);sh.getRange(address).format.font={name:'Arial',size:10,italic:true,color:muted};}
function number(sh,range,format='#,##0'){sh.getRange(range).setNumberFormat(format);sh.getRange(range).format.horizontalAlignment='right';}
function table(sh,range,name){const t=sh.tables.add(range,true,name);t.style='TableStyleMedium2';return t;}
function date(sh,column,row,raw){write(sh,`${column}${row}`,new Date(raw));sh.getRange(`${column}${row}`).setNumberFormat(raw.length===10?'yyyy-mm-dd':'yyyy-mm-dd hh:mm:ss');}
function rows(sh,row,columns,data){if(data.length)sh.getRangeByIndexes(row-1,0,data.length,columns.length).values=data.map(r=>columns.map(c=>value(r[c])));}
const n=run.products.length,end=5+n;
base(products,`A1:W${Math.max(end,6)}`,'Simplified Adafruit products');
note(products,'A4',`${run.mode==='simulation'?'SIMULATION. ':''}Export snapshot. Re-run the engine after changing source inputs, scenario values or filters.`);
const keys=['product_id','product_name','manufacturer','category','price_value','shipping_weight_g','availability','public_quantity','clock_mhz','sram_kb','flash_mb','decision','source_id','captured_at','currency','scenario_modified','scenario_fields','linked_records','pair_x','pair_y','quality_flags','url','stock_raw'];
const labels=['Product ID','Product name','Manufacturer','Primary category','Catalog price (source units)','Shipping weight (g)','Public availability','Public reported quantity','Clock (MHz)','SRAM (kB as published)','Flash (MB as published)','Correlation inclusion','Catalog source batch','Catalog captured at (UTC)','Currency code','Scenario modified','Hypothetical fields','Linked source rows',`Pair X: ${run.analysis.x}`,`Pair Y: ${run.analysis.y}`,'Quality flags','Product URL','Original public stock'];
products.getRange('A5:W5').values=[labels];rows(products,6,keys,run.products);
if(n){table(products,`A5:W${end}`,'EngineProducts');number(products,`E6:F${end}`,'#,##0.00');number(products,`H6:H${end}`);number(products,`I6:I${end}`,'0.00');number(products,`J6:J${end}`);number(products,`K6:K${end}`,'0.00');number(products,`R6:R${end}`);number(products,`S6:T${end}`,'#,##0.0000');for(let i=0;i<n;i++)date(products,'N',i+6,run.products[i].captured_at);products.getRange(`P6:P${end}`).conditionalFormats.add('cellIs',{operator:'equal',formula:'TRUE',format:{fill:'#FFF2D7',font:{color:'#7B4B00'}}});}
header(products,'A5:W5');products.getRange('A:A').format.columnWidth=15;products.getRange('B:B').format.columnWidth=66;products.getRange('C:D').format.columnWidth=27;products.getRange('E:K').format.columnWidth=22;products.getRange('L:L').format.columnWidth=35;products.getRange('M:N').format.columnWidth=26;products.getRange('O:R').format.columnWidth=24;products.getRange('S:T').format.columnWidth=25;products.getRange('U:U').format.columnWidth=58;products.getRange('V:V').format.columnWidth=53;products.getRange('W:W').format.columnWidth=23;products.freezePanes.freezeRows(5);products.freezePanes.freezeColumns(2);

const sourceEnd=5+run.sources.length;
base(sources,`A1:L${Math.max(sourceEnd,6)}`,'Input sources and capture dates');
note(sources,'A4','All original rows are preserved in inputs.json beside the workbook. Repeated captures are not additional products.');
const sourceKeys=['id','kind','label','captured_at','record_count','unique_rows','duplicate_rows','matched_rows','unmatched_rows','ingestion_method','url','_trusted_reference'];
sources.getRange('A5:L5').values=[['Source batch','Kind','Label','Captured at (UTC)','Input rows','Unique rows','Duplicates suppressed','Matched rows','Unmatched rows','Import method','Source URL','Reviewed reference']];
rows(sources,6,sourceKeys,run.sources);if(run.sources.length){table(sources,`A5:L${sourceEnd}`,'EngineSources');number(sources,`E6:I${sourceEnd}`);for(let i=0;i<run.sources.length;i++)date(sources,'D',i+6,run.sources[i].captured_at);}header(sources,'A5:L5');sources.getRange('A:A').format.columnWidth=39;sources.getRange('B:B').format.columnWidth=21;sources.getRange('C:C').format.columnWidth=66;sources.getRange('D:D').format.columnWidth=25;sources.getRange('E:I').format.columnWidth=20;sources.getRange('J:J').format.columnWidth=36;sources.getRange('K:K').format.columnWidth=86;sources.getRange('L:L').format.columnWidth=22;sources.freezePanes.freezeRows(5);sources.freezePanes.freezeColumns(1);

const evidenceRows=run.evidence.map(r=>{const s=run.sources.find(s=>s.id===r.source_id);const prop=r.normalized?.property;const conflict=run.conflicts.find(c=>`ADA:${c.product_id}`===r.product_id&&c.property===prop);return {product_id:r.product_id,kind:r.kind,source_id:r.source_id,record_id:r.raw.record_id??null,captured_at:r.captured_at,property:prop??(r.kind==='observations'?'availability':r.kind),original_value:r.raw.value??r.raw.availability??r.raw.quantity??r.raw.title??r.raw.subject??null,original_unit:r.raw.unit??null,normalized_value:r.normalized?.value??r.normalized?.availability?.status??r.normalized?.quantity??null,normalized_unit:r.normalized?.unit??null,qualifier:r.normalized?.qualifier??r.raw.qualifier??null,selected_conflict_value:conflict?.selected?.value??null,match_basis:r.match_basis,source_url:r.raw.url??s?.url??null,original_row:r.raw};});
const evidenceEnd=5+evidenceRows.length;
base(evidence,`A1:O${Math.max(evidenceEnd,7)}`,'Linked evidence and original claims');
note(evidence,'A4','Non-catalog records for selected products. Conflicting claims remain separate. Uploaded references cannot grant themselves authority.');
const evidenceKeys=['product_id','kind','source_id','record_id','captured_at','property','original_value','original_unit','normalized_value','normalized_unit','qualifier','selected_conflict_value','match_basis','source_url','original_row'];
evidence.getRange('A5:O5').values=[['Product ID','Source kind','Source batch','Record ID','Captured at (UTC)','Property','Original value','Original unit','Normalized value / status','Normalized unit','Qualifier','Selected conflict value','Match basis','Source URL','Original row JSON']];
rows(evidence,6,evidenceKeys,evidenceRows);if(evidenceRows.length){table(evidence,`A5:O${evidenceEnd}`,'EngineEvidence');for(let i=0;i<evidenceRows.length;i++)date(evidence,'E',i+6,evidenceRows[i].captured_at);number(evidence,`I6:I${evidenceEnd}`,'#,##0.00');number(evidence,`L6:L${evidenceEnd}`,'#,##0.00');}else write(evidence,'A7','No linked non-catalog evidence for this selection.');header(evidence,'A5:O5');evidence.getRange('A:A').format.columnWidth=16;evidence.getRange('B:B').format.columnWidth=22;evidence.getRange('C:C').format.columnWidth=40;evidence.getRange('D:D').format.columnWidth=35;evidence.getRange('E:E').format.columnWidth=25;evidence.getRange('F:F').format.columnWidth=23;evidence.getRange('G:G').format.columnWidth=55;evidence.getRange('H:M').format.columnWidth=25;evidence.getRange('N:N').format.columnWidth=86;evidence.getRange('O:O').format.columnWidth=100;evidence.freezePanes.freezeRows(5);evidence.freezePanes.freezeColumns(1);

if(unmatched){const data=run.quarantine.map(q=>({source_id:q.source_id,kind:q.kind,record_index:q.record_index+1,product_reference:q.raw.product_id??q.raw.product_name??null,reason:q.reason,candidate_ids:q.candidate_ids,captured_at:q.captured_at,original_row:q.raw}));base(unmatched,`A1:H${5+data.length}`,'Unmatched records for identity review');note(unmatched,'A4','No name-based automatic merges. Row numbers refer to source data records, excluding the CSV header.');unmatched.getRange('A5:H5').values=[['Source batch','Kind','Source row','Product reference','Reason','Review candidates','Captured date','Original row JSON']];rows(unmatched,6,['source_id','kind','record_index','product_reference','reason','candidate_ids','captured_at','original_row'],data);table(unmatched,`A5:H${5+data.length}`,'EngineUnmatched');header(unmatched,'A5:H5');unmatched.getRange('A:A').format.columnWidth=37;unmatched.getRange('B:D').format.columnWidth=23;unmatched.getRange('E:E').format.columnWidth=76;unmatched.getRange('F:G').format.columnWidth=25;unmatched.getRange('H:H').format.columnWidth=100;for(let i=0;i<data.length;i++)date(unmatched,'G',i+6,data[i].captured_at);unmatched.freezePanes.freezeRows(5);}

const manufacturerStart=29+run.changes.length;
const summaryEnd=manufacturerStart+run.manufacturer_correlations.length+4;
base(summary,`A1:G${summaryEnd}`,run.mode==='simulation'?'Adafruit engine — SIMULATION':'Adafruit processing engine');summary.tabColor=navy;
write(summary,'A4',safe(run.label));write(summary,'A5',`${run.created_at}   Baseline revision ${run.base_revision}   Run ${run.run_id}`);
summary.getRange('A7:D7').values=[['Metric','Baseline','This run','Difference']];header(summary,'A7:D7');
const metrics=[['Products in loaded model','total_products'],['Products after filters','selected_products'],['Complete numeric pairs','n'],['Excluded products','excluded_products'],['Pearson r','r'],['Input rows, whole model','input_rows'],['Duplicates suppressed','duplicate_rows_suppressed'],['Matched rows, whole model','matched_rows'],['Unmatched rows, whole model','unmatched_rows'],['Conflicts, whole model','conflicts']];
for(let i=0;i<metrics.length;i++){const [label,key]=metrics[i],row=i+8;write(summary,`A${row}`,label);write(summary,`B${row}`,run.baseline[key]??'Unavailable');write(summary,`C${row}`,run.summary[key]??'Unavailable');formula(summary,`D${row}`,`=IF(AND(ISNUMBER(B${row}),ISNUMBER(C${row})),C${row}-B${row},"")`);}
if(n){formula(summary,'C9',`=COUNTA('Products'!A6:A${end})`);formula(summary,'C10',`=COUNT('Products'!S6:S${end})`);formula(summary,'C11','=C9-C10');if(run.analysis.r!==null)formula(summary,'C12',`=CORREL('Products'!S6:S${end},'Products'!T6:T${end})`);}
if(run.sources.length){formula(summary,'C13',`=SUM('Sources'!E6:E${sourceEnd})`);formula(summary,'C14',`=SUM('Sources'!G6:G${sourceEnd})`);formula(summary,'C15',`=SUM('Sources'!H6:H${sourceEnd})`);formula(summary,'C16',`=SUM('Sources'!I6:I${sourceEnd})`);}
number(summary,'B8:D17');number(summary,'B12:D12','0.0000');summary.getRange('A12:D12').format.fill='#EEF2F7';summary.getRange('A12:D12').format.font.bold=true;
note(summary,'A19',`X: ${run.analysis.x}. Y: ${run.analysis.y}. At least 8 complete pairs are required. ${run.analysis.reason??''}`);
note(summary,'A20',`Comparable cohort: ${run.analysis.cohort||'No eligible cohort'}. Price units have no confirmed currency code when absent.`);
note(summary,'A21','Product mix, packaging and outliers affect correlation. These associations do not establish causation.');
note(summary,'A22',run.mode==='simulation'?'SIMULATION: hypothetical inputs are retained in the request. The real workspace remains unchanged.':'Additional uploads are user-supplied. Public catalog data does not reveal private warehouse, sales or email records.');
summary.getRange('A24:F24').values=[['Product ID','Changed field','Before','After','Basis','In selected output']];header(summary,'A24:F24');
if(run.changes.length){rows(summary,25,['product_id','field','before','after','basis','in_selected_output'],run.changes);summary.getRange(`C25:D${24+run.changes.length}`).format.wrapText=true;}else write(summary,'A25','No field values changed.');
summary.getRange(`A${manufacturerStart}:F${manufacturerStart}`).values=[['Manufacturer cohort','Products','Valid pairs','Pearson r','Status','Comparable cohort']];header(summary,`A${manufacturerStart}:F${manufacturerStart}`);
if(run.manufacturer_correlations.length){rows(summary,manufacturerStart+1,['manufacturer','products','n','r','status','cohort'],run.manufacturer_correlations);number(summary,`B${manufacturerStart+1}:C${manufacturerStart+run.manufacturer_correlations.length}`);number(summary,`D${manufacturerStart+1}:D${manufacturerStart+run.manufacturer_correlations.length}`,'0.0000');}else write(summary,`A${manufacturerStart+1}`,'No manufacturer cohort has at least 8 complete pairs.');
note(summary,`A${summaryEnd-1}`,'Manufacturer cohorts use their own largest comparable group. Filtering an Excel table does not recalculate the cohort selection.');
summary.getRange('A:A').format.columnWidth=41;summary.getRange('B:B').format.columnWidth=23;summary.getRange('C:D').format.columnWidth=21;summary.getRange('E:E').format.columnWidth=30;summary.getRange('F:F').format.columnWidth=41;summary.getRange('G:G').format.columnWidth=12;

wb.recalculate();
assert.equal(summary.getRange('C9').values[0][0],n);
assert.equal(summary.getRange('C10').values[0][0],run.analysis.n);
if(run.analysis.r!==null)assert(Math.abs(summary.getRange('C12').values[0][0]-run.analysis.r)<1e-10,'Excel correlation differs from C++');
const inspect=await wb.inspect({kind:'table',range:'Results!A7:D17',include:'values,formulas',tableMaxRows:11,tableMaxCols:4,maxChars:5000});
await fs.writeFile(path.join(path.dirname(output),'excel-inspection.ndjson'),inspect.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'Engine workbook formula error scan',maxChars:3500});
await fs.writeFile(path.join(path.dirname(output),'excel-errors.ndjson'),errors.ndjson);
if(errors.ndjson && !errors.ndjson.includes('matched 0 entries'))throw Error(`Formula error scan needs review: ${errors.ndjson}`);
for(const [name,range,file] of [['Results','A1:G36','results'],['Products','A1:H15','products'],['Evidence','A1:H15','evidence'],['Sources','A1:I15','sources'],...(unmatched?[['Unmatched','A1:G12','unmatched']]:[])]){const blob=await wb.render({sheetName:name,range,scale:1.3,format:'png'});await fs.writeFile(path.join(previews,`${file}.png`),new Uint8Array(await blob.arrayBuffer()));}
const file=await SpreadsheetFile.exportXlsx(wb);await file.save(`${output}.partial`);await fs.rename(`${output}.partial`,output);
console.log(JSON.stringify({output,run_id:run.run_id,products:n,n:run.analysis.n,r:run.analysis.r,formula_errors:0,sheets:unmatched?5:4}));
