# pages/ — the ReadWrite landing site

This folder is the source for the project's GitHub Pages site, published live at:

**<https://everettjf.github.io/ReadWrite/>**

It's a static, single-page site — no build step, no framework:

```
pages/
├── index.html      # the landing page
├── styles.css      # all styling (editorial "ink on paper" theme, light + dark)
├── .nojekyll       # skip Jekyll processing — serve files as-is
└── assets/
    ├── icon.png    # app icon / logo
    └── favicon.png
```

## How it's deployed

`.github/workflows/pages.yml` uploads this folder as a Pages artifact and deploys it
on every push to `main` that touches `pages/**`. The repo's Pages source is set to
**GitHub Actions** (not the legacy branch/folder source), so no other configuration is
needed.

## Editing locally

Just open `index.html` in a browser, or serve the folder:

```bash
cd pages && python3 -m http.server 8000   # then visit http://localhost:8000
```

The app mockup in the hero is an inline SVG, so the page is self-contained and doesn't
depend on screenshots. If real screenshots are added later (drop them in `assets/`),
swap the `<svg>` in `index.html` for an `<img>`.
