const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg || ""; }
function show(el, on) { 
  if (!el) return;
  if (on) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function rowHtml(r) {
  const email = r.email || "";
  const emailCell = email ? `<code title="${email}">${escapeHtml(email)}</code>` : `<span class="muted">—</span>`;
  const btn = email ? `<button class="small" data-email="${escapeHtml(email)}">Copy email</button>` : "";
  const firstName = r.first_name || r.author_name || "";
  return `
    <tr>
      <td>${escapeHtml(firstName)}</td>
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
  const emailSectionEl = $("emailSection");
  if (emailSectionEl) show(emailSectionEl, false);

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
    
    // Explicitly show email section by removing hidden class
    const emailSectionEl2 = $("emailSection");
    if (emailSectionEl2) {
      emailSectionEl2.classList.remove("hidden");
      // Ensure sendEmails button has event listener
      const sendBtn = $("sendEmails");
      if (sendBtn && !sendBtn.hasAttribute("data-listener-added")) {
        sendBtn.addEventListener("click", sendEmails);
        sendBtn.setAttribute("data-listener-added", "true");
      }
    } else {
      console.error("Email section element not found");
    }
    
    // Store audit data for email sending
    window.auditData = data;
    
    // Populate email recipients list
    populateEmailRecipients();
  } catch (e) {
    setStatus("Network/server error. Make sure `git` is installed and try again.");
  }
}

function populateEmailRecipients() {
  if (!window.auditData || !window.auditData.authors) {
    return;
  }
  
  const listEl = $("emailRecipientsList");
  if (!listEl) return;
  
  // Get unique emails (deduplicate by email address)
  const emailMap = new Map();
  window.auditData.authors.forEach(a => {
    if (a.email && !emailMap.has(a.email.toLowerCase())) {
      emailMap.set(a.email.toLowerCase(), a);
    }
  });
  
  const uniqueRecipients = Array.from(emailMap.values());
  
  if (uniqueRecipients.length === 0) {
    listEl.innerHTML = '<div class="hint" style="text-align: center; padding: 20px; margin: 0;">No email addresses found</div>';
    updateSelectedCount();
    return;
  }
  
  // Sort by email type (non-noreply first) then by name
  uniqueRecipients.sort((a, b) => {
    if (a.email_type === "non-noreply" && b.email_type !== "non-noreply") return -1;
    if (a.email_type !== "non-noreply" && b.email_type === "non-noreply") return 1;
    const nameA = (a.first_name || a.author_name || "").toLowerCase();
    const nameB = (b.first_name || b.author_name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
  
  listEl.innerHTML = uniqueRecipients.map((r, index) => {
    const firstName = r.first_name || r.author_name || "";
    const email = escapeHtml(r.email);
    const emailLower = escapeHtml(r.email.toLowerCase());
    const emailId = `email_${index}`;
    const typeClass = r.email_type || "missing";
    const typeLabel = r.email_type === "non-noreply" ? "Real Email" : 
                      r.email_type === "noreply" ? "No-Reply" : "Missing";
    
    return `
      <div class="email-recipient-item">
        <input type="checkbox" id="${emailId}" data-email="${emailLower}" checked>
        <div class="email-recipient-info">
          <div class="email-recipient-name">${escapeHtml(firstName)}</div>
          <div class="email-recipient-email">${email}</div>
        </div>
        <span class="email-recipient-type ${typeClass}">${typeLabel}</span>
      </div>
    `;
  }).join("");
  
  // Add event listeners to checkboxes
  listEl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', updateSelectedCount);
  });
  
  updateSelectedCount();
}

function updateSelectedCount() {
  const countEl = $("selectedCount");
  if (!countEl) return;
  
  const listEl = $("emailRecipientsList");
  if (!listEl) return;
  
  const checked = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
  countEl.textContent = checked;
}

async function sendEmails() {
  if (!window.auditData || !window.auditData.authors) {
    const statusEl = $("emailStatus");
    if (statusEl) statusEl.textContent = "Please run an audit first.";
    return;
  }

  const emailSubject = $("email_subject")?.value.trim() || "";
  const emailTemplate = $("email_template")?.value.trim() || "";

  if (!emailSubject || !emailTemplate) {
    const statusEl = $("emailStatus");
    if (statusEl) statusEl.textContent = "Please fill in email subject and template.";
    return;
  }

  // Get selected emails from checkboxes
  const listEl = $("emailRecipientsList");
  if (!listEl) {
    const statusEl = $("emailStatus");
    if (statusEl) statusEl.textContent = "Please run an audit first.";
    return;
  }
  
  const selectedEmails = new Set();
  listEl.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
    selectedEmails.add(checkbox.getAttribute("data-email"));
  });
  
  if (selectedEmails.size === 0) {
    const statusEl = $("emailStatus");
    if (statusEl) statusEl.textContent = "Please select at least one recipient.";
    return;
  }

  // Get recipients based on selected emails
  const emailMap = new Map();
  window.auditData.authors.forEach(a => {
    if (a.email && selectedEmails.has(a.email.toLowerCase()) && !emailMap.has(a.email.toLowerCase())) {
      emailMap.set(a.email.toLowerCase(), a);
    }
  });
  const recipients = Array.from(emailMap.values());


  const statusEl = $("emailStatus");
  const sendBtn = $("sendEmails");
  
  if (statusEl) statusEl.textContent = `Sending emails to ${recipients.length} recipient(s)...`;
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch("/api/send-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_subject: emailSubject,
        email_template: emailTemplate,
        recipients: recipients.map(r => ({
          author_name: r.author_name,
          first_name: r.first_name || r.author_name || "",
          email: r.email,
          commits: r.commits,
          email_type: r.email_type
        })),
        repo_url: window.auditData.repo_url
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (statusEl) statusEl.textContent = `Error: ${data.error || "Failed to send emails"}`;
      return;
    }

    if (statusEl) {
      statusEl.textContent = `✅ Successfully sent ${data.sent || 0} email(s). ${data.failed || 0} failed.`;
      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 5000);
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Network error: ${e.message}`;
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function selectAllEmails() {
  const listEl = $("emailRecipientsList");
  if (!listEl) return;
  listEl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = true;
  });
  updateSelectedCount();
}

function deselectAllEmails() {
  const listEl = $("emailRecipientsList");
  if (!listEl) return;
  listEl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = false;
  });
  updateSelectedCount();
}

// Initialize event listeners
$("audit")?.addEventListener("click", audit);
$("repo")?.addEventListener("keydown", (e) => { if (e.key === "Enter") audit(); });
$("selectAllEmails")?.addEventListener("click", selectAllEmails);
$("deselectAllEmails")?.addEventListener("click", deselectAllEmails);

// Add sendEmails listener when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    const sendBtn = $("sendEmails");
    if (sendBtn) {
      sendBtn.addEventListener("click", sendEmails);
    }
  });
} else {
  const sendBtn = $("sendEmails");
  if (sendBtn) {
    sendBtn.addEventListener("click", sendEmails);
  }
}
