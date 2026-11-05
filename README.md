# Descendants of Abraham

Interactive genealogical tree and geographic atlas mapping Abraham (`Avraham` / `Ibrahim`), his three maternal households (Hagar, Sarah, and Keturah), and 110 descendants, tribes, oasis kingdoms, and enduring peoples across Arabia, the Near East, and the Mediterranean traced to them in biblical texts, Neo-Assyrian and Ancient North Arabian inscriptions, classical historiography, and Arab genealogical tradition (`'Ilm al-Ansab`).

**Live GitHub Pages site:** [https://walljmdotcom.github.io/abraham-descendants/](https://walljmdotcom.github.io/abraham-descendants/)

## Lineages, Convergence, and Geography

- **Hagar and Ishmael (`public/data/ishmael-line.json`)**: Ishmael's twelve tribal princes (`Nebaioth`, `Kedar`, `Adbeel`, `Mibsam`, `Mishma`, `Dumah`, `Massa`, `Hadad`, `Tema`, `Jetur`, `Naphish`, `Kedemah`), the Transjordanian `Hagrites` and `Nodab`, `Qedarites`, `Ituraeans`, `Nabataeans`, `Roman Arabia Petraea`, and the northern Arabian `Adnan` -> `Ma'add` -> `Nizar` confederations (`Mudar`, `Quraysh & Kinanah`, `Banu Hashim` including the Hashemites, `Banu Umayyah`, `Qays 'Aylan`, `Hilal & Sulaym`, `Tamim & Hudhayl`, `Rabi'ah`, `Bakr & Taghlib`, `Diyar Rabi'ah & Hamdanids`, `'Abd al-Qays, Hanifah & 'Anazah`, `'Anazah & Modern Arabian Ruling Houses`, `Iyad & Anmar`, and `Quda'ah` -> `Juhaynah, Bali & Kalb`).
- **Keturah (`public/data/keturah-line.json`)**: Abraham's six eastern sons (`Zimran`, `Jokshan`, `Medan`, `Midian`, `Ishbak`, `Shuah`), Jokshan's northern `Sheba` and `Dedan` branches (`Asshurim`, `Letushim`, `Leummim`, and the `Kingdoms of Dadan & Lihyan` at Al-'Ula), Midian's five clans (`Ephah/Hayapa`, `Epher`, `Hanoch`, `Abida`, `Eldaah`), the `Midianite Confederation`, `Kenites & Rechabites`, and Middle Euphrates `Shuhites`.
- **Sarah -> Isaac -> Esau (`public/data/esau-line.json`)**: Esau's five sons in Canaan and Seir (`Eliphaz`, `Reuel`, `Jeush`, `Jaalam`, `Korah`), the Edomite clans (`Teman`, `Omar`, `Zepho`, `Gatam`, `Kenaz`, `Amalek`, `Nahath`, `Zerah`, `Shammah`, `Mizzah`), the `Kingdom of Edom (Udumu)`, `Idumaea & the Herodian Dynasty`, `Kenizzites & Calebites`, and `Amalekites`.
- **Sarah -> Isaac -> Jacob (`public/data/jacob-line.json`)**: Jacob's twelve sons and daughter `Dinah`, Joseph's tribal sons `Manasseh` and `Ephraim`, `Levites & Kohanim`, the `Northern Kingdom of Israel (Bit-Humri)` continuing in the living `Samaritans` at Mount Gerizim and Holon, the `Royal House of David`, and `Kingdom of Judah, Yehud & Second Temple Judaea` continuing through `Mizrahi, Babylonian, Persian & Yemeni Jewry`, `Sephardi & Maghrebi Jewry`, and `Ashkenazi Jewry` to reconverge in `Modern Israel & Contemporary World Jewry`.
- **Dotted Convergence Curves and Geographic Atlas (`public/data/catalog.json`, `public/data/near-east-geo.json`, `public/js/geo-map.js`)**: Every card carries an outcome pill distinguishing continuing stems, living lineages, clans that coalesced into larger polities, absorbed groups, and lineages unattested after antiquity. Dotted directional curves trace historical absorptions, coalescences, and cross-branch marriages beneath the tree cards, while the `Tree` / `Split: Tree + Map` / `Map` switcher and per-entry homeland locator map plot territories, archaeological sites, and caravan routes across Natural Earth coastlines, lakes, and rivers.

## Local Viewing, JSON Data, and GitHub Pages

All canonical tree entries, cross-links, and geographic vector layers live as JSON under `public/data/`.

- **Local offline file (`index.html`)**: Open the repo-root `index.html` directly in a browser (`open index.html` on macOS). Browsers block `fetch()` against local `.json` files on `file://` URLs, so `scripts/build-local-html.mjs` generates `index.html` from `public/index.html` and embeds the `public/data/*.json` catalog and map geometry while referencing `public/css/` and `public/js/` in place.
- **GitHub Pages and local HTTP (`public/index.html`)**: Published from `main` via `.github/workflows/deploy-pages.yml` to [https://walljmdotcom.github.io/abraham-descendants/](https://walljmdotcom.github.io/abraham-descendants/). GitHub Pages deploys `public/`, where `public/js/tree-app.js` loads `public/data/catalog.json`, `public/data/near-east-geo.json`, and the five lineage JSON files via `fetch()`. To run the `fetch()` build locally over HTTP:

```sh
python3 -m http.server 8080 -d public
```

After editing `public/data/*.json` or `public/index.html`, regenerate the local `index.html` wrapper and run the verification suite (`--offline` skips live source URL checks):

```sh
node scripts/build-local-html.mjs
node test/verify-tree.mjs
```
