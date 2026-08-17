# Résumé Forge

A resume editor that runs entirely in your browser. Paste a job description,
see which of the JD's keywords already match your resume, one-click add the
ones you're missing, then download a clean PDF — no backend, no sign-up,
nothing ever leaves your browser.

## Features

- **Upload your CV** — upload an existing `.pdf`, `.docx`, or `.txt` resume.
  A local, pattern-based parser (no AI call, nothing leaves your browser) pulls
  out your name, contact info, summary, skills, experience, education, projects,
  and certifications. It shows you exactly what it found — **review it, then
  click "Commit to resume"** to apply it (or "Discard" to throw it away).
  Parsing is best-effort: resume formats vary a lot, so always skim the
  Edit-manually tab afterward and fix anything that's off.
- **Edit manually** — the same fields, always editable by hand, whether you
  started from an upload or from scratch.
- **JD analyzer** — paste a job description or upload a `.txt`/`.pdf` file. It
  pulls out the skills/keywords the JD cares about (from a built-in dictionary
  plus frequency analysis of repeated terms) and checks them against your resume.
- **Match meter** — a percentage score plus matched (teal) keyword chips.
- **Suggested changes → Commit** — a checklist of concrete changes ("Add
  'Tableau' to your skills", "Reorder your skills so JD matches show up
  first"). Uncheck anything you don't want, then click **Commit changes** to
  apply exactly what's checked to your actual resume data.
- **Live preview** — a professional, print-ready resume that updates as you type,
  with two layout options (Classic / Compact), and matched keywords bolded
  inside your bullet points.
- **Download PDF** — uses the browser's native print-to-PDF, so the result has
  real selectable text (not a screenshot) and looks the same in every browser.
- **Export / Import JSON** — save your resume data to a file and reload it
  later, on this device or any other.

## Running it locally

No build step, no dependencies to install. Just open `index.html` in a browser,
or serve the folder locally:

```bash
# from inside the resume-forge folder
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Hosting it on GitHub Pages

1. Create a new repository on GitHub (e.g. `resume-forge`).
2. Push these files to the repository root:

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Résumé Forge"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

3. On GitHub: go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, choose `main` and folder `/ (root)`, then **Save**.
6. After a minute or two, your site will be live at:

   ```
   https://<your-username>.github.io/<your-repo>/
   ```

That's it — no build pipeline, no server, no environment variables.

## File structure

```
resume-forge/
├── index.html        # page structure — form, JD analyzer, live preview
├── css/
│   └── styles.css    # all styling, including the print/PDF layout
├── js/
│   └── app.js         # form logic, keyword matching, PDF export, JSON import/export
└── README.md
```

## How the "download PDF" button works

It calls the browser's built-in `window.print()`, and a print stylesheet in
`styles.css` hides everything except the resume page. In the print dialog,
choose **Save as PDF** as the destination. This gives you a small, sharp,
text-searchable PDF — the same approach used by most real resume builders,
with no external service or paid library involved.

## Customizing

- **Colors / fonts** — all defined as CSS variables at the top of `css/styles.css`.
- **Keyword dictionary** — edit the `SKILL_DICTIONARY` array near the top of
  `js/app.js` to add keywords relevant to your field.
- **Resume sections** — the preview is built in the `renderPreview()` function
  in `js/app.js`; add or reorder sections there.
- **CV parsing rules** — `parseResumeText()` and `SECTION_HEADERS` in
  `js/app.js` control how an uploaded CV gets split into fields. If your resume
  uses section names it doesn't recognize (e.g. "Career History" instead of
  "Experience"), add them to `SECTION_HEADERS`.

## How CV parsing works (and its limits)

There's no backend and no AI call involved — it's a pattern-based parser that
runs entirely in your browser:

1. `.pdf` files are read with `pdf.js`, `.docx` with `mammoth.js` (both loaded
   from a CDN, purely to convert the file to plain text — nothing is uploaded).
2. The text is split into sections by looking for common headers (Summary,
   Skills, Experience, Education, etc.).
3. Inside each section, entries are split apart using blank lines and
   date-range patterns (e.g. "Jan 2021 – Present"), and bullet lines are
   detected by their leading `•`/`-`/`*`.

This works well for straightforward, text-based resumes, and less well for
heavily designed, multi-column, or image-based ones. That's why it's a
**review-then-commit** step, not a silent overwrite: check the results, edit
anything that's wrong, and only then commit.

## Privacy

Everything — your resume data, the CV you upload, the JD you paste, the PDF
export — happens locally in your browser. Nothing is sent to a server. `pdf.js`
and `mammoth.js` (loaded from a CDN) are only used to extract text from an
uploaded PDF/DOCX file; they don't upload the file anywhere.
