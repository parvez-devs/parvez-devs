const q = function (selector) { return document.querySelector(selector); };

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

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

  const response = await fetch(url, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showDashboard() {
  q("#loginView").classList.add("hidden");
  q("#dashboard").classList.remove("hidden");
}

function cardHtml(stream) {
  const media = stream.mediaUrl
    ? '<img src="' + esc(stream.mediaUrl) + '" alt="">'
    : '<span>No media</span>';

  return '<article class="editor-card" data-id="' + esc(stream.id) + '">' +
    '<div class="thumb">' + media + '</div>' +
    '<div class="fields">' +
      '<label>Title<input data-key="title" value="' + esc(stream.title) + '"></label>' +
      '<label>Viewer text<input data-key="viewers" value="' + esc(stream.viewers) + '"></label>' +
      '<label class="wide">Subtitle<input data-key="subtitle" value="' + esc(stream.subtitle) + '"></label>' +
      '<label class="wide">GIF / image URL<input data-key="mediaUrl" value="' + esc(stream.mediaUrl || "") + '"></label>' +
      '<label class="wide">Card redirect link<input data-key="adUrl" value="' + esc(stream.adUrl || "") + '"></label>' +
      '<div class="row wide">' +
        '<label class="upload-button">Upload GIF/image<input class="upload" type="file" accept="image/gif,image/webp,image/jpeg,image/png"></label>' +
        '<label class="toggle"><input data-key="enabled" type="checkbox" ' + (stream.enabled ? "checked" : "") + '> Enabled</label>' +
        '<button class="save" type="button">Save</button>' +
        '<button class="delete danger" type="button">Delete</button>' +
        '<span class="status"></span>' +
        '<span class="clicks">Clicks: ' + Number(stream.clicks || 0).toLocaleString() + '</span>' +
      '</div>' +
    '</div>' +
  '</article>';
}

function renderHeroPreview(url) {
  const box = q("#heroPreviewBox");
  const value = String(url || "").trim();
  if (!value) {
    box.innerHTML = "<span>No main player preview URL set</span>";
    return;
  }
  box.innerHTML = '<img src="' + esc(value) + '" alt="Main player preview">';
}

async function load() {
  const data = await api("/api/admin/state");
  q("#globalAdUrl").value = data.globalAdUrl || "";
  q("#heroMediaUrl").value = data.heroMediaUrl || "";
  renderHeroPreview(data.heroMediaUrl || "");
  q("#globalClicks").textContent = "Verified redirect hits: " + Number(data.globalClicks || 0).toLocaleString();
  q("#cards").innerHTML = data.streams.map(cardHtml).join("");
  bindCards();
}

function bindCards() {
  document.querySelectorAll(".editor-card").forEach(function (card) {
    const id = card.dataset.id;
    const status = card.querySelector(".status");

    card.querySelector(".save").onclick = async function () {
      const body = {};
      card.querySelectorAll("[data-key]").forEach(function (input) {
        body[input.dataset.key] = input.type === "checkbox" ? input.checked : input.value;
      });

      status.textContent = "Saving…";
      try {
        await api("/api/admin/streams/" + encodeURIComponent(id), {
          method: "PUT",
          body: JSON.stringify(body)
        });
        status.textContent = "Saved";
      } catch (error) {
        status.textContent = error.message;
      }
    };

    card.querySelector(".delete").onclick = async function () {
      if (!confirm("Delete this card?")) return;
      await api("/api/admin/streams/" + encodeURIComponent(id), { method: "DELETE" });
      await load();
    };

    card.querySelector(".upload").onchange = async function (event) {
      const file = event.target.files[0];
      if (!file) return;

      const form = new FormData();
      form.append("media", file);
      status.textContent = "Uploading…";

      try {
        await api("/api/admin/streams/" + encodeURIComponent(id) + "/upload", {
          method: "POST",
          body: form
        });
        await load();
      } catch (error) {
        status.textContent = error.message;
      }
    };
  });
}

q("#loginForm").onsubmit = async function (event) {
  event.preventDefault();
  q("#loginMessage").textContent = "Signing in…";

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: q("#username").value,
        password: q("#password").value
      })
    });
    q("#loginMessage").textContent = "";
    showDashboard();
    await load();
  } catch (error) {
    q("#loginMessage").textContent = error.message;
  }
};

q("#saveGlobal").onclick = async function () {
  q("#globalMessage").textContent = "Saving…";
  try {
    const data = await api("/api/admin/global", {
      method: "PUT",
      body: JSON.stringify({
        globalAdUrl: q("#globalAdUrl").value,
        heroMediaUrl: q("#heroMediaUrl").value.trim()
      })
    });
    q("#globalMessage").textContent = "Saved";
    renderHeroPreview(data.heroMediaUrl || "");
    q("#globalClicks").textContent = "Verified redirect hits: " + Number(data.globalClicks || 0).toLocaleString();
  } catch (error) {
    q("#globalMessage").textContent = error.message;
  }
};

q("#heroMediaUrl").addEventListener("input", function () {
  renderHeroPreview(this.value);
});

q("#addCard").onclick = async function () {
  await api("/api/admin/streams", {
    method: "POST",
    body: JSON.stringify({
      title: "New Preview",
      subtitle: "Sponsored preview",
      viewers: "Live",
      enabled: true
    })
  });
  await load();
};

q("#logout").onclick = async function () {
  await api("/api/admin/logout", { method: "POST" }).catch(function () {});
  location.reload();
};

api("/api/admin/me")
  .then(async function () {
    showDashboard();
    await load();
  })
  .catch(function () {});
