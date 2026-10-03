const grid = document.getElementById("streamGrid");
let globalRedirectEnabled = false;

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

function card(stream) {
  const media = stream.mediaUrl
    ? '<img src="' + esc(stream.mediaUrl) + '" alt="' + esc(stream.title) + '" loading="lazy">'
    : '<div class="fallback"></div>';

  return '<a class="card" href="/go/' + encodeURIComponent(stream.id) + '" rel="sponsored">' +
    '<div class="preview">' +
      media +
      '<div class="shade"></div>' +
      '<span class="tag">PREVIEW</span>' +
      '<span class="sponsored">SPONSORED</span>' +
      '<span class="viewers">● ' + esc(stream.viewers || "Live") + '</span>' +
      '<span class="play"><i></i></span>' +
    '</div>' +
    '<div class="info">' +
      '<h2>' + esc(stream.title || "New Preview") + '</h2>' +
      '<div class="sub"><span>' + esc(stream.subtitle || "Sponsored preview") + '</span><b>Continue →</b></div>' +
    '</div>' +
  '</a>';
}

fetch("/api/streams", { cache: "no-store" })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    globalRedirectEnabled = Boolean(data.globalRedirect);
    if (!data.streams || !data.streams.length) {
      grid.innerHTML = '<div class="empty">No previews enabled.</div>';
      return;
    }
    grid.innerHTML = data.streams.map(card).join("");
  })
  .catch(function () {
    grid.innerHTML = '<div class="empty">Feed unavailable.</div>';
  });

document.addEventListener("click", function (event) {
  if (!globalRedirectEnabled) return;
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign("/go-global");
}, true);
