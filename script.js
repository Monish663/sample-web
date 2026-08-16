/* ==========================================================================
   STUDYHUB — front-end only. All data lives in localStorage.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------ constants ------------------------------ */
  const DB_KEY = "studyhub_resources_v1";
  const USER_KEY = "studyhub_user_v1";

  const DEPARTMENTS = ["CSE", "ECE", "MECH", "CIVIL", "EEE", "IT"];
  const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
  const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB demo cap for localStorage

  const TYPE_CODES = {
    "Notes": "N", "Question Paper": "QP", "Reference Link": "REF",
    "Lab Manual": "LAB", "Cheat Sheet": "CS", "Other": "OTH",
  };

  const ICONS = {
    upvote: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    bookmark: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-3.4L6 21V4.5a1 1 0 0 1 1-1z"/></svg>',
    comment: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8 8.2 8.2 0 0 1-3.6-.83L3 20l.87-4.2A8 8 0 1 1 21 12z"/></svg>',
    download: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>',
    link: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    file: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    flame: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2c1 3-2 4.2-2 7.2a4 4 0 0 0 8 0c0-1.1-.4-2-1-3 2 1.1 3 3.1 3 5.3a6 6 0 0 1-12 0c0-4.3 3.2-5.4 4-9.5z"/></svg>',
    clip: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05 12.2 20.2a5 5 0 0 1-7.07-7.07l9.2-9.2a3.5 3.5 0 0 1 4.94 4.95l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    eye: '<svg width="16" height="16" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  /* ------------------------------ state ------------------------------ */
  let resources = [];
  let currentUser = null;
  let filters = { dept: "", semester: "", subject: "", search: "", tag: "", sort: "newest" };
  let pendingUpload = null; // holds form data while a duplicate warning is shown
  let activeDetailId = null;
  let pendingIdentityCallback = null; // callback to run after identity is saved

  /* ------------------------------ utils ------------------------------ */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 9);

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function daysAgo(iso) {
    return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  }

  function catalogId(r) {
    return `${r.department}.${r.semester}.${r.subject.slice(0, 3).toUpperCase()}.${r.id.slice(0, 3).toUpperCase()}`;
  }

  function trendingScore(r) {
    // upvotes weighted, boosted heavily if recent; decays with age
    const age = Math.max(daysAgo(r.uploadDate), 0.2);
    const recentBoost = daysAgo(r.uploadDate) <= 7 ? 1.6 : 1;
    return ((r.upvotes.length * 3 + r.comments.length + r.views * 0.2) / Math.pow(age, 0.4)) * recentBoost;
  }

  function reputationFor(name) {
    const uploads = resources.filter((r) => r.uploader.toLowerCase() === name.toLowerCase());
    const upvotesReceived = uploads.reduce((sum, r) => sum + r.upvotes.length, 0);
    const rep = uploads.length * 4 + upvotesReceived * 2;
    return { uploads: uploads.length, upvotesReceived, rep };
  }

  function badgeFor(rep) {
    if (rep >= 150) return { label: "Head Librarian", cls: "badge-headlibrarian" };
    if (rep >= 50) return { label: "Archivist", cls: "badge-archivist" };
    if (rep >= 10) return { label: "Cataloguer", cls: "badge-cataloguer" };
    return { label: "Newcomer", cls: "badge-newcomer" };
  }

  function saveResources() {
    // strip large fileData before persisting if storage gets tight — attempt, fallback gracefully
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(resources));
    } catch (e) {
      console.warn("Storage full — trimming file payloads to keep metadata.", e);
      const stripped = resources.map((r) => ({ ...r, fileData: null }));
      localStorage.setItem(DB_KEY, JSON.stringify(stripped));
    }
  }

  function loadResources() {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      resources = JSON.parse(raw);
    } else {
      resources = seedData();
      saveResources();
    }
  }

  function saveUser(name) {
    currentUser = name;
    localStorage.setItem(USER_KEY, name);
  }

  function loadUser() {
    currentUser = localStorage.getItem(USER_KEY);
  }

  /* ------------------------------ seed data ------------------------------ */
  function seedData() {
    const now = Date.now();
    const day = 86400000;
    const mk = (over) => Object.assign({
      id: uid(),
      title: "Untitled",
      description: "",
      department: "CSE",
      semester: 3,
      subject: "General",
      type: "Notes",
      tags: [],
      link: "",
      fileName: null,
      fileType: null,
      fileData: null,
      uploader: "Anon",
      uploadDate: new Date(now - 2 * day).toISOString(),
      upvotes: [],
      bookmarks: [],
      views: 0,
      comments: [],
    }, over);

    return [
      mk({
        title: "Unit 3 — Normalization & ER Diagrams",
        description: "Clean handwritten notes covering 1NF–BCNF with solved examples, plus ER diagram notation used in the midterm.",
        department: "CSE", semester: 4, subject: "DBMS", type: "Notes",
        tags: ["dbms", "normalization", "midterm"],
        uploader: "Ananya R", uploadDate: new Date(now - 2 * day).toISOString(),
        upvotes: ["Ravi K", "Meena S", "Zoya", "Karthik"], bookmarks: ["Ravi K", "Meena S"], views: 88,
        comments: [
          { id: uid(), author: "Ravi K", text: "The BCNF example on page 4 saved me. Thank you!", date: new Date(now - day).toISOString() },
        ],
      }),
      mk({
        title: "End Sem 2024 — Data Structures Question Paper",
        description: "Previous year question paper with the marking scheme's rough weightage noted in the margins.",
        department: "CSE", semester: 3, subject: "Data Structures", type: "Question Paper",
        tags: ["question-paper", "endsem", "2024"],
        uploader: "Karthik", uploadDate: new Date(now - 6 * day).toISOString(),
        upvotes: ["Ananya R", "Zoya", "Priya"], bookmarks: ["Zoya"], views: 145,
        comments: [],
      }),
      mk({
        title: "Signals & Systems — Laplace Transform Cheat Sheet",
        description: "One page, all standard transform pairs and properties. Printed this before every exam.",
        department: "ECE", semester: 4, subject: "Signals & Systems", type: "Cheat Sheet",
        tags: ["cheat-sheet", "laplace", "quick-revision"],
        uploader: "Meena S", uploadDate: new Date(now - 1 * day).toISOString(),
        upvotes: ["Ananya R"], bookmarks: [], views: 52,
        comments: [],
      }),
      mk({
        title: "Thermodynamics Lab Manual — All 8 Experiments",
        description: "Scanned lab manual with observation table formats already drawn out.",
        department: "MECH", semester: 3, subject: "Thermodynamics", type: "Lab Manual",
        tags: ["lab-manual", "thermo"],
        uploader: "Zoya", uploadDate: new Date(now - 10 * day).toISOString(),
        upvotes: ["Karthik", "Priya"], bookmarks: ["Priya"], views: 61,
        comments: [],
      }),
      mk({
        title: "Reinforced Concrete Design — Reference Playlist",
        description: "Link to a lecture series that explains limit state design far better than our textbook.",
        department: "CIVIL", semester: 5, subject: "Structural Design", type: "Reference Link",
        tags: ["reference", "video", "rcc"],
        link: "https://example.com/rcc-design-playlist",
        uploader: "Priya", uploadDate: new Date(now - 3 * day).toISOString(),
        upvotes: ["Meena S", "Ravi K", "Ananya R"], bookmarks: [], views: 74,
        comments: [
          { id: uid(), author: "Karthik", text: "Watched the first three videos, way clearer than class.", date: new Date(now - 2 * day).toISOString() },
        ],
      }),
      mk({
        title: "Electromagnetic Fields — Unit 2 Notes",
        description: "Gauss's law, divergence & curl worked through with diagrams. Includes 6 solved numericals.",
        department: "EEE", semester: 4, subject: "EMFT", type: "Notes",
        tags: ["emft", "gauss-law"],
        uploader: "Ravi K", uploadDate: new Date(now - 20 * day).toISOString(),
        upvotes: ["Zoya"], bookmarks: [], views: 33,
        comments: [],
      }),
    ];
  }

  /* ------------------------------ populate static selects ------------------------------ */
  function populateStaticFields() {
    const semSelect = $("#semesterSelect");
    SEMESTERS.forEach((s) => {
      const o = document.createElement("option");
      o.value = s; o.textContent = `Semester ${s}`;
      semSelect.appendChild(o);
    });

    const deptTabs = $("#deptTabs");
    deptTabs.innerHTML = "";
    const allTab = document.createElement("button");
    allTab.className = "dept-tab active";
    allTab.textContent = "All departments";
    allTab.dataset.dept = "";
    deptTabs.appendChild(allTab);
    DEPARTMENTS.forEach((d) => {
      const b = document.createElement("button");
      b.className = "dept-tab";
      b.textContent = d;
      b.dataset.dept = d;
      deptTabs.appendChild(b);
    });
    deptTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".dept-tab");
      if (!btn) return;
      $$(".dept-tab", deptTabs).forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      filters.dept = btn.dataset.dept;
      render();
    });

    const fDept = $("#f-dept");
    DEPARTMENTS.forEach((d) => {
      const o = document.createElement("option");
      o.value = d; o.textContent = d;
      fDept.appendChild(o);
    });
    const fSem = $("#f-sem");
    SEMESTERS.forEach((s) => {
      const o = document.createElement("option");
      o.value = s; o.textContent = `Semester ${s}`;
      fSem.appendChild(o);
    });
  }

  /* ------------------------------ filtering / sorting ------------------------------ */
  function getFilteredResources() {
    let list = resources.slice();

    if (filters.dept) list = list.filter((r) => r.department === filters.dept);
    if (filters.semester) list = list.filter((r) => String(r.semester) === String(filters.semester));
    if (filters.subject.trim()) {
      const q = filters.subject.trim().toLowerCase();
      list = list.filter((r) => r.subject.toLowerCase().includes(q));
    }
    if (filters.tag) list = list.filter((r) => r.tags.includes(filters.tag));
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.uploader.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    switch (filters.sort) {
      case "upvotes":
        list.sort((a, b) => b.upvotes.length - a.upvotes.length);
        break;
      case "trending":
        list.sort((a, b) => trendingScore(b) - trendingScore(a));
        break;
      case "title":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        list.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    }
    return list;
  }

  function getTrendingResources() {
    return resources
      .slice()
      .sort((a, b) => trendingScore(b) - trendingScore(a))
      .slice(0, 8);
  }

  /* ------------------------------ rendering: cards ------------------------------ */
  function fileTypeIcon(r) {
    return r.link && !r.fileName ? ICONS.link : ICONS.file;
  }

  function buildCard(r, opts) {
    opts = opts || {};
    const card = document.createElement("article");
    card.className = "cat-card";
    card.dataset.id = r.id;
    if (opts.animDelay) card.style.animationDelay = opts.animDelay + "ms";

    const upvoted = currentUser && r.upvotes.includes(currentUser);
    const bookmarked = currentUser && r.bookmarks.includes(currentUser);
    const isTrending = trendingScore(r) > 4 && daysAgo(r.uploadDate) <= 7;

    card.innerHTML = `
      ${isTrending ? `<span class="corner-tag">${ICONS.flame}Trending</span>` : ""}
      <div class="cat-card-topline">
        <span class="catalog-id">${catalogId(r)}</span>
        <span class="type-code" title="${escapeHtml(r.type)}">${TYPE_CODES[r.type] || "?"}</span>
      </div>
      <h3 class="cat-card-title">${escapeHtml(r.title)}</h3>
      <div class="cat-card-meta">${r.department} &middot; Sem ${r.semester} &middot; ${escapeHtml(r.subject)}</div>
      <p class="cat-card-desc">${escapeHtml(r.description || "No description provided.")}</p>
      <div class="cat-card-tags">
        ${r.tags.slice(0, 4).map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join("")}
      </div>
      <div class="cat-card-footer">
        <div class="uploader-line">
          <span class="uploader-name">${escapeHtml(r.uploader)}</span>
          <span class="uploader-date">${formatDate(r.uploadDate)}</span>
        </div>
        <div class="card-actions">
          <button class="icon-btn upvote ${upvoted ? "active" : ""}" data-action="upvote" title="Upvote">${ICONS.upvote}<span>${r.upvotes.length}</span></button>
          <button class="icon-btn bookmark ${bookmarked ? "active" : ""}" data-action="bookmark" title="Bookmark">${ICONS.bookmark}<span>${r.bookmarks.length}</span></button>
          <button class="icon-btn" data-action="comments" title="Comments">${ICONS.comment}<span>${r.comments.length}</span></button>
        </div>
      </div>
    `;

    card.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        e.stopPropagation();
        handleCardAction(r.id, actionBtn.dataset.action, actionBtn);
        return;
      }
      openDetail(r.id);
    });

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function handleCardAction(id, action, btn) {
    const r = resources.find((x) => x.id === id);
    if (!r) return;
    if (!currentUser) {
      openIdentityModal(() => handleCardAction(id, action, btn));
      return;
    }

    if (action === "upvote") {
      toggleInArray(r.upvotes, currentUser);
      btn.classList.add("stamped");
      setTimeout(() => btn.classList.remove("stamped"), 380);
    } else if (action === "bookmark") {
      toggleInArray(r.bookmarks, currentUser);
    } else if (action === "comments") {
      openDetail(r.id, { focusComments: true });
      return;
    }
    saveResources();
    render();
  }

  function toggleInArray(arr, val) {
    const i = arr.indexOf(val);
    if (i === -1) arr.push(val); else arr.splice(i, 1);
  }

  /* ------------------------------ rendering: tag cloud ------------------------------ */
  function renderTagCloud() {
    const counts = {};
    resources.forEach((r) => r.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 14);
    const el = $("#tagCloud");
    el.innerHTML = "";
    if (!tags.length) { el.innerHTML = `<span class="hint">No tags filed yet.</span>`; return; }
    tags.forEach((t) => {
      const b = document.createElement("button");
      b.className = "tag-pill" + (filters.tag === t ? " active" : "");
      b.textContent = `#${t} (${counts[t]})`;
      b.addEventListener("click", () => {
        filters.tag = filters.tag === t ? "" : t;
        render();
      });
      el.appendChild(b);
    });
  }

  /* ------------------------------ main render ------------------------------ */
  function render() {
    renderHeroStats();
    renderHeroStack();
    renderTagCloud();

    // trending shelf
    const trackEl = $("#trendingTrack");
    trackEl.innerHTML = "";
    const trending = getTrendingResources();
    if (!trending.length) {
      trackEl.innerHTML = `<p class="shelf-empty">Nothing trending yet — upvote a card to get it on the shelf.</p>`;
    } else {
      trending.forEach((r, i) => trackEl.appendChild(buildCard(r, { animDelay: i * 40 })));
    }

    // main grid
    const grid = $("#catalogGrid");
    grid.innerHTML = "";
    const list = getFilteredResources();
    $("#resultCount").textContent = `${list.length} card${list.length === 1 ? "" : "s"}`;
    $("#emptyState").hidden = list.length !== 0;
    grid.hidden = list.length === 0;
    list.forEach((r, i) => grid.appendChild(buildCard(r, { animDelay: Math.min(i, 10) * 35 })));

    // heading reflects active department filter
    $("#libraryHeading").textContent = filters.dept ? `${filters.dept} catalog` : "Full catalog";

    renderLedger();
    updateUserChip();
  }

  function renderLedger() {
    const names = Array.from(new Set(resources.map((r) => r.uploader)));
    const rows = names
      .map((name) => ({ name, ...reputationFor(name) }))
      .sort((a, b) => b.rep - a.rep);

    const body = $("#ledgerBody");
    body.innerHTML = "";
    rows.forEach((row, i) => {
      const badge = badgeFor(row.rep);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="rank-cell">#${i + 1}</td>
        <td>${escapeHtml(row.name)}</td>
        <td><span class="badge-chip ${badge.cls}">${badge.label}</span></td>
        <td>${row.uploads}</td>
        <td>${row.upvotesReceived}</td>
        <td>${row.rep}</td>
      `;
      body.appendChild(tr);
    });
  }

  function renderHeroStats() {
    const depts = new Set(resources.map((r) => r.department));
    const contributors = new Set(resources.map((r) => r.uploader));
    const thisWeek = resources.filter((r) => daysAgo(r.uploadDate) <= 7).length;
    $("#statResources").textContent = resources.length;
    $("#statContributors").textContent = contributors.size;
    $("#statDepts").textContent = depts.size;
    $("#statWeek").textContent = thisWeek;
  }

  function renderHeroStack() {
    const stack = $("#heroStack");
    if (!stack) return;
    const top = resources.slice().sort((a, b) => b.upvotes.length - a.upvotes.length).slice(0, 3);
    stack.innerHTML = top.map((r) => `
      <div class="mini-card">
        <span class="catalog-id">${catalogId(r)}</span>
        <div class="mini-card-title">${escapeHtml(r.title)}</div>
        <div class="mini-card-meta">${r.department} &middot; Sem ${r.semester} &middot; ${escapeHtml(r.subject)}</div>
        <div class="mini-card-foot">${ICONS.upvote}<span>${r.upvotes.length} upvotes</span></div>
      </div>
    `).join("");
  }

  function updateUserChip() {
    if (currentUser) {
      $("#userChipName").textContent = currentUser;
      $("#userDot").textContent = currentUser.trim().charAt(0).toUpperCase();
    } else {
      $("#userChipName").textContent = "Guest — set name";
      $("#userDot").textContent = "?";
    }
  }

  /* ------------------------------ detail modal ------------------------------ */
  function openDetail(id, opts) {
    opts = opts || {};
    const r = resources.find((x) => x.id === id);
    if (!r) return;
    activeDetailId = id;
    r.views += 1;
    saveResources();

    const modal = $("#detailModal");
    const upvoted = currentUser && r.upvotes.includes(currentUser);
    const bookmarked = currentUser && r.bookmarks.includes(currentUser);

    let previewHtml = "";
    if (r.fileData && r.fileType && r.fileType.startsWith("image/")) {
      previewHtml = `<div class="detail-preview"><img src="${r.fileData}" alt="${escapeHtml(r.title)}"/></div>`;
    } else if (r.fileData && r.fileType === "application/pdf") {
      previewHtml = `<div class="detail-preview"><iframe src="${r.fileData}"></iframe></div>`;
    } else if (r.fileData && r.fileType && r.fileType.startsWith("text/")) {
      previewHtml = `<div class="detail-preview"><iframe src="${r.fileData}"></iframe></div>`;
    } else if (r.link) {
      previewHtml = `<div class="detail-preview">${ICONS.link} <a href="${r.link}" target="_blank" rel="noopener">${escapeHtml(r.link)}</a></div>`;
    } else if (r.fileName) {
      previewHtml = `<div class="detail-preview">${ICONS.file} <strong>${escapeHtml(r.fileName)}</strong><br><span class="hint">Preview not available for this file type — download to view.</span></div>`;
    } else {
      previewHtml = `<div class="detail-preview hint">This is a sample catalog entry with no live file attached.</div>`;
    }

    modal.innerHTML = `
      <button class="modal-close" data-close="detailOverlay">&times;</button>
      <div class="detail-id">${catalogId(r)} &middot; filed ${formatDate(r.uploadDate)} &middot; ${ICONS.eye || ""} ${r.views} views</div>
      <h3 class="detail-title">${escapeHtml(r.title)}</h3>
      <div class="detail-meta-row">
        <span class="detail-meta-chip">${r.department}</span>
        <span class="detail-meta-chip">Semester ${r.semester}</span>
        <span class="detail-meta-chip">${escapeHtml(r.subject)}</span>
        <span class="detail-meta-chip">${TYPE_CODES[r.type] || "?"} &middot; ${r.type}</span>
      </div>
      <p class="detail-desc">${escapeHtml(r.description || "No description provided.")}</p>
      <div class="cat-card-tags" style="margin-bottom:16px;">
        ${r.tags.map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join("") || '<span class="hint">No tags</span>'}
      </div>
      ${previewHtml}
      <div class="detail-actions">
        <button class="btn icon-btn upvote ${upvoted ? "active" : ""}" data-action="upvote" style="padding:9px 16px;">${ICONS.upvote}<span>Upvote (${r.upvotes.length})</span></button>
        <button class="btn icon-btn bookmark ${bookmarked ? "active" : ""}" data-action="bookmark" style="padding:9px 16px;">${ICONS.bookmark}<span>Bookmark (${r.bookmarks.length})</span></button>
        ${r.fileData ? `<a class="btn btn-stamp" download="${escapeHtml(r.fileName || "resource")}" href="${r.fileData}">${ICONS.download}<span>Download</span></a>` : ""}
        ${r.link ? `<a class="btn btn-ghost" href="${r.link}" target="_blank" rel="noopener">${ICONS.link}<span>Open link</span></a>` : ""}
      </div>
      <div class="comments-block">
        <h4>Margin notes (${r.comments.length})</h4>
        <div class="comment-form">
          <input type="text" id="newCommentInput" placeholder="${currentUser ? "Add a note for other students..." : "Set your name to comment"}" />
          <button class="btn btn-stamp" id="postCommentBtn">Post</button>
        </div>
        <div class="comment-list" id="commentList">
          ${r.comments.length ? r.comments.map((c) => `
            <div class="comment-item">
              <div class="comment-meta">${escapeHtml(c.author)} &middot; ${formatDate(c.date)}</div>
              <div>${escapeHtml(c.text)}</div>
            </div>
          `).join("") : '<p class="no-comments">No notes in the margin yet — be the first to leave one.</p>'}
        </div>
      </div>
    `;

    $$('[data-action]', modal).forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!currentUser) {
          openIdentityModal(() => {
            const action = btn.dataset.action;
            if (action === "upvote") toggleInArray(r.upvotes, currentUser);
            if (action === "bookmark") toggleInArray(r.bookmarks, currentUser);
            saveResources();
            render();
            openDetail(id);
          });
          return;
        }
        const action = btn.dataset.action;
        if (action === "upvote") toggleInArray(r.upvotes, currentUser);
        if (action === "bookmark") toggleInArray(r.bookmarks, currentUser);
        saveResources();
        render();
        openDetail(id);
      });
    });

    $("#postCommentBtn", modal).addEventListener("click", () => postComment(r.id));
    $("#newCommentInput", modal).addEventListener("keydown", (e) => {
      if (e.key === "Enter") postComment(r.id);
    });
    // Wire the dynamically created close button in the detail modal
    $$('[data-close]', modal).forEach((btn) => {
      btn.addEventListener("click", () => closeOverlay(btn.dataset.close));
    });

    $("#detailOverlay").hidden = false;
    if (opts.focusComments) {
      setTimeout(() => $("#newCommentInput", modal)?.focus(), 60);
    }
  }

  function postComment(resourceId) {
    if (!currentUser) {
      openIdentityModal(() => postComment(resourceId));
      return;
    }
    const input = $("#newCommentInput");
    const text = input.value.trim();
    if (!text) return;
    const r = resources.find((x) => x.id === resourceId);
    r.comments.push({ id: uid(), author: currentUser, text, date: new Date().toISOString() });
    saveResources();
    render();
    openDetail(resourceId);
  }

  /* ------------------------------ upload flow + duplicate detection ------------------------------ */
  function fingerprint(data) {
    // lightweight duplicate signal: normalized title + dept + semester + subject,
    // OR same file name + approximate size
    return {
      titleKey: data.title.trim().toLowerCase().replace(/\s+/g, " "),
      fileKey: data.fileName ? `${data.fileName.toLowerCase()}::${data.fileSize}` : null,
      subjectKey: data.subject.trim().toLowerCase(),
      dept: data.department,
      sem: data.semester,
    };
  }

  function findDuplicate(data) {
    const fp = fingerprint(data);
    return resources.find((r) => {
      const sameFile = fp.fileKey && r.fileName && `${r.fileName.toLowerCase()}::${r.fileSize || 0}` === fp.fileKey;
      const sameTitleContext =
        r.title.trim().toLowerCase().replace(/\s+/g, " ") === fp.titleKey &&
        r.department === fp.dept &&
        String(r.semester) === String(fp.sem) &&
        r.subject.trim().toLowerCase() === fp.subjectKey;
      return sameFile || sameTitleContext;
    });
  }

  function resetUploadForm() {
    $("#uploadForm").reset();
    $("#dupWarning").hidden = true;
    $("#dropzone").classList.remove("has-file");
    $("#dropzoneText").textContent = "Drag a file here, or click to choose one";
    pendingUpload = null;
    if (currentUser) $("#f-uploader").value = currentUser;
  }

  function collectFormData() {
    return {
      title: $("#f-title").value.trim(),
      description: $("#f-desc").value.trim(),
      department: $("#f-dept").value,
      semester: Number($("#f-sem").value),
      subject: $("#f-subject").value.trim(),
      type: $("#f-type").value,
      tags: $("#f-tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      link: $("#f-link").value.trim(),
      uploader: $("#f-uploader").value.trim() || currentUser || "Anon",
    };
  }

  function finalizeUpload(formData, fileInfo) {
    const record = Object.assign({
      id: uid(),
      fileName: null, fileType: null, fileData: null, fileSize: 0,
      uploadDate: new Date().toISOString(),
      upvotes: [], bookmarks: [], views: 0, comments: [],
    }, formData, fileInfo || {});
    resources.unshift(record);
    saveResources();
    if (formData.uploader) saveUser(formData.uploader);
    closeOverlay("uploadOverlay");
    resetUploadForm();
    render();
    openDetail(record.id);
  }

  function submitUpload(e) {
    e.preventDefault();
    const formData = collectFormData();
    if (!formData.title || !formData.department || !formData.semester || !formData.subject) return;

    const fileInput = $("#f-file");
    const file = fileInput.files[0];

    const proceed = (fileInfo) => {
      const dupCheckData = Object.assign({}, formData, {
        fileName: fileInfo ? fileInfo.fileName : null,
        fileSize: fileInfo ? fileInfo.fileSize : 0,
      });
      const dup = pendingUpload && pendingUpload.confirmed ? null : findDuplicate(dupCheckData);
      if (dup) {
        pendingUpload = { formData, fileInfo, dupId: dup.id };
        $("#dupWarningText").textContent = `"${dup.title}" already exists for ${dup.department} · Sem ${dup.semester} · ${dup.subject}, uploaded by ${dup.uploader}. Check it isn't the same file before filing another card.`;
        $("#dupWarning").hidden = false;
        $("#dupWarning").scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      finalizeUpload(formData, fileInfo);
    };

    if (file) {
      if (file.size > MAX_FILE_BYTES) {
        alert("That file is over the 3MB demo limit for this local-storage prototype. Try a smaller file or paste a reference link instead.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        proceed({ fileName: file.name, fileType: file.type, fileData: reader.result, fileSize: file.size });
      };
      reader.readAsDataURL(file);
    } else {
      proceed(null);
    }
  }

  /* ------------------------------ modal plumbing ------------------------------ */
  function openOverlay(id) { $("#" + id).hidden = false; }
  function closeOverlay(id) { $("#" + id).hidden = true; }

  function wireModalClosers() {
    $$("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeOverlay(btn.dataset.close));
    });
    $$(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.hidden = true;
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $$(".modal-overlay").forEach((o) => (o.hidden = true));
    });
  }

  function openIdentityModal(callback) {
    pendingIdentityCallback = callback || null;
    $("#identityInput").value = currentUser || "";
    openOverlay("identityOverlay");
    setTimeout(() => $("#identityInput").focus(), 50);
  }

  /* ------------------------------ identity ------------------------------ */
  function wireIdentity() {
    $("#userChip").addEventListener("click", () => openIdentityModal());
    $("#saveIdentityBtn").addEventListener("click", () => {
      const name = $("#identityInput").value.trim();
      if (!name) return;
      saveUser(name);
      closeOverlay("identityOverlay");
      render();
      // Run the pending callback after identity is saved
      if (pendingIdentityCallback) {
        const cb = pendingIdentityCallback;
        pendingIdentityCallback = null;
        setTimeout(() => cb(), 60);
      }
    });
    $("#identityInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#saveIdentityBtn").click();
    });
  }

  /* ------------------------------ nav (view switching) ------------------------------ */
  function wireNav() {
    const links = $$(".nav-link");
    const sections = $$(".view-section");
    links.forEach((link) => {
      link.addEventListener("click", () => {
        links.forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        const view = link.dataset.view;

        sections.forEach((s) => s.classList.add("view-fading"));
        setTimeout(() => {
          $("#drawerSection").hidden = view === "contributors";
          $("#trendingSection").hidden = view === "contributors";
          $(".library-section").hidden = view === "contributors";
          $("#contributorsSection").hidden = view !== "contributors";
          sections.forEach((s) => s.classList.remove("view-fading"));
        }, 140);

        if (view === "trending") {
          filters.sort = "trending";
          $("#sortSelect").value = "trending";
          render();
          setTimeout(() => document.getElementById("trendingSection").scrollIntoView({ behavior: "smooth" }), 160);
        }
      });
    });
  }

  /* ------------------------------ filters wiring ------------------------------ */
  function wireFilters() {
    $("#semesterSelect").addEventListener("change", (e) => { filters.semester = e.target.value; render(); });
    $("#subjectInput").addEventListener("input", debounce((e) => { filters.subject = e.target.value; render(); }, 180));
    $("#searchInput").addEventListener("input", debounce((e) => { filters.search = e.target.value; render(); }, 180));
    $("#sortSelect").addEventListener("change", (e) => { filters.sort = e.target.value; render(); });
    $("#clearFiltersBtn").addEventListener("click", () => {
      filters = { dept: "", semester: "", subject: "", search: "", tag: "", sort: "newest" };
      $("#semesterSelect").value = ""; $("#subjectInput").value = ""; $("#searchInput").value = "";
      $("#sortSelect").value = "newest";
      $$(".dept-tab").forEach((t) => t.classList.toggle("active", t.dataset.dept === ""));
      render();
    });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ------------------------------ upload wiring ------------------------------ */
  function wireUpload() {
    $("#openUploadBtn").addEventListener("click", () => {
      if (!currentUser) {
        openIdentityModal(() => {
          resetUploadForm();
          openOverlay("uploadOverlay");
        });
        return;
      }
      resetUploadForm();
      openOverlay("uploadOverlay");
    });
    $("#emptyUploadBtn").addEventListener("click", () => $("#openUploadBtn").click());
    $("#uploadForm").addEventListener("submit", submitUpload);

    $("#viewDupBtn").addEventListener("click", () => {
      const dupId = pendingUpload && pendingUpload.dupId;
      closeOverlay("uploadOverlay");
      if (dupId) openDetail(dupId);
    });
    $("#dismissDupBtn").addEventListener("click", () => {
      if (pendingUpload) pendingUpload.confirmed = true;
      $("#dupWarning").hidden = true;
      finalizeUpload(pendingUpload.formData, pendingUpload.fileInfo);
    });

    const dz = $("#dropzone");
    const fileInput = $("#f-file");
    dz.addEventListener("click", () => fileInput.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("drag-over");
      if (e.dataTransfer.files[0]) {
        fileInput.files = e.dataTransfer.files;
        updateDropzoneLabel();
      }
    });
    fileInput.addEventListener("change", updateDropzoneLabel);

    function updateDropzoneLabel() {
      const f = fileInput.files[0];
      if (f) {
        $("#dropzoneText").innerHTML = `${ICONS.clip} ${escapeHtml(f.name)} (${(f.size / 1024).toFixed(0)} KB)`;
        dz.classList.add("has-file");
      }
    }
  }

  /* ------------------------------ hero + scroll chrome ------------------------------ */
  function wireHero() {
    $("#heroUploadBtn").addEventListener("click", () => $("#openUploadBtn").click());
    $("#heroBrowseBtn").addEventListener("click", () => {
      $("#drawerSection").scrollIntoView({ behavior: "smooth" });
    });

    const backBtn = $("#backToTop");
    window.addEventListener("scroll", () => {
      backBtn.hidden = window.scrollY < 480;
    }, { passive: true });
    backBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /* ------------------------------ init ------------------------------ */
  function init() {
    loadUser();
    loadResources();
    populateStaticFields();
    wireModalClosers();
    wireIdentity();
    wireNav();
    wireFilters();
    wireUpload();
    wireHero();
    if (!currentUser) {
      setTimeout(openIdentityModal, 400);
    }
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
