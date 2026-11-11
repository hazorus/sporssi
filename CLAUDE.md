# Spörssi – ohjeet kehitykseen

## Versiointi

- Versionumero ja muutoshistoria ovat tiedostossa `web/src/changelog.js` (uusin ensin). Sivun
  alalaidan versionumero ja muutoshistoriasivu (`web/muutokset.html`) luetaan siitä.
- **Päivitä versio jokaisen commitin yhteydessä**, jossa muuttuu sovelluksen toiminta tai ulkoasu:
  - uusi ominaisuus tai näkyvä muutos → seuraava minor-versio (1.1 → 1.2)
  - pelkkä korjaus → patch-versio (1.2 → 1.2.1)
  - lisää uusi merkintä `CHANGELOG`-listan alkuun (versio, päivämäärä, muutokset suomeksi
    käyttäjän näkökulmasta) ja päivitä `web/package.json`-tiedoston `version` vastaavaksi
    (semver, esim. 1.2.0).
- Pelkät dokumentaatio- tai testimuutokset eivät vaadi versionnostoa.

## Testit

```bash
.venv/bin/pytest server/tests
```

```bash
cd web && npm test && npm run build
```
