const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg || ""; }
function show(el, on) { el.classList.toggle("hidden", !on); }

function rowHtml(r) {
  const email = r.email || "";
  const emailCell = email ? `<code title="${email}">${escapeHtml(email)}</code>` : `<span class="muted">—</span>`;
  const btn = email ? `<button class="small" data-email="${escapeHtml(email)}">Copy email</button>` : "";
  return `
    <tr>
      <td>${escapeHtml(r.author_name)}</td>
      <td>${r.commits}</td>
      <td>${escapeHtml(r.email_type)}</td>
      <td>${emailCell}</td>
      <td>${btn}</td>
    </tr>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function audit() {
  const repo = $("repo").value.trim();
  const max_commits = Number($("max").value || 2000);

  if (!repo) {
    setStatus("Paste a GitHub repo URL.");
    return;
  }

  setStatus("Cloning + scanning... (this may take a bit)");
  show($("summary"), false);
  show($("tableWrap"), false);

  try {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, max_commits })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "Audit failed.");
      return;
    }

    $("s_commits").textContent = data.scanned_commits;
    $("s_authors").textContent = data.unique_authors;
    $("s_non").textContent = data.unique_non_noreply_emails;
    $("s_repo").href = data.repo_url;

    const tbody = $("tbody");
    tbody.innerHTML = "";
    for (const r of (data.authors || [])) {
      tbody.insertAdjacentHTML("beforeend", rowHtml(r));
    }

    tbody.querySelectorAll("button[data-email]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const email = btn.getAttribute("data-email");
        if (!email) return;
        try {
          await navigator.clipboard.writeText(email);
          setStatus("Copied email ✅");
          setTimeout(() => setStatus(""), 1200);
        } catch {
          setStatus("Copy failed. Select and copy manually.");
        }
      });
    });

    setStatus("");
    show($("summary"), true);
    show($("tableWrap"), true);
  } catch (e) {
    setStatus("Network/server error. Make sure `git` is installed and try again.");
  }
}

$("audit").addEventListener("click", audit);
$("repo").addEventListener("keydown", (e) => { if (e.key === "Enter") audit(); });
