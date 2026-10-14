# Rovelink landing page

Static, self-contained public landing page for growing MSPs and infrastructure
teams, plus its reviewed demo media. The primary message is: **Know what's ready
to automate. Before you automate.**

Preview from the repository root with any static file server, for example:

```powershell
npx serve website
```

The primary product demo is the captioned 118-second, 1920×1080 public-alpha
walkthrough. Keep the MP4, poster, and WebVTT captions together under `assets/`
when deploying the page.

This directory is not included in the Express/Vite application build. Deploy it
as the standalone marketing site or copy it into the intended static hosting
target after reviewing the production URL and CTAs.

The page deliberately distinguishes current public-alpha capabilities from
experimental provider visibility and planned AWX/RHAAP enterprise adapters. Keep
the enforcement-boundary language intact when changing marketing copy.
