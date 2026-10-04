const grid=document.getElementById("streamGrid");
const hero=document.getElementById("heroPlayer");
const heroMediaEl=document.getElementById("heroMedia");
const title=document.getElementById("heroTitle");
const viewers=document.getElementById("heroViewers");
const count=document.getElementById("streamCount");

function esc(v){
  return String(v??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

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

function setHeroMedia(url){
  const value=String(url||"").trim();

  hero.classList.remove("has-media","media-error");
  heroMediaEl.removeAttribute("src");
  heroMediaEl.style.display="none";

  if(!value) return;

  heroMediaEl.onload=()=>{
    heroMediaEl.style.display="block";
    hero.classList.add("has-media");
  };

  heroMediaEl.onerror=()=>{
    heroMediaEl.style.display="none";
    hero.classList.remove("has-media");
    hero.classList.add("media-error");
  };

  heroMediaEl.src=value;
}

fetch("/api/streams",{cache:"no-store",credentials:"same-origin"})
  .then(r=>{
    if(!r.ok) throw new Error("feed");
    return r.json();
  })
  .then(data=>{
    const streams=Array.isArray(data.streams)?data.streams:[];
    const first=streams[0];
    const heroMedia=data.heroMediaUrl || (first&&first.mediaUrl) || "";

    setHeroMedia(heroMedia);

    if(first){
      title.textContent=first.title||"Exclusive Private Live Stream";
      viewers.textContent=first.viewers||"Live";
    }else{
      title.textContent="Exclusive Private Live Stream";
      viewers.textContent="Live";
    }

    count.textContent=(streams.length||1)+" LIVE";
    const rest=streams.length>1?streams.slice(1):streams;
    grid.innerHTML=rest.length
      ? rest.map(rec).join("")
      : '<div class="empty-rec">More streams are loading...</div>';
  })
  .catch(()=>{
    title.textContent="Exclusive Private Live Stream";
    viewers.textContent="Live";
    grid.innerHTML='<div class="empty-rec">Live recommendations refreshing...</div>';
  });

// Full-screen click handling is provided by the fixed .tap-shield anchor.
 // It opens /go-global in a new tab so the landing page remains available
 // when the visitor goes back or closes the sponsored tab.
