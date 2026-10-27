'use strict';
/* ------------------------------------------------------------------
   CONFIG. Set these when you host the page on your own site.
   LEAD_ENDPOINT: a Formspree or Web3Forms URL that accepts JSON.
   LEAD_EXTRA: extra fields the service needs, e.g. {access_key:'...'}.
   PSI_API_KEY: optional Google API key (restrict it to your domain).
   SCAN_LOG_ENDPOINT: optional Google Apps Script web app URL that
   records every scanned address in a Google Sheet.
------------------------------------------------------------------- */
const CONFIG={LEAD_ENDPOINT:'https://api.web3forms.com/submit',LEAD_EXTRA:{access_key:'8f1ac273-af25-4540-8e9b-488fc8bcb69b',botcheck:''},PSI_API_KEY:'AIzaSyBlYrQFFgXwM2TMn6Fkao89WU3SKAb8hxY',SCAN_LOG_ENDPOINT:''};
const PSI='https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/* ------------------------------------------------------------------
   MODEL. Every uplift below is a planning assumption, not a measured
   result. up = [low, expected, high] as a fraction of the lever it
   affects (conv = visitors who enquire, traffic = visitors, close =
   enquiries that book). Edit these numbers here, nowhere else.
------------------------------------------------------------------- */
const CAPS={conv:.5,traffic:.35,close:.25};
const RAMP=[.25,.6,1,1,1,1,1,1,1,1,1,1];
const RAMP_SUM=RAMP.reduce((a,b)=>a+b,0);
const has=(s,id)=>s.fails.indexOf(id)>-1;

const CATALOG=[
 {id:'lcp',src:'scan',lever:'conv',title:'Slow to load on phones',
  detect:s=>s.lcp>4000?1:s.lcp>2500?.5:0,
  why:s=>'The main content appears after '+(s.lcp/1000).toFixed(1)+' seconds on a mobile connection. Google\'s target is 2.5 seconds or less.',
  fix:'Compress photos, serve them as WebP, and remove scripts you do not use.',up:[.02,.05,.10]},
 {id:'cls',src:'scan',lever:'conv',title:'Page jumps while loading',
  detect:s=>s.cls>.25?1:s.cls>.1?.5:0,
  why:s=>'The layout shift score is '+s.cls.toFixed(2)+'. A score of 0.1 or less feels stable.',
  fix:'Set width and height on images and reserve space for banners and embedded videos.',up:[.01,.02,.04]},
 {id:'tbt',src:'scan',lever:'conv',title:'Slow to respond to taps',
  detect:s=>s.tbt>600?1:s.tbt>200?.5:0,
  why:s=>'The page is busy for '+Math.round(s.tbt)+' ms while loading scripts, so taps feel delayed.',
  fix:'Remove heavy sliders, chat widgets and tracking scripts that do not earn their place.',up:[.01,.02,.04]},
 {id:'viewport',src:'scan',lever:'conv',title:'Not set up for mobile screens',
  detect:s=>has(s,'viewport')?1:0,
  why:()=>'The page has no mobile viewport setting, so phones show a shrunken desktop page.',
  fix:'Add the viewport tag and switch to a responsive layout.',up:[.06,.14,.25]},
 {id:'tap',src:'scan',lever:'conv',title:'Buttons and text are hard to use on a phone',
  detect:s=>(has(s,'tap-targets')||has(s,'target-size'))&&has(s,'font-size')?1:(has(s,'tap-targets')||has(s,'target-size')||has(s,'font-size'))?.5:0,
  why:()=>'Tap targets or text sizes are too small on mobile screens.',
  fix:'Make buttons at least 48 px tall and body text at least 16 px.',up:[.02,.04,.07]},
 {id:'https',src:'scan',lever:'conv',title:'Browsers show a "Not secure" warning',
  detect:s=>has(s,'is-on-https')?1:0,
  why:()=>'The site is not served over HTTPS, so visitors see a warning before they can enquire.',
  fix:'Install a free SSL certificate and redirect all pages to HTTPS.',up:[.02,.05,.10]},
 {id:'title',src:'scan',lever:'traffic',title:'Page has no title',
  detect:s=>has(s,'document-title')?1:0,
  why:()=>'Without a title, Google has nothing clear to show in search results.',
  fix:'Write a unique title for each page with the service and city.',up:[.02,.06,.12]},
 {id:'meta',src:'scan',lever:'traffic',title:'No search description',
  detect:s=>has(s,'meta-description')?1:0,
  why:()=>'Without a description, Google picks random page text for your listing, which lowers clicks.',
  fix:'Write a 140 to 160 character description with a reason to click.',up:[.01,.04,.08]},
 {id:'crawl',src:'scan',lever:'traffic',title:'Google is told not to list the page',
  detect:s=>has(s,'is-crawlable')?1:0,
  why:()=>'The page carries a setting that stops search engines from indexing it.',
  fix:'Remove the noindex tag or the robots block.',up:[.15,.35,.60]},
 {id:'alt',src:'scan',lever:'traffic',title:'Photos have no descriptions',
  detect:s=>has(s,'image-alt')?1:0,
  why:()=>'Event photos without alt text miss out on Google Images and cannot be read by screen readers.',
  fix:'Add short descriptions, such as "Floral mandap at an outdoor wedding".',up:[.005,.02,.04]},
 {id:'links',src:'scan',lever:'traffic',title:'Links say "click here"',
  detect:s=>has(s,'link-text')?1:0,
  why:()=>'Vague link text gives search engines no clue what the linked page is about.',
  fix:'Use link text that names the page, such as "Wedding decor packages".',up:[.005,.015,.03]},
 {id:'setup',src:'scan',lever:'traffic',title:'Search setup errors',
  detect:s=>(has(s,'canonical')||has(s,'robots-txt'))?1:0,
  why:()=>'A canonical tag or robots.txt file is invalid, which can confuse search engines.',
  fix:'Fix the canonical URL and make sure robots.txt is valid.',up:[.01,.02,.05]},

 {id:'cta',src:'self',lever:'conv',group:0,on:true,label:'A clear button such as "Check availability" on the first screen',
  title:'No clear call to action on the first screen',why:'Visitors who cannot see the next step leave without enquiring.',
  fix:'Add one primary button in the header and at the top of every page.',up:[.04,.09,.18]},
 {id:'form',src:'self',lever:'conv',group:0,on:false,label:'Enquiry form asks for event date, city and guest count',
  title:'Enquiry form is not built around the event',why:'A generic contact form gets fewer and weaker enquiries than a form that starts with the event.',
  fix:'Replace it with a short form: date, city, guests and budget range.',up:[.05,.12,.22]},
 {id:'whatsapp',src:'self',lever:'conv',group:0,on:false,label:'WhatsApp chat button visible on phones',
  title:'No WhatsApp button on mobile',why:'Many event buyers would rather send a message than fill in a form.',
  fix:'Add a floating WhatsApp button with a pre-filled message.',up:[.04,.08,.15]},
 {id:'call',src:'self',lever:'conv',group:0,on:true,label:'Phone number that calls when tapped',
  title:'Phone number is not tap-to-call',why:'On a phone, a number that cannot be tapped adds a step.',
  fix:'Link the number with a tel: link in the header and footer.',up:[.01,.03,.06]},
 {id:'gallery',src:'self',lever:'conv',group:0,on:true,label:'Portfolio of real events with photos or video',
  title:'No portfolio of real events',why:'Buyers want proof you can deliver their kind of event before they get in touch.',
  fix:'Add a gallery of recent events, grouped by event type.',up:[.03,.07,.13]},
 {id:'reviews',src:'self',lever:'conv',group:0,on:false,label:'Client reviews or testimonials on the site',
  title:'No client reviews on the site',why:'Without reviews, visitors have nothing to compare you against other vendors with.',
  fix:'Add 6 to 10 real reviews with names, event type and photos.',up:[.02,.05,.09]},
 {id:'price',src:'self',lever:'conv',group:0,on:true,label:'Starting price or packages shown',
  title:'No starting price or packages',why:'Visitors who cannot judge whether you fit their budget tend to leave rather than ask.',
  fix:'Show packages with a "starting from" price.',up:[.02,.06,.11]},

 {id:'gbp',src:'self',lever:'traffic',group:1,on:true,label:'Google Business Profile claimed, with recent reviews',
  title:'Google Business Profile is weak',why:'Searches like "wedding planner near me" show map listings before websites.',
  fix:'Claim the profile, add photos, and ask recent clients for reviews.',up:[.05,.12,.25]},
 {id:'pages',src:'self',lever:'traffic',group:1,on:true,label:'Separate pages for each service and city',
  title:'No separate pages per service and city',why:'One page cannot rank for every service in every city.',
  fix:'Create one page for each service and city you want to be found in.',up:[.04,.10,.20]},
 {id:'content',src:'self',lever:'traffic',group:1,on:true,label:'Planning guides or blog posts that answer buyers\' questions',
  title:'No planning guides or blog',why:'Buyers search for costs and checklists long before they pick a vendor.',
  fix:'Publish guides such as "Wedding decor cost guide" and keep them updated.',up:[.03,.07,.15]},

 {id:'reply',src:'self',lever:'close',group:2,on:false,label:'Every enquiry gets a reply within an hour',
  title:'Slow replies to enquiries',why:'Buyers contact several vendors and tend to book whoever answers first.',
  fix:'Set an auto-reply and assign someone to answer within an hour.',up:[.04,.09,.15]},
 {id:'followup',src:'self',lever:'close',group:2,on:true,label:'Unanswered enquiries get a follow-up within 3 days',
  title:'No follow-up after the first reply',why:'Many enquiries go quiet only because the buyer got busy.',
  fix:'Send one follow-up message after 2 to 3 days.',up:[.03,.06,.10]}
];
const GROUPS=['Turning visitors into enquiries','Being found on Google','Winning the enquiry'];

function levers(list,s){
  const prod={conv:1,traffic:1,close:1};
  list.forEach(p=>{prod[p.lever]*=(1-p.up[s]*p.sev);});
  const o={};
  Object.keys(prod).forEach(k=>{o[k]=Math.min(CAPS[k],1-prod[k]);});
  return o;
}
function model(inp,lv){
  const enq=inp.enq*(1+lv.traffic)*(1+lv.conv);
  const close=Math.max(inp.close,Math.min(.9,inp.close*(1+lv.close)));
  const bookings=enq*close;
  return {enq:enq,close:close,bookings:bookings,rev:bookings*inp.value};
}
function calc(inp,list){
  const base={bookings:inp.enq*inp.close,rev:inp.enq*inp.close*inp.value};
  const sc=[0,1,2].map(s=>{
    const lv=levers(list,s), m=model(inp,lv);
    const cum=[];let run=0;
    for(let i=0;i<12;i++){run+=(m.rev-base.rev)*RAMP[i];cum.push(run);}
    return {lv:lv,m:m,cum:cum,extraYear:run,extraBookings:(m.bookings-base.bookings)*RAMP_SUM};
  });
  return {base:base,sc:sc};
}
const nf=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
function money(n){return '$'+nf.format(Math.round(n));}
function trimNum(x){const d=x>=100?0:x>=10?1:2;return String(parseFloat(x.toFixed(d)));}
function moneyShort(n){
  const a=Math.abs(n),sg=n<0?'-':'';
  if(a>=1e6)return sg+'$'+trimNum(a/1e6)+' million';
  return sg+money(a);
}
function axisMoney(v){
  if(v>=1e6)return '$'+trimNum(v/1e6)+'M';
  if(v>=1e3)return '$'+trimNum(v/1e3)+'k';
  return '$'+Math.round(v);
}
function scaleTicks(v){
  const raw=(v||1)/4,p=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/p;
  const s=(n<=1?1:n<=2?2:n<=5?5:10)*p,max=Math.ceil(v/s)*s,ticks=[];
  for(let t=0;t<=max+1e-9;t+=s)ticks.push(t);
  return {max:max,ticks:ticks};
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const EXAMPLE_SCAN={url:'example-events.in',scores:{perf:38,seo:83,a11y:79,bp:74},lcp:5200,cls:.18,tbt:740,
  fails:['meta-description','image-alt','target-size']};

function parseScan(d,u){
  const lr=d&&d.lighthouseResult;
  if(!lr)throw new Error('nodata');
  const a=lr.audits||{},c=lr.categories||{};
  const sc=k=>Math.round((((c[k]||{}).score)||0)*100);
  const ids=['viewport','meta-description','document-title','is-crawlable','image-alt','link-text','is-on-https','tap-targets','target-size','font-size','canonical','robots-txt'];
  const num=id=>((a[id]||{}).numericValue)||0;
  return {url:lr.finalUrl||u,scores:{perf:sc('performance'),seo:sc('seo'),a11y:sc('accessibility'),bp:sc('best-practices')},
    lcp:num('largest-contentful-paint'),cls:num('cumulative-layout-shift'),tbt:num('total-blocking-time'),
    fails:ids.filter(id=>a[id]&&a[id].score===0)};
}
/*__DOM__*/
const $=id=>document.getElementById(id);
let scan=EXAMPLE_SCAN,scanIsExample=true,lastCum=null;

function buildChecks(){
  const el=$('checks');
  el.innerHTML=GROUPS.map((g,gi)=>'<div class="group"><h3>'+g+'</h3><div class="checks">'+
    CATALOG.filter(p=>p.src==='self'&&p.group===gi).map(p=>
      '<label class="check"><input type="checkbox" id="c-'+p.id+'"'+(p.on?' checked':'')+'><span>'+p.label+'</span></label>').join('')+
    '</div></div>').join('');
  el.addEventListener('change',render);
}
function buildMethod(){
  const lev={conv:'Visitors who enquire',traffic:'Visitors from search',close:'Enquiries that book'};
  const rows=CATALOG.map(p=>'<tr><td>'+p.title+'</td><td>'+lev[p.lever]+'</td><td class="n">+'+(p.up[0]*100).toFixed(p.up[0]<.01?1:0)+'%</td><td class="n">+'+(p.up[1]*100).toFixed(p.up[1]<.01?1:0)+'%</td><td class="n">+'+(p.up[2]*100).toFixed(0)+'%</td></tr>').join('');
  $('methodbody').innerHTML=
   '<p>Your current revenue from the website is <code>enquiries × booking rate × average booking value</code>.</p>'+
   '<p>Each problem has a low, expected and high improvement on one of three things: how many people find you, how many of them enquire, and how many enquiries book. Fixes overlap, so they are combined as <code>1 − (1 − a)(1 − b)(1 − c)…</code> rather than added, and each group is capped at +'+(CAPS.traffic*100)+'% for visitors, +'+(CAPS.conv*100)+'% for enquiries and +'+(CAPS.close*100)+'% for bookings.</p>'+
   '<ul><li>Fixes take effect gradually: 25% of the gain in month 1, 60% in month 2 and all of it from month 3.</li>'+
   '<li>Demand is assumed flat across the year. Event businesses have peak seasons, so real months will vary.</li>'+
   '<li>The percentages are planning assumptions, not measured results from specific businesses. Results depend on your market, your season and how well the fixes are done.</li></ul>'+
   '<div class="tablewrap"><table><thead><tr><th>Problem</th><th>Affects</th><th>Low</th><th>Expected</th><th>High</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function renderScan(){
  const out=$('scanout');
  if(!scan){out.innerHTML='';return;}
  const state=n=>n>=90?'good':n>=50?'mid':'bad';
  const head=scanIsExample
    ?'<span class="pill ex">Example scan</span><span>Sample results so you can see the report. Scan your own site to replace them.</span>'
    :'<span class="pill ok">Live scan</span><span>'+esc(scan.url)+', on a mobile connection</span>';
  const sc=[['perf','Speed'],['seo','Search'],['a11y','Accessibility'],['bp','Best practice']];
  const met=(l,v,s)=>'<div><dt>'+l+'</dt><dd class="'+s+'">'+v+'</dd></div>';
  out.innerHTML='<div class="scanhead">'+head+'</div>'+
    '<div class="scores">'+sc.map(x=>'<div class="score '+state(scan.scores[x[0]])+'"><b>'+scan.scores[x[0]]+'</b><span>'+x[1]+'</span><i style="--v:'+scan.scores[x[0]]+'%"></i></div>').join('')+'</div>'+
    '<dl class="metrics">'+
      met('Main content appears',(scan.lcp/1000).toFixed(1)+' s',scan.lcp>4000?'bad':scan.lcp>2500?'mid':'good')+
      met('Layout shift',scan.cls.toFixed(2),scan.cls>.25?'bad':scan.cls>.1?'mid':'good')+
      met('Busy while loading',Math.round(scan.tbt)+' ms',scan.tbt>600?'bad':scan.tbt>200?'mid':'good')+
    '</dl>';
}
function getInputs(){
  const n=id=>{const v=parseFloat($(id).value);return isFinite(v)&&v>0?v:0;};
  return {visitors:n('visitors'),enq:n('enq'),close:Math.min(1,n('close')/100),value:n('value')};
}
function activeProblems(){
  const list=[];
  if(scan)CATALOG.filter(p=>p.src==='scan').forEach(p=>{const sev=p.detect(scan);if(sev>0)list.push(Object.assign({},p,{sev:sev}));});
  CATALOG.filter(p=>p.src==='self').forEach(p=>{const c=$('c-'+p.id);if(c&&!c.checked)list.push(Object.assign({},p,{sev:1}));});
  return list;
}
let lastResult=null;
function render(){
  const inp=getInputs(),der=$('derived');
  let msg='',ok=true;
  if(!inp.visitors||!inp.enq||!inp.close||!inp.value){ok=false;msg='Fill in all four numbers to see your estimate.';}
  else if(inp.enq>inp.visitors){ok=false;msg='Enquiries cannot be higher than visitors. Check the two numbers.';}
  der.className='derived'+(ok?'':' err');
  ['chartcard','issuescard','method','leadcard'].forEach(id=>{$(id).hidden=!ok;});
  if(!ok){
    der.textContent=msg;$('hero').innerHTML='<p>'+msg+'</p>';$('livevalue').textContent='Waiting for your numbers';lastResult=null;return;
  }
  const list=activeProblems(),r=calc(inp,list),ex=r.sc[1];
  lastResult={inp:inp,list:list,r:r};
  der.textContent=(inp.enq/inp.visitors*100).toFixed(1)+'% of visitors enquire. Your website brings in about '+r.base.bookings.toFixed(1)+' bookings and '+money(r.base.rev)+' a month today, which is '+moneyShort(r.base.rev*12)+' a year.';
  $('livevalue').textContent=list.length?'+'+moneyShort(ex.extraYear):'Nothing to fix yet';

  const lvl=ex.lv,pct=v=>'+'+Math.round(v*100)+'%';
  $('hero').innerHTML=
   '<div class="heroline"><span class="eyebrow">Estimate for the next 12 months</span>'+
   '<div><span class="big">'+(list.length?moneyShort(ex.extraYear):'$0')+'</span></div>'+
   '<p>more booking revenue in year one, expected case'+(list.length?', about '+Math.max(0,Math.round(ex.extraBookings))+' more bookings at '+money(inp.value)+' each':'')+'.</p>'+
   '<p class="note">Range '+moneyShort(r.sc[0].extraYear)+' to '+moneyShort(r.sc[2].extraYear)+'. Assumes every problem listed below is fixed.</p></div>'+
   '<div class="stats"><div class="stat"><span>Today, per year</span><b>'+moneyShort(r.base.rev*12)+'</b></div>'+
   '<div class="stat"><span>With fixes, year one</span><b>'+moneyShort(r.base.rev*12+ex.extraYear)+'</b></div>'+
   '<div class="stat"><span>Per month once fixed</span><b>'+moneyShort(ex.m.rev)+'</b></div></div>'+
   '<div class="levers"><div class="lever"><b>'+pct(lvl.traffic)+'</b><span>more visitors from search</span></div>'+
   '<div class="lever"><b>'+pct(lvl.conv)+'</b><span>more visitors who enquire</span></div>'+
   '<div class="lever"><b>'+pct(lvl.close)+'</b><span>more enquiries that book</span></div></div>';

  $('legend').innerHTML='<span>Expected <b>'+moneyShort(ex.extraYear)+'</b></span><span>Low <b>'+moneyShort(r.sc[0].extraYear)+'</b></span><span>High <b>'+moneyShort(r.sc[2].extraYear)+'</b></span>';
  lastCum=[r.sc[0].cum,r.sc[1].cum,r.sc[2].cum];
  drawChart();

  const items=list.map(p=>{
    const rest=list.filter(x=>x!==p),m=model(inp,levers(rest,1));
    return {p:p,gain:Math.max(0,(ex.m.rev-m.rev)*RAMP_SUM)};
  }).sort((a,b)=>b.gain-a.gain);
  const tot=items.reduce((s,x)=>s+x.gain,0)||1;
  if(!items.length){
    $('issues').innerHTML='<p>No gaps found with the information given.'+(scan?'':' Run a scan to check page speed and search setup.')+'</p>';
  }else{
    $('issues').innerHTML=items.map(x=>{
      const sh=x.gain/tot,cls=sh>=.25?'hi':sh>=.1?'md':'lo',lab=sh>=.25?'High':sh>=.1?'Medium':'Low';
      const why=typeof x.p.why==='function'?x.p.why(scan):x.p.why;
      return '<div class="issue"><div class="ibody"><div class="ititle"><span>'+x.p.title+'</span><span class="pill '+cls+'">'+lab+'</span></div>'+
        '<p class="iwhy">'+why+'</p><p class="ifix"><b>Fix:</b> '+x.p.fix+'</p>'+
        '<p class="isrc">'+(x.p.src==='scan'?'Found by the scan'+(scanIsExample?' (example)':''):'From your answers')+'</p></div>'+
        '<div class="igain"><span>+'+moneyShort(x.gain)+'</span><small>a year</small></div></div>';
    }).join('');
  }
}
function drawChart(){
  const el=$('chart');
  if(!lastCum||el.offsetParent===null&&!el.clientWidth)return;
  const lo=lastCum[0],ex=lastCum[1],hi=lastCum[2];
  const W=Math.max(300,Math.floor(el.clientWidth||600)),H=250,ml=48,mr=14,mt=12,mb=32;
  const top=Math.max(hi[11],ex[11],lo[11],1),sc=scaleTicks(top);
  const X=i=>ml+(W-ml-mr)*i/11,Y=v=>mt+(H-mt-mb)*(1-v/sc.max);
  const pts=a=>a.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1));
  let s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="Cumulative extra revenue over 12 months. Expected '+moneyShort(ex[11])+', low '+moneyShort(lo[11])+', high '+moneyShort(hi[11])+'.">';
  sc.ticks.forEach(t=>{const y=Y(t).toFixed(1);
    s+='<line class="cg" x1="'+ml+'" x2="'+(W-mr)+'" y1="'+y+'" y2="'+y+'"/><text class="ct" x="'+(ml-8)+'" y="'+(+y+4)+'" text-anchor="end">'+axisMoney(t)+'</text>';});
  [0,2,5,8,11].forEach(i=>{s+='<text class="ct" x="'+X(i).toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle">M'+(i+1)+'</text>';});
  s+='<path class="cb" d="M'+pts(hi).join(' L')+' L'+pts(lo).reverse().join(' L')+' Z"/>';
  s+='<polyline class="cd" points="'+pts(hi).join(' ')+'"/><polyline class="cd" points="'+pts(lo).join(' ')+'"/>';
  s+='<polyline class="cl" points="'+pts(ex).join(' ')+'"/>';
  s+='<circle class="cdot" cx="'+X(11).toFixed(1)+'" cy="'+Y(ex[11]).toFixed(1)+'" r="5"/></svg>';
  el.innerHTML=s;
}

function status(id,text,cls){const e=$(id);e.textContent=text;e.className='status'+(cls?' '+cls:'');}
async function runScan(){
  let u=$('url').value.trim();
  if(!u){status('scanstatus','Enter your website address first.','err');return;}
  if(!/^https?:\/\//i.test(u))u='https://'+u;
  try{new URL(u);}catch(e){status('scanstatus','That address does not look right. Try something like yourbusiness.in.','err');return;}
  const btn=$('scanbtn');btn.disabled=true;
  $('scanstatus').className='status';
  $('scanstatus').innerHTML='<span class="spin"></span>Scanning on a mobile connection. This takes up to 30 seconds.';
  const qs=new URLSearchParams();qs.set('url',u);qs.set('strategy','mobile');
  ['performance','seo','accessibility','best-practices'].forEach(c=>qs.append('category',c));
  if(CONFIG.PSI_API_KEY&&!/PASTE_YOUR/.test(CONFIG.PSI_API_KEY))qs.set('key',CONFIG.PSI_API_KEY);
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),75000);
  try{
    let res=await fetch(PSI+'?'+qs.toString(),{signal:ctrl.signal});
    if(!res.ok&&qs.has('key')){
      /* A key that is restricted to other domains, not enabled for this API, or invalid makes Google refuse the call. Try once without it. */
      let why='';try{why=((await res.clone().json()).error||{}).message||'';}catch(e){}
      console.warn('PageSpeed call with key failed',res.status,why);
      if(res.status===403||res.status===429||res.status===400&&/api key|referer|referrer|not been used|disabled|blocked|not valid/i.test(why)){
        qs.delete('key');res=await fetch(PSI+'?'+qs.toString(),{signal:ctrl.signal});
      }
    }
    if(!res.ok){let why='';try{why=((await res.json()).error||{}).message||'';}catch(e){}console.warn('PageSpeed call failed',res.status,why);throw new Error('http'+res.status);}
    scan=parseScan(await res.json(),u);scanIsExample=false;logScan(scan);
    renderScan();render();
    status('scanstatus','Scan complete. The report below now uses your results.','ok');
  }catch(e){
    const m=String(e&&e.message);
    status('scanstatus',
      e&&e.name==='AbortError'?'The scan took too long. Try again in a minute.':
      m==='http429'?'Google\'s free scan is busy right now. Try again in a minute.':
      m==='http400'||m==='http500'?'Google could not load that address. Check that it is public and spelled correctly.':
      m==='http403'?'Google refused the scan request. The API key may be restricted or the PageSpeed Insights API is not enabled for it.':
      'The scan could not reach Google from this page. You can still use the checklist below, or try again later.','err');
  }finally{clearTimeout(t);btn.disabled=false;}
}
function logScan(s){
  if(!CONFIG.SCAN_LOG_ENDPOINT)return;
  try{
    fetch(CONFIG.SCAN_LOG_ENDPOINT,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({time:new Date().toISOString(),url:s.url,speed:s.scores.perf,search:s.scores.seo,accessibility:s.scores.a11y,best_practice:s.scores.bp})}).catch(()=>{});
  }catch(e){}
}
async function sendLead(ev){
  ev.preventDefault();
  const name=$('lname').value.trim(),contact=$('lcontact').value.trim();
  if(!name||!contact){status('leadstatus','Add your name and a WhatsApp number or email.','err');return;}
  if(!lastResult){status('leadstatus','Fill in your numbers first so the plan matches your site.','err');return;}
  if(!CONFIG.LEAD_ENDPOINT||false){status('leadstatus','This copy is not connected to a lead inbox yet, so nothing was sent.','err');return;}
  const L=lastResult,ex=L.r.sc[1];
  const payload=Object.assign({subject:'New website audit lead',from_name:'Revenue Leak Audit'},CONFIG.LEAD_EXTRA,{
    name:name,contact:contact,business_type:$('lbiz').value,website:scanIsExample?'':(scan&&scan.url)||$('url').value.trim(),
    visitors_per_month:L.inp.visitors,enquiries_per_month:L.inp.enq,booking_rate:L.inp.close,avg_booking_value_usd:L.inp.value,
    expected_extra_year_usd:Math.round(ex.extraYear),low_extra_year_usd:Math.round(L.r.sc[0].extraYear),high_extra_year_usd:Math.round(L.r.sc[2].extraYear),
    problems:L.list.map(p=>p.title).join('; '),scan_scores:scanIsExample?'':JSON.stringify(scan.scores)});
  const b=$('leadbtn');b.disabled=true;status('leadstatus','Sending...');
  try{
    const res=await fetch(CONFIG.LEAD_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
    let data={};try{data=await res.json();}catch(e){}
    if(!res.ok||data.success===false)throw new Error('http');
    status('leadstatus','Thank you. Your report and plan are on the way.','ok');
    $('leadform').reset();
  }catch(e){status('leadstatus','Sorry, that did not send. Check your connection and try again.','err');}
  finally{b.disabled=false;}
}

if(CONFIG.SCAN_LOG_ENDPOINT)$('lognote').hidden=false;
buildChecks();buildMethod();renderScan();render();
['visitors','enq','close','value'].forEach(id=>$(id).addEventListener('input',render));
$('scanform').addEventListener('submit',e=>{e.preventDefault();runScan();});
$('leadform').addEventListener('submit',sendLead);
if(window.ResizeObserver){let raf=0;new ResizeObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(drawChart);}).observe($('chart'));}
else window.addEventListener('resize',drawChart);
