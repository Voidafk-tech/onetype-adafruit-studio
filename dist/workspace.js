// Source ingestion, cleaning, matching and statistics run in C++; this file displays responses.
const $ = q => document.querySelector(q);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words = value => ({clock_hz:'Processor clock',flash_mb:'Onboard flash',sram_kb:'On-chip SRAM'}[value] || String(value ?? '').replaceAll('_',' '));
const value = input => input === null || input === undefined || input === '' ? 'Unknown' : String(input);
const count = n => Number(n).toLocaleString();
const pretty = input => esc(JSON.stringify(input,null,2));
const safeURL = input => {try {const u=new URL(input); return u.protocol==='https:' ? u.href : '#';} catch {return '#';}};
const badge = (text,amber=false) => `<span class="badge ${amber?'amber':'green'}">${esc(text)}</span>`;
const state = {overview:null,page:0,selection:'6006',request:0,detailRequest:0,preview:null,source:null};
async function api(path,body) {
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json(); if(!response.ok) throw new Error(result.error || `Request failed (${response.status})`); return result;
}
function message(text,error=false) {const box=$('#workspace-message');box.hidden=false;box.classList.toggle('error',error);box.textContent=text;}
const fail = error => message(error.message,true);
function panel(name) {
  for(const p of document.querySelectorAll('.workspace-panel')) p.hidden=p.id!==`${name}-panel`;
  for(const b of document.querySelectorAll('[data-panel]')) b.classList.toggle('active',b.dataset.panel===name);
  if(name==='patterns') patterns().catch(fail);
}
function fillOptions(selector,items,label) {
  const select=$(selector),old=select.value;
  select.innerHTML=`<option value="">All ${label}</option>`+items.map(item=>`<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('');
  if(items.some(item=>item.id===old)) select.value=old;
}
async function overview() {
  const data=await api('/api/workspace');state.overview=data;
  $('#connection-status').textContent=`C++ connected · revision ${data.revision}`;
  $('#workspace-metrics').innerHTML=[[data.products,'Unified product identities'],[data.records,'Source records preserved'],[data.matched_records,'Records linked by exact identity'],[data.conflicts,'Specification conflicts retained']].map(([n,label])=>`<div class="metric"><strong>${count(n)}</strong><span>${esc(label)}</span></div>`).join('');
  $('#workspace-capture').textContent=`Official catalog capture: ${data.catalog_captured_at} · ${data.sources.length} source batches · ${data.quarantined} unmatched records. Public catalog availability is separate from private warehouse inventory. Refresh reads the official API on demand.`;
  const manufacturers=data.manufacturers.map(id=>({id,label:id})),categories=data.categories.map(id=>({id,label:data.category_labels[id] || `Category ${id}`})).sort((a,b)=>a.label.localeCompare(b.label));
  fillOptions('#manufacturer-filter',manufacturers,'manufacturers');fillOptions('#category-filter',categories,'categories');
  fillOptions('#pattern-manufacturer',manufacturers,'manufacturers');fillOptions('#pattern-category',categories,'categories');
  $('#source-list').innerHTML=data.sources.map(source=>`<div class="source-summary"><strong>${esc(source.label)}</strong><p>${esc(words(source.kind))} · captured ${esc(source.captured_at)}<br>${count(source.record_count)} input rows · ${count(source.matched)} matched · ${count(source.unmatched)} unmatched<br>${esc(words(source.ingestion_method))}</p>${source.url?`<a href="${esc(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">View source ↗</a>`:''}</div>`).join('');
}
function filters(prefix='') {return new URLSearchParams({manufacturer:$(prefix?'#pattern-manufacturer':'#manufacturer-filter').value,category:$(prefix?'#pattern-category':'#category-filter').value});}
async function products() {
  const request=++state.request,params=filters();params.set('q',$('#product-search').value);params.set('page',state.page);
  const result=await api(`/api/products?${params}`);if(request!==state.request)return;
  $('#product-total').textContent=count(result.total);
  $('#products-body').innerHTML=result.rows.map(p=>`<tr class="${p.product_id===state.selection?'selected-row':''}"><td><button class="link-button" data-product="${esc(p.product_id)}">${esc(p.name)}</button><div class="native-id">${esc(p.id)}</div></td><td>${p.price_value===null?'Unknown':Number(p.price_value).toFixed(2)}<div class="native-id">${esc(p.currency||'currency unconfirmed')}</div></td><td>${p.shipping_weight_g===null?'Unknown':esc(p.shipping_weight_g)+' g'}</td><td>${badge(words(p.availability.status),p.availability.status!=='in_stock')}</td></tr>`).join('') || '<tr><td colspan="4">No matching products. Clear the filters or change the search.</td></tr>';
  $('#page-label').textContent=`Page ${state.page+1} of ${Math.max(1,Math.ceil(result.total/50))}`;
  $('#previous-page').disabled=state.page===0;$('#next-page').disabled=(state.page+1)*50>=result.total;
}
async function inspect(id) {
  const request=++state.detailRequest;panel('model');const result=await api(`/api/product?${new URLSearchParams({id})}`);if(request!==state.detailRequest)return;
  const p=result.product;state.selection=p.product_id;
  const kinds={};for(const r of result.records)kinds[r.kind]=(kinds[r.kind]||0)+1;
  const fields=[['Price',p.price_value===null?'Unknown':`${Number(p.price_value).toFixed(2)} ${p.currency||'(currency unconfirmed)'}`],['Shipping weight',p.shipping_weight_g===null?'Unknown':`${p.shipping_weight_g} g`],['Manufacturer',value(p.manufacturer)],['API availability',words(p.availability.status)],['Reported public count',value(p.availability.reported_quantity)],['Catalog capture',p.captured_at]];
  $('#product-detail').innerHTML=`<div class="detail-header"><p class="eyebrow">CONNECTED PRODUCT</p><h2>${esc(p.name)}</h2><p class="record-id">${esc(p.id)}</p><a href="${esc(safeURL(p.url))}" target="_blank" rel="noopener noreferrer">View official product page ↗</a></div><div class="facts-compact">${fields.map(([label,text])=>`<div><span>${esc(label)}</span><strong>${esc(text)}</strong></div>`).join('')}</div><p class="small-note">A public availability count is a dated retailer report. It does not reveal warehouse locations, reservations, or private stock records.</p><h3>Automatically linked source records</h3><div class="record-links">${Object.entries(kinds).map(([kind,n])=>`<span>${esc(words(kind))} · ${n}</span>`).join('')}</div><p class="small-note">Exact IDs such as 6006, ADA6006 and the product URL resolve to this identity. Different variants keep separate product IDs.</p>${p.specifications.length?`<h3>Technical claims and conflicts</h3>${p.specifications.map(s=>`<div class="issue-card ${s.status==='conflict_requires_review'?'':'resolved'}"><strong>${esc(words(s.property))}: ${s.selected?`${esc(s.selected.value)} ${esc(s.selected.unit)}`:'Unresolved'}</strong><p>${esc(words(s.status))} · ${s.claim_count} retained claims<br>${esc(s.basis)}</p></div>`).join('')}`:''}<h3>Before and after cleaning</h3>${result.records.map(r=>`<details data-kind="${esc(r.kind)}"><summary><strong>${esc(words(r.kind))}</strong> · ${esc(r.source_id)}<br>${esc(r.captured_at)} · ${esc(r.match_basis)}</summary><p>${esc(r.source_label)}</p>${r.kind==='documents'?`<a href="${esc(safeURL(r.raw.url))}" target="_blank" rel="noopener noreferrer">${esc(r.raw.title)} ↗</a>`:''}<div class="clean-comparison"><table><thead><tr><th>Original source values</th><th>Normalized / linked values</th></tr></thead><tbody><tr><td><pre>${pretty(r.raw)}</pre></td><td><pre>${pretty(r.normalized||{product_id:p.product_id,linked_product:p.id,match_basis:r.match_basis})}</pre></td></tr></tbody></table></div></details>`).join('')}<p class="small-note">Original values remain in source history. Imported names alone are suggestions for review, never automatic merges.</p>`;
  for(const row of document.querySelectorAll('#products-body tr')) row.classList.toggle('selected-row',row.querySelector('[data-product]')?.dataset.product===p.product_id);
}
function scatter(points) {
  if(!points.length)return '<p class="empty">No complete numeric pairs for this filter.</p>';
  const maxX=Math.max(...points.map(p=>p.x),1),maxY=Math.max(...points.map(p=>p.y),1),W=600,H=330,left=65,top=18,width=510,height=245;
  return `<svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Shipping weight versus displayed price, sampled products"><path d="M${left} ${top}V${top+height}H${left+width}" fill="none" stroke="#c4d2dc"/>${[0,.5,1].map(t=>`<text x="${left-8}" y="${top+height-t*height+4}" text-anchor="end">${(t*maxY).toPrecision(3)}</text><text x="${left+t*width}" y="${top+height+20}" text-anchor="middle">${(t*maxX).toPrecision(3)}</text>`).join('')}${points.map(p=>`<circle cx="${left+(p.x/maxX)*width}" cy="${top+height-(p.y/maxY)*height}" r="3" fill="#397ad5" opacity=".55"><title>${esc(p.name)} · ${p.x} g · price ${p.y}</title></circle>`).join('')}<text x="${left+width/2}" y="${H-14}" text-anchor="middle">Shipping weight (g)</text><text x="14" y="${top+height/2}" transform="rotate(-90 14 ${top+height/2})" text-anchor="middle">Displayed price units</text></svg>`;
}
async function patterns() {
  const result=await api(`/api/patterns?${filters('patterns')}`);
  $('#pattern-content').innerHTML=`<div class="pattern-grid"><article class="pattern-card"><p class="eyebrow">EXPLORATORY NUMERIC ASSOCIATION</p><h3>Displayed price × shipping weight</h3><p class="r-value">${result.r===null?'Not calculated':`r = ${Number(result.r).toFixed(3)}`}</p><p class="pattern-summary">${count(result.n)} complete product pairs from ${count(result.filtered_products)} selected products.<br>${count(result.excluded_products)} excluded for missing/invalid fields, virtual products, or a different price source/currency group.${result.reason?'<br>'+esc(result.reason):''}</p>${scatter(result.points)}<p class="small-note">${count(result.plotted_count)} sampled records, including range extremes; correlation uses all ${count(result.n)} eligible pairs. Prices use the same source snapshot and currency group. Unconfirmed currency stays unconfirmed.</p></article><article class="pattern-card"><h3>What this tells you</h3><p class="pattern-summary">${esc(result.interpretation)}</p><p class="pattern-summary">Use a manufacturer or category filter to compare a more similar set of products. Shipping weight includes packaging and is not a measure of product capability.</p><div class="scope-note"><strong>Record relationships are a separate result</strong><p>Catalog, specifications, documents and imported operational rows are joined by exact Adafruit product identity. A shared name or a numeric correlation never establishes an identity match.</p></div><p class="small-note">Price group: ${esc(result.price_source_group||'No eligible group')}</p></article></div><div class="pattern-grid"><article class="pattern-card"><h3>Whole-workspace specification conflicts · ${result.conflicts.length}</h3>${result.conflicts.map(c=>`<div class="issue-card ${c.selected?'resolved':''}"><button class="link-button" data-product="${esc(c.product_id)}">Adafruit ${esc(c.product_id)} · ${esc(words(c.property))}</button><p>Retained values: ${esc([...new Set(c.claims.map(r=>r.normalized.value))].join(', '))}<br>Selected: ${c.selected?esc(c.selected.value)+' '+esc(c.selected.unit):'Needs review'}<br>${esc(c.basis)}</p></div>`).join('')||'<p class="empty">No conflicting imported specification values.</p>'}</article><article class="pattern-card"><h3>Unmatched records · ${result.quarantine.length}</h3>${result.quarantine.slice(0,15).map(r=>`<div class="quarantine-row"><strong>${esc(r.source_id)}</strong><br>${esc(r.reason)}<br>Input product: ${esc(r.raw.product_id||r.raw.product_name||'unknown')}${r.candidate_ids.length?`<br>Review candidates: ${esc(r.candidate_ids.join(', '))}`:''}</div>`).join('')||'<p class="empty">Every currently loaded source record has an exact product identity.</p>'}<p class="small-note">Unmatched rows remain in source history. They can link automatically after the missing catalog identity is imported.</p></article></div>`;
  const differences=result.availability_differences||[];
  $('#pattern-content').insertAdjacentHTML('beforeend',`<article class="pattern-card" style="margin-top:18px"><h3>Whole-workspace dated availability differences · ${differences.length}</h3>${differences.map(d=>`<div class="quarantine-row"><button class="link-button" data-product="${esc(d.product_id)}">Adafruit ${esc(d.product_id)}</button><br>${esc(d.older_captured_at)}: ${esc(words(d.older_status))} → ${esc(d.latest_captured_at)}: ${esc(words(d.latest_status))}<br>${esc(d.scope)}<br>Evidence: ${esc(d.source_ids.join(' · '))}</div>`).join('')||'<p class="empty">No availability differences were found among the loaded dated reports.</p>'}</article>`);
}

function resetPreview() {state.preview=null;state.source=null;$('#commit-import').disabled=true;$('#import-preview').replaceChildren();}
function setSource(source) {$('#source-json').value=JSON.stringify(source,null,2);$('#source-kind').value=source.kind;resetPreview();}
const today=()=>new Date().toISOString().slice(0,10);
function template() {
  const kind=$('#source-kind').value;
  const record={record_id:'YOUR_RECORD_ID',product_id:'YOUR_ADAFRUIT_PRODUCT_ID'};
  const additions={catalog:{product_name:'YOUR_PRODUCT_NAME',product_price:null,product_shipping_weight:null,product_stock:null},inventory:{warehouse_id:'YOUR_WAREHOUSE_ID',quantity:null},purchase_orders:{purchase_order_id:'YOUR_ORDER_ID',supplier:'YOUR_SUPPLIER',quantity:null},communications:{subject:'YOUR_SUBJECT',excerpt:'YOUR_OWN_SOURCE_TEXT'},documents:{title:'YOUR_DOCUMENT_TITLE',url:'https://your-company.example/document'},specifications:{property:'sram',value:null,unit:'kB'},observations:{price:null,availability:null}};
  Object.assign(record,additions[kind]);setSource({id:'YOUR_SOURCE_ID',kind,label:'Your source name',captured_at:today(),records:[record]});
}
function realExample() {
  setSource({id:'MY_DOCUMENT_IMPORT',kind:'documents',label:'Re-import of verified Raspberry Pi document references',captured_at:'2026-10-23',note:'Copies of bundled references; not independent new evidence or private Adafruit records.',records:[{record_id:'PICO2_DATASHEET',product_id:'ADA6006',title:'Raspberry Pi Pico 2 Datasheet · Release 5',url:'https://pip.raspberrypi.com/documents/RP-008299-DS'},{record_id:'PICO_DOCUMENTATION',product_id:'https://www.adafruit.com/product/4864',title:'Pico microcontroller boards',url:'https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html'}]});
}
async function previewImport() {
  const sourceText=$('#source-json').value;
  resetPreview();const source=JSON.parse(sourceText),preview=await api('/api/import/preview',{source});
  if($('#source-json').value!==sourceText)return;
  state.source=source;state.preview=preview;
  const stats=preview.stats;
  $('#import-preview').innerHTML=`<div class="preview-box ${stats.unmatched?'warning':''}"><strong>${preview.duplicate?'Already imported; saving again will not duplicate it.':'Preview complete · nothing saved yet'}</strong><p>${count(stats.record_count)} input rows · ${count(stats.matched)} linked · ${count(stats.unmatched)} unmatched · ${count(stats.duplicate_records)} duplicate rows suppressed</p>${preview.unmatched?.length?`<p>Unmatched rows stay quarantined: ${esc(preview.unmatched.map(r=>r.raw.product_id||r.raw.product_name).join(', '))}</p>`:''}<p>Exact retailer IDs are normalized; original fields are retained. Workspace revision ${preview.revision}.</p></div>`;
  $('#commit-import').disabled=false;
}
async function commitImport() {
  if(!state.preview||!state.source)return;$('#commit-import').disabled=true;
  try {const result=await api('/api/import',{source:state.source,expected_revision:state.preview.revision});message(result.duplicate?'This exact source was already imported. No duplicate was added.':`Source saved locally at revision ${result.revision}. Its matched records are now connected.`);resetPreview();await overview();await products();await inspect(state.selection);panel('sources');}
  catch(error){resetPreview();throw error;}
}
async function refresh() {
  const button=$('#refresh-catalog');button.disabled=true;button.textContent='Reading official API…';
  try {const result=await api('/api/refresh-catalog',{});resetPreview();message(`Official API returned ${count(result.records)} rows. Capture ${result.captured_at} saved. Existing source history and your imports were retained.`);await overview();await products();await inspect(state.selection);}
  finally {button.disabled=false;button.textContent='Refresh official catalog ↻';}
}
document.addEventListener('click',event=>{const nav=event.target.closest('[data-panel]');if(nav)panel(nav.dataset.panel);const product=event.target.closest('[data-product]');if(product)inspect(product.dataset.product).catch(fail);});
let timer;$('#product-search').addEventListener('input',()=>{clearTimeout(timer);state.page=0;timer=setTimeout(()=>products().catch(fail),180);});
for(const id of ['#manufacturer-filter','#category-filter'])$(id).addEventListener('change',()=>{state.page=0;products().catch(fail);});
$('#previous-page').addEventListener('click',()=>{state.page=Math.max(0,state.page-1);products().catch(fail);});$('#next-page').addEventListener('click',()=>{state.page++;products().catch(fail);});
$('#open-pico').addEventListener('click',()=>inspect('6006').catch(fail));$('#calculate-patterns').addEventListener('click',()=>patterns().catch(fail));
$('#load-real-example').addEventListener('click',realExample);$('#load-template').addEventListener('click',template);$('#source-json').addEventListener('input',resetPreview);
$('#source-kind').addEventListener('change',template);
$('#source-file').addEventListener('change',async()=>{try{
  const file=$('#source-file').files[0];if(!file)return;if(file.size>19*1024*1024)throw new Error('Choose a source file smaller than 19 MB');
  const text=await file.text();
  if(file.name.toLowerCase().endsWith('.csv')) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16);
    const kind=$('#source-kind').value,captured=$('#csv-captured-date').value;
    const source={id:`CSV_${kind}_${captured}_${hash}`,kind,label:file.name,captured_at:captured};
    const parsed=await api('/api/import/csv-preview',{source,csv:text});setSource(parsed.source);message('CSV parsed and validated in C++. Review its converted source and preview before saving.');
  } else setSource(JSON.parse(text));
}catch(error){fail(error);}finally{$('#source-file').value='';}});
$('#preview-import').addEventListener('click',()=>previewImport().catch(fail));$('#commit-import').addEventListener('click',()=>commitImport().catch(fail));$('#refresh-catalog').addEventListener('click',()=>refresh().catch(fail));
(async()=>{$('#csv-captured-date').value=today();await overview();await Promise.all([products(),inspect('6006')]);realExample();})().catch(fail);
