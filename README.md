# Sporssi – pörssisähkö ja kodin laitteiden käyttökustannukset

Web-sovellus, joka näyttää Suomen pörssisähkön hinnan tunneittain tai varteittain ja laskee
kodinkoneiden ja sähkölämmityksen kulutuksen ja kustannuksen kulloisellakin hinnalla.

- **Hintakaavio ja -taulukko**: kuluva vuorokausi, edellinen ja seuraava päivä (huomisen hinnat
  julkaistaan n. klo 13.45). Valinta tunti / 15 min.
- **Kiinteä asteikko**: pystyakseli on oletuksena aina sama (−5…40 c/kWh), jotta päiviä voi verrata
  silmämääräisesti. Asteikon ylittävät pylväät leikataan ja niihin merkitään hinta. Automaattisen
  skaalauksen voi valita asetuksista.
- **Värit**: palvelin laskee tietokannan historiasta viimeisen 12 kk aikapainotetun keskihinnan ja
  keskihajonnan. Kaavion **vihreä** alue = keskihinta ± hajonta, **keltainen** = yli vihreän
  alueen, **punainen** = yli keskihinta + 2 × hajonta. Kertoimet voi muuttaa asetuksista.
- **Laitteet**: 29 valmista laitetta (pesukoneet, kuivausrummut, astianpesukone, vedenkeitin,
  uuni, liesi, mikro, jääkaappi, pakastin, saunan kiuas, lattialämmitys, lämminvesivaraaja,
  sähköauton lataus jne.). Jokaisella on oletusenergia, oletuskäyttöaika ja lähteet. Laitteen
  aloitusajan, keston ja kulutuksen voi muuttaa. Sovellus näyttää halvimman aloitusajan ja säästön.
- **Omat laitteet**: teho (kW) tai energia per kerta (kWh) ja käyttöaika. Tallentuvat selaimeen.
- **Sähkölämmitys**: suora sähkö, lattialämmitys, varaava, ilmalämpöpumppu, ilma-vesilämpöpumppu ja
  maalämpö. Tarve arvioidaan Ilmatieteen laitoksen havainnoista ja ennusteesta (ks. alla).
- **Kulutus- ja kustannustaulukko** tunneittain tai varteittain: kunkin laitteen kWh ja € sekä summat.
- Hinnaksi voi valita pelkän spot-hinnan (ALV 0) tai kuluttajahinnan (ALV, marginaali, siirto, sähkövero).

## Rakenne

```
server/            Flask-rajapinta (Python 3.11+), SQLite
  sporssi/
    app.py         /api/prices, /api/stats, /api/devices, /api/heating, /api/heating/options, /api/weather
    prices.py      hintojen tallennus, vuorokauden 15 min jaksot, 12 kk tilastot
    heating.py     säätiedot ja lämmityksen arvio
    sources/       entsoe.py (ENTSO-E), sahkotin.py (vapaa lähde), fmi.py (Ilmatieteen laitos)
    cli.py         update / backfill / load-reference / stats
  wsgi.py          gunicorn- tai mod_wsgi-sisääntulo
  tests/
web/               Svelte 5 + Vite + Apache ECharts -käyttöliittymä (staattinen)
  public/config.js rajapinnan osoite, muokattavissa palvelimella ilman uudelleenkääntämistä
data/reference_data.json   laitteiden, lämmitysjärjestelmien, rakennusten ja paikkakuntien viitetiedot
scripts/update_reference_data.py   lataa viitetiedot tietokantaan
deploy/            Apache-, systemd- ja cron-esimerkit
```

Kaaviokirjastona on **Apache ECharts**. Se piirtää vaakasuuntaiset värialueet (`markArea`),
keskihinnan ja nykyhetken viivat, pylväskohtaiset värit ja leikkauksen kiinteällä asteikolla
ilman lisäosia. Mukaan otetaan vain tarvittavat moduulit.

## Tietokanta

SQLite (`SPORSSI_DB`, oletus `var/sporssi.sqlite3`). Mitään ei poisteta:

| taulu | sisältö |
|---|---|
| `prices` | kaikki haetut hinnat (alue, alku UTC, resoluutio 15/60 min, €/MWh ALV 0, lähde). Ennen 1.10.2025 tuntihinnat. |
| `weather` | lämpötilahavainnot (`obs`) ja viimeisin ennuste (`fc`) paikkakunnittain |
| `devices`, `heating_systems`, `building_eras`, `locations` | viitetiedot, eivät päivity automaattisesti |
| `fetch_log` | hakujen loki |

## Tietolähteet

**Hinnat.** Jos `ENTSOE_TOKEN` on asetettu, käytetään ENTSO-E Transparency Platformia (Day-ahead
prices, A44, alue `10YFI-1--------U`). Muuten käytetään vapaata **sahkotin.fi**-rajapintaa, joka
välittää samat Nord Poolin hinnat (€/MWh, ALV 0). Lähteen voi pakottaa:
`SPORSSI_PRICE_SOURCE=entsoe|sahkotin`.

### ENTSO-E-tokenin hankkiminen

1. Rekisteröidy osoitteessa <https://transparency.entsoe.eu/> (Login → Register). Vahvista sähköposti.
2. Lähetä sähköposti osoitteeseen **transparency@entsoe.eu**. Otsikoksi "Restful API access" ja
   viestiin tilisi sähköpostiosoite. Käsittely kestää yleensä muutaman arkipäivän.
3. Kun pääsy on myönnetty, kirjaudu ja avaa **My Account Settings → Web API Security Token →
   Generate a new token**.
4. Aseta token palvelimelle, esim. `/etc/sporssi.env`: `ENTSOE_TOKEN=...`. Käynnistä palvelu
   uudelleen. Lähde vaihtuu automaattisesti, eikä vanhoja tietoja tarvitse hakea uudelleen.

**Sää.** Ilmatieteen laitoksen avoin data (opendata.fmi.fi, ei avainta):
- havainnot `fmi::observations::weather::simple`
- ennuste `fmi::forecast::edited::weather::scandinavia::point::simple`, n. 10 vrk

**Laitteiden kulutustiedot** (`data/reference_data.json`, tarkistettu 4.11.2026). Jokaisella rivillä
on lähteet, ja ne näkyvät käyttöliittymässä laitteen kohdalla.
- **Motiva** julkaisee lähinnä esimerkkikotien vuosierittelyt (esim. kiuas 1 000 kWh/v,
  lämmin vesi 3 670 kWh/v 4 hengen talossa). Niitä on käytetty ristiintarkistukseen ja jatkuville
  kulutuksille.
- **EPREL / EU-energiamerkki**: eco-ohjelmien kulutukset (pesukoneet, astianpesukoneet,
  kuivausrummut) Topten.eu:n EPREL-pohjaisista listauksista. EPRELin oma rajapinta vaatii avaimen.
- **Helen**, "Sähkölaitteiden kulutuslukuja": käyttökertakohtaiset luvut, joita Motivalla ei ole.
- Lämmitystarveluvut: Ilmatieteen laitos, S17, 1991–2020.
- Lämpöpumppujen vuosilämpökertoimet: VTT T164. COP-käyrät lämpötilan funktiona ovat arvioita,
  jotka on sovitettu Motivan kuvauksiin.

Arviot (ei suoraa lähdettä) on merkitty lähteeksi "Arvio". Päivitä arvot muokkaamalla JSONia ja aja:

```bash
SPORSSI_DB=/var/lib/sporssi/sporssi.sqlite3 python3 scripts/update_reference_data.py
```

## Lämmityksen arvio

Rakennuksen lämpöhäviökerroin lasketaan vuotuisesta lämmitystarpeesta ja paikkakunnan
lämmitystarveluvusta. Lämmitystarve on joko pinta-ala × rakennusikäluokan kWh/m², tai käyttäjän
oma luku esimerkiksi energiatodistuksesta.

```
H = vuotuinen tarve / (S17 · 24)                 kWh/(K·h)
tunnin lämpö = H · max(0, 17 °C + (sisälämpö − 21) − T_ulko)
sähkö = lämpö · kattavuus / COP(T_ulko) + lämpö · (1 − kattavuus)
```

Ilmalämpöpumpun kattavuus on oletuksena 50 % (Motiva: 30–60 %), ja loput lasketaan suoralla
sähköllä. Pakkasrajan (−25 °C) alapuolella lämpöpumpun COP on 1.

## Kehitys

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cd server
../.venv/bin/python -m sporssi.cli backfill --days 400   # vuoden historia tilastoja varten
../.venv/bin/flask --app wsgi run -p 5000
```

Toisessa ikkunassa (Vite välittää `/api`-kutsut porttiin 5000):

```bash
cd web && npm install && npm run dev
```

Testit:

```bash
.venv/bin/pytest server/tests
```

```bash
cd web && npm test
```

## Asennus Apache-palvelimelle

1. Kopioi repo esim. hakemistoon `/opt/sporssi`. Luo virtuaaliympäristö ja asenna `requirements.txt`.
2. Luo `/etc/sporssi.env` mallista `deploy/sporssi.env.example`. Anna `www-data`-käyttäjälle
   kirjoitusoikeus tietokannan hakemistoon, esim. `/var/lib/sporssi`.
3. Hae historia kerran: `python -m sporssi.cli backfill --days 400` (hakemistossa `server/`).
4. Käynnistä rajapinta: `deploy/sporssi.service` (gunicorn, 127.0.0.1:8050). Vaihtoehtoisesti
   `deploy/apache-sporssi-wsgi.conf` (mod_wsgi).
5. Ajasta haku: `deploy/crontab.example`. Rajapinta hakee puuttuvat tiedot myös pyynnön
   yhteydessä (`SPORSSI_LAZY_FETCH=1`), mutta ajastus pitää tiedot valmiina.
6. Käännä käyttöliittymä ja kopioi se Apachen hakemistoon:
   `cd web && npm ci && npm run build && rsync -a --delete dist/ /var/www/html/sporssi/`
7. Ota käyttöön `deploy/apache-sporssi.conf` (mod_proxy). Se välittää `/sporssi/api/` Flaskille.

Käännetty käyttöliittymä käyttää suhteellisia polkuja (`base: './'`), joten sen voi sijoittaa mihin
tahansa hakemistoon. Jos rajapinta on muualla, muuta `config.js`:n `apiBase` ja aseta
palvelimelle `SPORSSI_CORS_ORIGIN`.
