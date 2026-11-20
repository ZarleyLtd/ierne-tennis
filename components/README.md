# Components

The site has no build step, so shared HTML is copied into every root page by hand.

| File | Where it goes |
|---|---|
| `header.html` | Straight after `<body …>`. Logo (the Ierne crest, which is also the home button), **?** help button and the full menu. |
| `footer.html` | After `</main>`. Footer links, credit and back-to-top. |
| `scripts.html` | Just before `</body>`. Theme menu script and `nav-active.js`. |
| `nav.html` | A pointer only; the menu lives inside `header.html`. |

The Standings and Ladder menu items are shown or hidden at runtime by `assets/js/utils/nav-competition.js`, depending on the competition on show. Never hard-code an `active` class; `nav-active.js` sets it.

## Changing the header or footer

1. Edit the file in `components/`.
2. Copy the same change into every root `.html` page: `index`, `standings`, `ladder`, `fixtures`, `results`, `rules`, `404` and the `admin-*` pages.

Each page's `<head>` lists its scripts in the order config → utils → components → pages → `main.js`.
