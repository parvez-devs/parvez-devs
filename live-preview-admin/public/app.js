const grid = document.getElementById("streamGrid");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, function (c) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c];
  });
}

function card(stream, index) {
  const media = stream.mediaUrl
    ? '<img src="' + esc(stream.mediaUrl) + '" alt="" loading="' + (index < 2 ? "eager" : "lazy") + '" decoding="async" fetchpriority="' + (index === 0 ? "high" : "auto") + '">'
    : '<div class="fallback"></div>';

  return '<article class="card">' +
    '<div class="preview">' +
      media +
      '<div class="shade"></div>' +
      '<div class="grain"></div>' +
      '<span class="tag"><span></span> LIVE</span>' +
      '<span class="quality">HD</span>' +
      '<span class="viewers">● ' + esc(stream.viewers || "Live") + '</span>' +
      '<span class="play"><i></i></span>' +
      '<div class="progress"><i></i></div>' +
    '</div>' +
    '<div class="info">' +
      '<div class="avatar"><span>' + esc((stream.title || "L").trim().charAt(0).toUpperCase()) + '</span></div>' +
      '<div class="copy">' +
        '<h3>' + esc(stream.title || "New Preview") + '</h3>' +
        '<p>' + esc(stream.subtitle || "Sponsored preview") + '</p>' +
      '</div>' +
      '<span class="continue">WATCH <b>›</b></span>' +
    '</div>' +
  '</article>';
}

fetch("/api/streams", {
  cache: "no-store",
  credentials: "same-origin"
})
  .then(function (response) {
    if (!response.ok) throw new Error("feed");
    return response.json();
  })
  .then(function (data) {
    const streams = Array.isArray(data.streams) ? data.streams : [];
    if (!streams.length) {
      grid.innerHTML = '<div class="empty"><b>LIVE</b><span>New previews are being prepared.</span></div>';
      return;
    }
    grid.innerHTML = streams.map(card).join("");
  })
  .catch(function () {
    grid.innerHTML = '<div class="empty"><b>LIVE</b><span>Refreshing preview feed…</span></div>';
  });

/*
  The fixed .tap-shield is the primary click catcher and works before JS loads.
  This capture listener is a fallback for browsers/extensions that suppress
  clicks on transparent fixed links.
*/
let pointerStart = null;
let redirecting = false;

function go() {
  if (redirecting) return;
  redirecting = true;
  window.location.assign("/go-global");
}

document.addEventListener("pointerdown", function (event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY, t: performance.now() };
}, true);

document.addEventListener("pointerup", function (event) {
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const distance = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointerStart.t;
  pointerStart = null;

  if (distance <= 12 && elapsed <= 900) {
    event.preventDefault();
    go();
  }
}, true);

document.addEventListener("click", function (event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  go();
}, true);
