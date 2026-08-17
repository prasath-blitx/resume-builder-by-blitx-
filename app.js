/* ============================================================
   Résumé Forge
   Client-side resume editor + JD keyword matcher.
   No backend, no data leaves the browser.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     0. State
     --------------------------------------------------------- */
  const state = {
    name: "", title: "", email: "", phone: "", location: "", link1: "", link2: "",
    summary: "",
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certs: "",
    template: "classic"
  };

  let lastAnalysis = null; // { matched:[terms], missing:[terms] }
  let uidCounter = 1;
  const uid = () => "item-" + (uidCounter++);

  /* ---------------------------------------------------------
     1. Keyword dictionary + stopwords for JD analysis
     --------------------------------------------------------- */
  const SKILL_DICTIONARY = [
    // languages / dev
    "javascript","typescript","python","java","c++","c#","go","golang","rust","ruby","php","swift","kotlin",
    "html","css","sass","sql","nosql","graphql","rest api","node.js","react","vue","angular","next.js",
    "django","flask","spring boot","express","redux","tailwind","webpack",
    // data / ml
    "machine learning","deep learning","data analysis","data science","pandas","numpy","tensorflow","pytorch",
    "sql server","postgresql","mysql","mongodb","snowflake","bigquery","tableau","power bi","excel","looker",
    "etl","data pipeline","a/b testing","statistics",
    // cloud / devops
    "aws","azure","gcp","google cloud","docker","kubernetes","terraform","ci/cd","jenkins","linux","git","github",
    "microservices","devops","cloud infrastructure",
    // design
    "figma","sketch","adobe xd","photoshop","illustrator","ui design","ux design","user research","wireframing",
    "prototyping","design systems","accessibility","interaction design",
    // product / pm
    "product management","product strategy","roadmap","agile","scrum","kanban","jira","confluence","stakeholder management",
    "requirements gathering","user stories","okrs","kpis","go-to-market","product launch",
    // marketing / sales / biz
    "seo","sem","content marketing","social media marketing","email marketing","google analytics","crm","salesforce",
    "hubspot","lead generation","campaign management","brand strategy","copywriting","market research",
    "sales strategy","account management","business development","forecasting","budgeting","p&l",
    // ops / general professional
    "project management","program management","cross-functional","vendor management","process improvement",
    "supply chain","logistics","inventory management","quality assurance","risk management","compliance",
    "financial modeling","financial analysis","reporting","negotiation",
    // soft skills
    "communication","leadership","problem solving","collaboration","time management","critical thinking",
    "adaptability","mentoring","team management","presentation skills","customer service","conflict resolution",
    // certifications-ish
    "pmp","scrum master","six sigma","cpa","cfa","aws certified","itil"
  ];

  const STOPWORDS = new Set(("a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being," +
    "this,that,these,those,it,its,you,your,we,our,they,their,he,she,i,will,shall,can,could,should,would,may,might,must," +
    "have,has,had,do,does,did,not,no,yes,so,than,too,very,about,into,through,during,before,after,above,below,up,down,out,off,over,under," +
    "again,further,once,here,there,when,where,why,how,all,any,both,each,few,more,most,other,some,such,only,own,same," +
    "job,role,team,work,working,years,year,experience,experienced,ability,including,etc,strong,excellent,including," +
    "candidate,candidates,company,companies,including,new,plus,using,use,used,help,ensure,within,across,including").split(","));

  function normalize(s){ return s.toLowerCase().replace(/[’']/g,"'").trim(); }

  function extractKeywords(jdRaw) {
    const jd = normalize(jdRaw);
    const found = [];
    const seen = new Set();

    // 1) dictionary phrase matches (longest first so multi-word terms win over their substrings)
    const sortedDict = [...SKILL_DICTIONARY].sort((a,b)=>b.length-a.length);
    sortedDict.forEach(term => {
      const t = term.toLowerCase();
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])", "i");
      if (re.test(jd) && !seen.has(t)) {
        seen.add(t);
        found.push({ term, source: "dict" });
      }
    });

    // 2) frequency-based extraction for repeated capitalized-ish tokens not already captured
    const words = jd.replace(/[^a-z0-9+.#\s-]/g, " ").split(/\s+/).filter(Boolean);
    const freq = {};
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    const freqTerms = Object.entries(freq)
      .filter(([w,c]) => c >= 3 && !seen.has(w))
      .sort((a,b)=>b[1]-a[1])
      .slice(0, 10)
      .map(([w]) => ({ term: w, source: "freq" }));
    freqTerms.forEach(t => { if(!seen.has(t.term)){ seen.add(t.term); found.push(t);} });

    return found.slice(0, 26);
  }

  function extractExperienceYears(jdRaw){
    const m = jdRaw.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)/i);
    return m ? m[1] : null;
  }

  function resumeSearchableText(){
    const bulletsText = state.experience.flatMap(e => e.bullets || []).join(" ");
    const projText = state.projects.flatMap(p => (p.bullets || [])).join(" ") + " " + state.projects.map(p=>p.name).join(" ");
    return normalize([
      state.title, state.summary, state.skills.join(" "), bulletsText, projText, state.certs
    ].join(" "));
  }

  /* ---------------------------------------------------------
     2. Escaping / highlight helpers
     --------------------------------------------------------- */
  function esc(str) {
    return String(str || "").replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[c]));
  }

  function highlight(text, terms) {
    let safe = esc(text);
    if (!terms || !terms.length) return safe;
    const sorted = [...terms].sort((a,b)=>b.length-a.length);
    sorted.forEach(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("(" + escaped + ")", "ig");
      safe = safe.replace(re, "<mark>$1</mark>");
    });
    return safe;
  }

  /* ---------------------------------------------------------
     3. DOM refs
     --------------------------------------------------------- */
  const $ = id => document.getElementById(id);
  const preview = $("resume-preview");

  /* ---------------------------------------------------------
     4. Render: resume preview
     --------------------------------------------------------- */
  function renderPreview() {
    const matchedTerms = lastAnalysis ? lastAnalysis.matched.map(m => m.term) : [];
    const contactBits = [state.email, state.phone, state.location, state.link1, state.link2]
      .filter(Boolean).map(c => `<span>${esc(c)}</span>`).join("");

    const skillsHtml = state.skills.length
      ? `<div class="rz-skills">${state.skills.map(s => {
          const isMatch = matchedTerms.some(t => normalize(s).includes(t) || t.includes(normalize(s)));
          return `<span class="rz-skill${isMatch ? " matched" : ""}">${esc(s)}</span>`;
        }).join("")}</div>`
      : `<p class="rz-empty">Add skills in the form to the left.</p>`;

    const expHtml = state.experience.length
      ? state.experience.map(e => `
        <div class="rz-entry">
          <div class="rz-entry-head">
            <span class="rz-entry-role">${esc(e.role) || "Role"}${e.company ? ` <span class="rz-entry-org">— ${esc(e.company)}</span>` : ""}</span>
            <span class="rz-entry-dates">${esc(e.dates)}</span>
          </div>
          ${e.location ? `<div class="rz-entry-sub">${esc(e.location)}</div>` : ""}
          ${(e.bullets && e.bullets.length) ? `<ul class="rz-bullets">${e.bullets.map(b => `<li>${highlight(b, matchedTerms)}</li>`).join("")}</ul>` : ""}
        </div>`).join("")
      : `<p class="rz-empty">Add a role in the form to the left.</p>`;

    const eduHtml = state.education.length
      ? state.education.map(e => `
        <div class="rz-entry">
          <div class="rz-entry-head">
            <span class="rz-entry-role">${esc(e.degree) || "Degree"}${e.school ? ` <span class="rz-entry-org">— ${esc(e.school)}</span>` : ""}</span>
            <span class="rz-entry-dates">${esc(e.dates)}</span>
          </div>
          ${e.location ? `<div class="rz-entry-sub">${esc(e.location)}</div>` : ""}
        </div>`).join("")
      : `<p class="rz-empty">Add a school in the form to the left.</p>`;

    const projHtml = state.projects.length
      ? state.projects.map(p => `
        <div class="rz-entry">
          <div class="rz-entry-head">
            <span class="rz-entry-role">${esc(p.name) || "Project"}</span>
            ${p.dates ? `<span class="rz-entry-dates">${esc(p.dates)}</span>` : ""}
          </div>
          ${p.subtitle ? `<div class="rz-entry-sub">${esc(p.subtitle)}</div>` : ""}
          ${(p.bullets && p.bullets.length) ? `<ul class="rz-bullets">${p.bullets.map(b => `<li>${highlight(b, matchedTerms)}</li>`).join("")}</ul>` : ""}
        </div>`).join("")
      : "";

    preview.innerHTML = `
      <div class="rz-name">${esc(state.name) || "Your Name"}</div>
      ${state.title ? `<div class="rz-title">${esc(state.title)}</div>` : ""}
      ${contactBits ? `<div class="rz-contact">${contactBits}</div>` : ""}
      <div class="rz-hr"></div>

      ${state.summary ? `<div class="rz-section"><div class="rz-h">Summary</div><p class="rz-summary">${esc(state.summary)}</p></div>` : ""}

      <div class="rz-section"><div class="rz-h">Skills</div>${skillsHtml}</div>

      <div class="rz-section"><div class="rz-h">Experience</div>${expHtml}</div>

      <div class="rz-section"><div class="rz-h">Education</div>${eduHtml}</div>

      ${state.projects.length ? `<div class="rz-section"><div class="rz-h">Projects</div>${projHtml}</div>` : ""}

      ${state.certs ? `<div class="rz-section"><div class="rz-h">Certifications</div><p class="rz-summary">${esc(state.certs)}</p></div>` : ""}
    `;
  }

  /* ---------------------------------------------------------
     5. Render: skills chip row (editable, in the form)
     --------------------------------------------------------- */
  function renderSkillsChips() {
    const row = $("skills-chip-row");
    row.innerHTML = state.skills.map((s, i) => `
      <span class="chip">${esc(s)}<button type="button" class="chip-remove" data-i="${i}" aria-label="Remove ${esc(s)}">&times;</button></span>
    `).join("") || `<span class="chip-empty">No skills yet</span>`;
    row.querySelectorAll(".chip-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        state.skills.splice(Number(btn.dataset.i), 1);
        renderSkillsChips(); renderPreview();
      });
    });
  }

  /* ---------------------------------------------------------
     6. Repeaters: experience / education / projects
     --------------------------------------------------------- */
  function addExperience(data) {
    const item = Object.assign({ id: uid(), role: "", company: "", location: "", dates: "", bullets: [] }, data);
    state.experience.push(item);
    renderExperienceForm();
    renderPreview();
  }
  function addEducation(data) {
    const item = Object.assign({ id: uid(), degree: "", school: "", location: "", dates: "" }, data);
    state.education.push(item);
    renderEducationForm();
    renderPreview();
  }
  function addProject(data) {
    const item = Object.assign({ id: uid(), name: "", subtitle: "", dates: "", bullets: [] }, data);
    state.projects.push(item);
    renderProjectsForm();
    renderPreview();
  }

  function renderExperienceForm() {
    const wrap = $("experience-list");
    wrap.innerHTML = state.experience.map(item => `
      <div class="repeater-item" data-id="${item.id}">
        <div class="row-head"><button type="button" class="btn btn-danger btn-small" data-action="remove-exp">Remove</button></div>
        <div class="grid-2">
          <label>Role<input type="text" data-field="role" value="${esc(item.role)}" placeholder="Product Designer"></label>
          <label>Company<input type="text" data-field="company" value="${esc(item.company)}" placeholder="Acme Co."></label>
        </div>
        <div class="grid-2">
          <label>Location<input type="text" data-field="location" value="${esc(item.location)}" placeholder="Remote"></label>
          <label>Dates<input type="text" data-field="dates" value="${esc(item.dates)}" placeholder="Jan 2022 – Present"></label>
        </div>
        <label class="full">Bullet points <span class="bullet-hint">(one per line)</span>
          <textarea data-field="bullets">${esc((item.bullets||[]).join("\n"))}</textarea>
        </label>
      </div>
    `).join("") || `<p class="rz-empty">No roles added yet.</p>`;
    bindRepeaterEvents(wrap, state.experience, renderExperienceForm, "remove-exp");
  }

  function renderEducationForm() {
    const wrap = $("education-list");
    wrap.innerHTML = state.education.map(item => `
      <div class="repeater-item" data-id="${item.id}">
        <div class="row-head"><button type="button" class="btn btn-danger btn-small" data-action="remove-edu">Remove</button></div>
        <div class="grid-2">
          <label>Degree<input type="text" data-field="degree" value="${esc(item.degree)}" placeholder="B.S. Computer Science"></label>
          <label>School<input type="text" data-field="school" value="${esc(item.school)}" placeholder="University of Texas"></label>
        </div>
        <div class="grid-2">
          <label>Location<input type="text" data-field="location" value="${esc(item.location)}" placeholder="Austin, TX"></label>
          <label>Dates<input type="text" data-field="dates" value="${esc(item.dates)}" placeholder="2018 – 2022"></label>
        </div>
      </div>
    `).join("") || `<p class="rz-empty">No schools added yet.</p>`;
    bindRepeaterEvents(wrap, state.education, renderEducationForm, "remove-edu");
  }

  function renderProjectsForm() {
    const wrap = $("projects-list");
    wrap.innerHTML = state.projects.map(item => `
      <div class="repeater-item" data-id="${item.id}">
        <div class="row-head"><button type="button" class="btn btn-danger btn-small" data-action="remove-proj">Remove</button></div>
        <div class="grid-2">
          <label>Project name<input type="text" data-field="name" value="${esc(item.name)}" placeholder="Personal finance app"></label>
          <label>Dates<input type="text" data-field="dates" value="${esc(item.dates)}" placeholder="2023"></label>
        </div>
        <label class="full">Subtitle / tech used<input type="text" data-field="subtitle" value="${esc(item.subtitle)}" placeholder="React, Node.js, Postgres"></label>
        <label class="full">Bullet points <span class="bullet-hint">(one per line)</span>
          <textarea data-field="bullets">${esc((item.bullets||[]).join("\n"))}</textarea>
        </label>
      </div>
    `).join("");
    bindRepeaterEvents(wrap, state.projects, renderProjectsForm, "remove-proj");
  }

  function bindRepeaterEvents(wrap, arr, rerender, removeAction) {
    wrap.querySelectorAll(".repeater-item").forEach(itemEl => {
      const id = itemEl.dataset.id;
      const dataItem = arr.find(x => x.id === id);
      itemEl.querySelectorAll("[data-field]").forEach(fieldEl => {
        fieldEl.addEventListener("input", () => {
          const field = fieldEl.dataset.field;
          if (field === "bullets") {
            dataItem.bullets = fieldEl.value.split("\n").map(s => s.trim()).filter(Boolean);
          } else {
            dataItem[field] = fieldEl.value;
          }
          renderPreview();
        });
      });
      const removeBtn = itemEl.querySelector(`[data-action="${removeAction}"]`);
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          const idx = arr.findIndex(x => x.id === id);
          arr.splice(idx, 1);
          rerender();
          renderPreview();
        });
      }
    });
  }

  /* ---------------------------------------------------------
     7. Header / summary / skills-input / certs bindings
     --------------------------------------------------------- */
  function bindSimpleField(elId, stateKey) {
    $(elId).addEventListener("input", e => {
      state[stateKey] = e.target.value;
      renderPreview();
    });
  }
  [["f-name","name"],["f-title","title"],["f-email","email"],["f-phone","phone"],
   ["f-location","location"],["f-link1","link1"],["f-link2","link2"],
   ["f-summary","summary"],["f-certs","certs"]].forEach(([id,key]) => bindSimpleField(id,key));

  $("f-skill-input").addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = e.target.value.trim().replace(/,$/,"");
      if (val && !state.skills.some(s => s.toLowerCase() === val.toLowerCase())) {
        state.skills.push(val);
        renderSkillsChips();
        renderPreview();
      }
      e.target.value = "";
    }
  });

  $("btn-add-exp").addEventListener("click", () => addExperience({}));
  $("btn-add-edu").addEventListener("click", () => addEducation({}));
  $("btn-add-proj").addEventListener("click", () => addProject({}));

  /* ---------------------------------------------------------
     8. JD analysis
     --------------------------------------------------------- */
  $("btn-analyze").addEventListener("click", () => {
    const jdText = $("jd-text").value.trim();
    if (!jdText) { $("jd-text").focus(); return; }

    const keywords = extractKeywords(jdText);
    const resumeText = resumeSearchableText();

    const matched = [], missing = [];
    keywords.forEach(k => {
      const t = k.term.toLowerCase();
      (resumeText.includes(t) ? matched : missing).push(k);
    });
    lastAnalysis = { matched, missing };

    const pct = keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0;
    $("match-ring").style.setProperty("--pct", pct);
    $("match-pct").textContent = pct + "%";
    $("match-sub").textContent = keywords.length
      ? `${matched.length} of ${keywords.length} keywords found in your resume`
      : "Couldn't find distinct keywords in that JD — try pasting more of it.";

    const years = extractExperienceYears(jdText);
    const expNote = $("jd-experience-note");
    if (years) {
      expNote.textContent = `This JD asks for ${years}+ years of experience.`;
      expNote.classList.remove("hidden");
    } else {
      expNote.classList.add("hidden");
    }

    $("chips-matched").innerHTML = matched.length
      ? matched.map(k => `<span class="chip chip-matched">${esc(k.term)}</span>`).join("")
      : `<span class="chip-empty">No overlap yet</span>`;

    buildProposedChanges(missing, matched);

    $("jd-results").classList.remove("hidden");
    renderPreview();
  });

  function addSkillIfNew(term) {
    if (!state.skills.some(s => s.toLowerCase() === term.toLowerCase())) {
      state.skills.push(term);
      renderSkillsChips();
      renderPreview();
      return true;
    }
    return false;
  }

  /* ---- proposed changes: review checklist → commit ---- */
  let pendingChanges = [];

  function buildProposedChanges(missing, matched) {
    pendingChanges = missing.map(k => ({
      id: "add-" + k.term, type: "add-skill", term: k.term,
      label: `Add "${k.term}" to your skills`, checked: true
    }));
    if (matched.length && state.skills.length) {
      pendingChanges.push({
        id: "reorder", type: "reorder",
        label: "Reorder your skills so JD matches show up first", checked: true
      });
    }
    renderChangesList();
  }

  function renderChangesList() {
    const wrap = $("changes-list");
    $("commit-status").textContent = "";
    if (!pendingChanges.length) {
      wrap.innerHTML = `<span class="chip-empty">Nothing to change — your resume already covers this JD well.</span>`;
      $("btn-commit-changes").disabled = true;
      return;
    }
    $("btn-commit-changes").disabled = false;
    wrap.innerHTML = pendingChanges.map(c => `
      <div class="change-row">
        <input type="checkbox" id="chg-${c.id}" ${c.checked ? "checked" : ""} data-id="${c.id}">
        <label for="chg-${c.id}">${esc(c.label)}</label>
        <span class="change-tag">${c.type === "reorder" ? "reorder" : "add skill"}</span>
      </div>
    `).join("");
    wrap.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        const change = pendingChanges.find(c => c.id === cb.dataset.id);
        if (change) change.checked = cb.checked;
      });
    });
  }

  $("btn-commit-changes").addEventListener("click", () => {
    const toApply = pendingChanges.filter(c => c.checked);
    if (!toApply.length) return;

    let addedCount = 0;
    toApply.filter(c => c.type === "add-skill").forEach(c => { if (addSkillIfNew(c.term)) addedCount++; });

    const reorderChange = toApply.find(c => c.type === "reorder");
    if (reorderChange && lastAnalysis) {
      const matchedTerms = lastAnalysis.matched.map(m => m.term.toLowerCase());
      state.skills.sort((a, b) => {
        const aIn = matchedTerms.some(t => a.toLowerCase().includes(t) || t.includes(a.toLowerCase()));
        const bIn = matchedTerms.some(t => b.toLowerCase().includes(t) || t.includes(b.toLowerCase()));
        return (bIn ? 1 : 0) - (aIn ? 1 : 0);
      });
    }

    renderSkillsChips();
    renderPreview();

    // remove applied changes from the list, leave unchecked ones for later
    pendingChanges = pendingChanges.filter(c => !c.checked);
    renderChangesList();
    $("commit-status").textContent = `Committed ${toApply.length} change${toApply.length === 1 ? "" : "s"}.`;
  });

  /* ---------------------------------------------------------
     9. JD file upload (.txt/.md direct, .pdf via pdf.js)
     --------------------------------------------------------- */
  $("jd-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    $("jd-file-name").textContent = file.name;
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const buf = await file.arrayBuffer();
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
          let text = "";
          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            text += content.items.map(it => it.str).join(" ") + "\n";
          }
          $("jd-text").value = text.trim();
        } else {
          alert("PDF reader didn't load — please paste the job description text instead.");
        }
      } else {
        const text = await file.text();
        $("jd-text").value = text;
      }
    } catch (err) {
      alert("Couldn't read that file. Try pasting the job description text instead.");
    }
  });

  /* ---------------------------------------------------------
     9b. Form tabs: Upload CV / Edit manually
     --------------------------------------------------------- */
  $("form-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".form-tab-btn");
    if (!btn) return;
    document.querySelectorAll(".form-tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    $("tab-" + btn.dataset.tab).classList.add("active");
  });

  /* ---------------------------------------------------------
     9c. Upload CV → extract text → heuristic parse → review → commit
     --------------------------------------------------------- */
  const SECTION_HEADERS = {
    summary: ["summary", "profile", "professional summary", "objective", "about", "about me"],
    skills: ["skills", "technical skills", "core competencies", "competencies", "technologies", "skillset"],
    experience: ["experience", "work experience", "professional experience", "employment history", "employment"],
    education: ["education", "academic background", "education & training"],
    projects: ["projects", "personal projects", "selected projects"],
    certs: ["certifications", "certificates", "licenses", "licenses & certifications"]
  };
  const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219\-\*\u00B7]\s*/;
  const DATE_RE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{4})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|present|current|\d{4})/i;

  let stagedCv = null;

  $("cv-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    $("cv-file-name").textContent = file.name;
    setParseStatus("Reading and parsing your CV…", false, true);
    $("cv-parsed-summary").classList.add("hidden");
    try {
      const text = await extractTextFromFile(file);
      if (!text || text.trim().length < 20) {
        setParseStatus("Couldn't find readable text in that file. Try a different export, or use Edit manually instead.", true);
        return;
      }
      stagedCv = parseResumeText(text);
      renderParsedSummary(stagedCv);
      setParseStatus("", false, false, true);
      $("cv-parsed-summary").classList.remove("hidden");
    } catch (err) {
      setParseStatus("Something went wrong reading that file. Try a different format, or use Edit manually instead.", true);
    }
  });

  function setParseStatus(msg, isError, spinning) {
    const el = $("cv-parse-status");
    if (!msg) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.classList.toggle("is-error", !!isError);
    el.innerHTML = (spinning ? `<span class="spinner"></span>` : "") + esc(msg);
  }

  async function extractTextFromFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const buf = await file.arrayBuffer();
      if (!window.pdfjsLib) throw new Error("pdf.js not loaded");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        // getTextContent loses line breaks; approximate them from vertical position jumps
        let lastY = null, line = "";
        content.items.forEach(it => {
          const y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3) { text += line.trim() + "\n"; line = ""; }
          line += it.str + " ";
          lastY = y;
        });
        text += line.trim() + "\n\n";
      }
      return text;
    }
    if (name.endsWith(".docx")) {
      if (!window.mammoth) throw new Error("mammoth not loaded");
      const buf = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return result.value;
    }
    return await file.text();
  }

  function renderParsedSummary(data) {
    const rows = [
      ["Name", data.name],
      ["Email", data.email],
      ["Phone", data.phone],
      ["Location", data.location],
      ["Links", [data.link1, data.link2].filter(Boolean).join(", ")],
      ["Summary", data.summary ? data.summary.slice(0, 70) + (data.summary.length > 70 ? "…" : "") : ""],
      ["Skills", data.skills.length ? `${data.skills.length} found` : ""],
      ["Experience", data.experience.length ? `${data.experience.length} role${data.experience.length===1?"":"s"} found` : ""],
      ["Education", data.education.length ? `${data.education.length} entr${data.education.length===1?"y":"ies"} found` : ""],
      ["Projects", data.projects.length ? `${data.projects.length} found` : ""],
    ];
    $("cv-parsed-list").innerHTML = rows.map(([label, value]) => `
      <li><span class="pf-label">${esc(label)}</span>
      <span class="${value ? "pf-value" : "pf-missing"}">${value ? esc(value) : "not found — add manually"}</span></li>
    `).join("");
  }

  $("btn-discard-cv").addEventListener("click", () => {
    stagedCv = null;
    $("cv-parsed-summary").classList.add("hidden");
    $("cv-file").value = "";
    $("cv-file-name").textContent = "";
    setParseStatus("");
  });

  $("btn-commit-cv").addEventListener("click", () => {
    if (!stagedCv) return;
    // only overwrite fields we actually found something for
    ["name","title","email","phone","location","link1","link2","summary","certs"].forEach(k => {
      if (stagedCv[k]) state[k] = stagedCv[k];
    });
    if (stagedCv.skills.length) state.skills = stagedCv.skills;
    if (stagedCv.experience.length) state.experience = stagedCv.experience.map(x => Object.assign({ id: uid() }, x));
    if (stagedCv.education.length) state.education = stagedCv.education.map(x => Object.assign({ id: uid() }, x));
    if (stagedCv.projects.length) state.projects = stagedCv.projects.map(x => Object.assign({ id: uid() }, x));

    hydrateFormFromState();
    setParseStatus("Committed to your resume — switch to Edit manually to fine-tune.", false, false, true);

    // jump to the manual tab so they can review/correct immediately
    document.querySelectorAll(".form-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelector('.form-tab-btn[data-tab="manual"]').classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    $("tab-manual").classList.add("active");

    // if a JD was already pasted, re-run the analysis against the freshly committed resume
    if ($("jd-text").value.trim()) $("btn-analyze").click();
  });

  /* ---- heuristic résumé text parser (no backend / no AI call — pattern based) ---- */
  function parseResumeText(raw) {
    const lines = raw.replace(/\r/g, "").split("\n").map(l => l.trim());
    const nonEmpty = lines.filter(Boolean);

    const email = (raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [""])[0];
    const phone = (raw.match(/(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [""])[0];
    const linkedin = (raw.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,)]+/i) || [""])[0];
    const otherLinkMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.(?:com|io|dev|me|net|org|co)\/[^\s,)]*/gi) || [];
    const otherLink = otherLinkMatch.find(l => !/linkedin\.com/i.test(l) && !email.includes(l)) || "";

    // name: first short, non-contact line near the top
    let name = "";
    for (let i = 0; i < Math.min(nonEmpty.length, 6); i++) {
      const l = nonEmpty[i];
      if (!l.includes("@") && !DATE_RE.test(l) && l.length < 60 && !/linkedin|github|http/i.test(l)) {
        name = l.replace(/[,|]+$/,"").trim();
        break;
      }
    }
    // title: the next short line after the name, if it doesn't look like contact info
    let title = "";
    const nameIdx = nonEmpty.indexOf(name);
    if (nameIdx > -1 && nonEmpty[nameIdx + 1]) {
      const cand = nonEmpty[nameIdx + 1];
      if (!cand.includes("@") && !/linkedin|github|http|\d{3}/i.test(cand) && cand.length < 70) title = cand;
    }

    // location: a short "City, ST" style line near the top (space/tab only, so it
    // can never bleed across a newline into the previous line's last word)
    let location = "";
    const locMatch = raw.match(/\b([A-Z][a-zA-Z.]+(?:[ \t][A-Z][a-zA-Z.]+)?,[ \t]?[A-Z]{2})\b/);
    if (locMatch) location = locMatch[1];

    // section split
    const sections = { summary: [], skills: [], experience: [], education: [], projects: [], certs: [] };
    let current = null;
    lines.forEach(line => {
      const key = matchSectionHeader(line);
      if (key) { current = key; return; }
      if (current) sections[current].push(line);
    });

    const summary = sections.summary.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

    const skills = sections.skills.join("\n")
      .split(/[,•\u2022\n;|]/).map(s => s.replace(BULLET_RE, "").trim())
      .filter(s => s && s.length < 40 && s.length > 1);

    const experience = splitIntoEntries(sections.experience).map(entry => {
      const { left, right, dates } = splitEntryHeader(entry.header, entry.dateLine);
      return { role: left, company: right, location: entry.sub || "", dates, bullets: entry.bullets };
    });

    const education = splitIntoEntries(sections.education).map(entry => {
      const { left, right, dates } = splitEntryHeader(entry.header, entry.dateLine);
      return { degree: left, school: right, location: entry.sub || "", dates };
    });

    const projects = splitIntoEntries(sections.projects).map(entry => {
      const { left, dates } = splitEntryHeader(entry.header, entry.dateLine);
      return { name: left, subtitle: entry.sub || "", dates, bullets: entry.bullets };
    });

    const certs = sections.certs.filter(Boolean).join(", ").replace(/\s*,\s*/g, ", ").replace(/,\s*$/, "").trim();

    return {
      name, title, email, phone, location,
      link1: linkedin, link2: otherLink,
      summary, skills, experience, education, projects, certs
    };
  }

  function matchSectionHeader(line) {
    const norm = line.toLowerCase().replace(/[:•\-–]+$/, "").trim();
    if (!norm || norm.length > 40) return null;
    for (const [key, variants] of Object.entries(SECTION_HEADERS)) {
      if (variants.includes(norm)) return key;
    }
    return null;
  }

  // group a section's lines into entries, splitting on blank lines first, falling back to date-range lines
  function splitIntoEntries(sectionLines) {
    const blocks = [];
    let block = [];
    sectionLines.forEach(line => {
      if (!line) { if (block.length) { blocks.push(block); block = []; } }
      else block.push(line);
    });
    if (block.length) blocks.push(block);

    let groups = blocks;
    if (blocks.length <= 1) {
      // only worth a date-based fallback split if the block has multiple standalone
      // date-range lines (i.e. several entries jammed together with no blank lines) —
      // otherwise a single incidental date line (e.g. an education entry's own date
      // range) would incorrectly get split off as its own "entry".
      const flat = blocks[0] || [];
      const dateLineCount = flat.filter(l => DATE_RE.test(l) && l.length < 40).length;
      if (dateLineCount >= 2) {
        groups = [];
        let g = [];
        flat.forEach(line => {
          if (DATE_RE.test(line) && line.length < 40 && g.length) { groups.push(g); g = [line]; }
          else g.push(line);
        });
        if (g.length) groups.push(g);
      } else {
        groups = blocks;
      }
    }

    return groups.filter(g => g.length).map(g => {
      const header = g[0];
      const body = g.slice(1);
      const bullets = [];
      let sub = "", dateLine = "";
      body.forEach(line => {
        if (BULLET_RE.test(line)) { bullets.push(line.replace(BULLET_RE, "").trim()); return; }
        if (!dateLine && DATE_RE.test(line) && line.length < 40) { dateLine = line; return; }
        if (!sub && line.length < 70) { sub = line; return; }
        if (line) bullets.push(line);
      });
      return { header, sub, bullets, dateLine };
    });
  }

  function splitEntryHeader(header, fallbackDate) {
    let dates = "";
    const dm = header.match(DATE_RE);
    let rest = header;
    if (dm) { dates = dm[0]; rest = (header.slice(0, dm.index) + " " + header.slice(dm.index + dm[0].length)).trim(); }
    else if (fallbackDate) { dates = fallbackDate; }
    rest = rest.replace(/[,\s|–—-]+$/, "").replace(/^[,\s|–—-]+/, "").trim();
    const parts = rest.split(/\s+—\s+|\s+–\s+|\s+-\s+|\s+\|\s+|,\s+| at /i).map(s => s.trim()).filter(Boolean);
    return { left: parts[0] || rest, right: parts[1] || "", dates };
  }

  /* ---------------------------------------------------------
     10. Template switch
     --------------------------------------------------------- */
  $("template-switch").addEventListener("click", e => {
    const btn = e.target.closest(".tpl-btn");
    if (!btn) return;
    document.querySelectorAll(".tpl-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.template = btn.dataset.template;
    preview.className = "resume-page tpl-" + state.template;
  });

  /* ---------------------------------------------------------
     11. Export / Import JSON
     --------------------------------------------------------- */
  $("btn-export-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (state.name ? state.name.replace(/\s+/g, "_") : "resume") + "_data.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("import-json").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      Object.assign(state, data);
      state.skills = state.skills || [];
      state.experience = (state.experience || []).map(x => Object.assign({ id: uid() }, x));
      state.education = (state.education || []).map(x => Object.assign({ id: uid() }, x));
      state.projects = (state.projects || []).map(x => Object.assign({ id: uid() }, x));
      hydrateFormFromState();
    } catch (err) {
      alert("That file doesn't look like a valid Résumé Forge JSON export.");
    }
  });

  function hydrateFormFromState() {
    $("f-name").value = state.name || "";
    $("f-title").value = state.title || "";
    $("f-email").value = state.email || "";
    $("f-phone").value = state.phone || "";
    $("f-location").value = state.location || "";
    $("f-link1").value = state.link1 || "";
    $("f-link2").value = state.link2 || "";
    $("f-summary").value = state.summary || "";
    $("f-certs").value = state.certs || "";
    renderSkillsChips();
    renderExperienceForm();
    renderEducationForm();
    renderProjectsForm();
    renderPreview();
  }

  /* ---------------------------------------------------------
     12. Sample data
     --------------------------------------------------------- */
  $("btn-load-sample").addEventListener("click", () => {
    Object.assign(state, {
      name: "Jordan Alvarez",
      title: "Senior Product Designer",
      email: "jordan.alvarez@email.com",
      phone: "+1 512 555 0148",
      location: "Austin, TX",
      link1: "linkedin.com/in/jordanalvarez",
      link2: "jordanalvarez.design",
      summary: "Product designer with 7 years of experience shipping design systems and 0-to-1 products for B2B SaaS teams. Known for pairing fast prototyping with rigorous user research to cut decision time in half.",
      skills: ["Figma", "Design Systems", "User Research", "Prototyping", "UX Design", "Accessibility", "Cross-functional"],
      certs: "",
      experience: [
        { id: uid(), role: "Senior Product Designer", company: "Northwind Software", location: "Austin, TX (Remote)", dates: "Mar 2022 – Present",
          bullets: [
            "Led the redesign of the core dashboard, increasing weekly active usage by 34%.",
            "Built and maintained a component-based design system adopted across 5 product teams.",
            "Ran user research sessions with 40+ customers to validate the new onboarding flow."
          ]},
        { id: uid(), role: "Product Designer", company: "Fieldnote Labs", location: "Austin, TX", dates: "Jul 2019 – Feb 2022",
          bullets: [
            "Designed and shipped the mobile app redesign, improving App Store rating from 3.6 to 4.5.",
            "Partnered with engineering and product management to launch 3 major feature releases."
          ]}
      ],
      education: [
        { id: uid(), degree: "B.F.A. Graphic Design", school: "University of Texas at Austin", location: "Austin, TX", dates: "2015 – 2019" }
      ],
      projects: [
        { id: uid(), name: "Open-source icon kit", subtitle: "Figma, SVG", dates: "2023",
          bullets: ["Published a 300-icon open-source set used by 1,200+ Figma community files."] }
      ]
    });
    hydrateFormFromState();
  });

  /* ---------------------------------------------------------
     13. Download PDF (native browser print — crisp, selectable text)
     --------------------------------------------------------- */
  $("btn-download-pdf").addEventListener("click", () => {
    window.print();
  });

  /* ---------------------------------------------------------
     14. Init
     --------------------------------------------------------- */
  renderSkillsChips();
  renderExperienceForm();
  renderEducationForm();
  renderProjectsForm();
  renderPreview();

})();
