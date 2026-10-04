const grid=document.getElementById("streamGrid");
const hero=document.getElementById("heroPlayer");
const title=document.getElementById("heroTitle");
const viewers=document.getElementById("heroViewers");
const count=document.getElementById("streamCount");

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function rec(stream,index){
  const media=stream.mediaUrl
    ? '<img src="'+esc(stream.mediaUrl)+'" alt="" loading="'+(index<2?"eager":"lazy")+'" decoding="async">'
    : '<div class="rec-fallback"></div>';
  return '<article class="rec-card">'+
    '<div class="rec-media">'+media+
      '<span class="rec-live">LIVE</span>'+
      '<span class="rec-view">● '+esc(stream.viewers||"Live")+'</span>'+
      '<span class="rec-play"><i></i></span>'+
    '</div>'+
    '<div class="rec-info"><div><h3>'+esc(stream.title||"Live Stream")+'</h3><p>'+esc(stream.subtitle||"VIP preview")+'</p></div><b>›</b></div>'+
  '</article>';
}

fetch("/api/streams",{cache:"no-store",credentials:"same-origin"})
  .then(r=>{if(!r.ok)throw new Error("feed");return r.json();})
  .then(data=>{
    const streams=Array.isArray(data.streams)?data.streams:[];
    const first=streams[0];
    const heroMedia=data.heroMediaUrl || (first && first.mediaUrl) || "";
    if(heroMedia){
      const img=new Image();
      img.decoding="async";
      img.fetchPriority="high";
      img.src=heroMedia;
      img.alt="";
      hero.prepend(img);
    }
    if(first){
      title.textContent=first.title||"[LEAKED HD] Exclusive Private Live Stream - Watch Before Taken Down!";
      viewers.textContent=first.viewers||"92,450";
    }else{
      title.textContent="[LEAKED HD] Exclusive Private Live Stream - Watch Before Taken Down!";
      viewers.textContent="92,450";
    }
    count.textContent=(streams.length||1)+" LIVE";
    const rest=streams.length>1?streams.slice(1):streams;
    grid.innerHTML=rest.length?rest.map(rec).join(""):'<div class="empty-rec">More streams are loading...</div>';
  })
  .catch(()=>{
    title.textContent="[LEAKED HD] Exclusive Private Live Stream - Watch Before Taken Down!";
    viewers.textContent="92,450";
    grid.innerHTML='<div class="empty-rec">Live recommendations refreshing...</div>';
  });

let start=null,redirecting=false;
function go(){if(redirecting)return;redirecting=true;location.assign("/go-global");}

document.addEventListener("pointerdown",e=>{
  if(e.pointerType==="mouse"&&e.button!==0)return;
  start={x:e.clientX,y:e.clientY,t:performance.now()};
},true);

document.addEventListener("pointerup",e=>{
  if(!start)return;
  const moved=Math.hypot(e.clientX-start.x,e.clientY-start.y);
  const elapsed=performance.now()-start.t;
  start=null;
  if(moved<=12&&elapsed<=900){e.preventDefault();go();}
},true);

document.addEventListener("click",e=>{
  if(e.button!==undefined&&e.button!==0)return;
  e.preventDefault();
  go();
},true);