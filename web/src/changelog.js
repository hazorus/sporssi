// Versiot ja muutoshistoria. Uusin versio ensimmäisenä; sivun alalaidan versionumero luetaan tästä.
// Päivitä aina, kun muutoksia commitoidaan (ks. CLAUDE.md / README).
export const CHANGELOG = [
  {
    version: '1.7.2',
    date: '2026-11-11',
    sections: [
      {
        title: 'Korjaukset',
        items: [
          'Oma kulutus: palvelimelle haettu vanhempi hintahistoria otetaan analyysiin heti eikä vasta seuraavana päivänä.',
          'Selkeämpi virheilmoitus, jos palvelimen ohjelmisto on sivua vanhempi.',
        ],
      },
    ],
  },
  {
    version: '1.7.1',
    date: '2026-11-11',
    sections: [
      {
        title: 'Korjaukset',
        items: [
          'Oma kulutus: Datahubin englanninkielisin otsikoin (Start Time, Quantity) ladattu tiedosto tunnistetaan.',
          'Analyysi rajataan Spörssin hintahistorian alkuun, ja sivu kertoo, kuinka paljon vanhempaa kulutusta jäi pois.',
        ],
      },
    ],
  },
  {
    version: '1.7',
    date: '2026-11-11',
    sections: [
      {
        title: 'Uudet ominaisuudet',
        items: [
          'Oma kulutus -sivu: Datahubin (tai sähköyhtiön) kulutus-CSV:n tuonti. Tiedosto käsitellään vain selaimessa.',
          'Kustannus pörssihinnalla ja kiinteällä hinnalla viikolta, kuukaudelta, vuodelta tai koko tiedostosta; kustannus päivittäin tai kuukausittain.',
          'Kalleimmat tunnit ja päivät, kulutuksen ja hinnan vuorokausiprofiili, vinkit sekä arvio säästöstä, jos osa kulutuksesta olisi siirretty päivän halvimmille tunneille.',
          'Mitattu peruskulutus yöllisistä tunneista; sen voi ottaa Spörssin peruskulutukseksi.',
        ],
      },
    ],
  },
  {
    version: '1.6',
    date: '2026-11-11',
    sections: [
      {
        title: 'Uudet ominaisuudet',
        items: [
          'Asunnon peruskulutus (aina päällä olevat laitteet): kerrostalo n. 60 W, omakotitalo n. 170 W tai oma mitattu arvo. Näkyy kustannustaulukossa ja kulutusjakaumassa; varoitus, jos kylmälaitteet tai ilmanvaihto on valittu myös laitteista.',
        ],
      },
    ],
  },
  {
    version: '1.5',
    date: '2026-11-11',
    sections: [
      {
        title: 'Muutokset',
        items: [
          'Spörssi on lisensoitu EUPL-1.2-lisenssillä; sivun alalaidassa linkit lisenssiin, lähdekoodiin ja käytettyjen kirjastojen lisensseihin.',
        ],
      },
    ],
  },
  {
    version: '1.4',
    date: '2026-11-11',
    sections: [
      {
        title: 'Muutokset',
        items: [
          'Laitteiden käyttö nyt -kaavion taustalla hinta tänään klo 00:sta niin pitkälle kuin hintoja on tiedossa (myös huominen); hinta nyt kaavion yläpuolella.',
          'Hintakaavion asteikon oletusyläraja 50 c/kWh; ylärajaa voi muuttaa suoraan kaavion yläpuolelta (muistetaan selaimessa).',
        ],
      },
    ],
  },
  {
    version: '1.3',
    date: '2026-11-11',
    sections: [
      {
        title: 'Muutokset',
        items: [
          'Tämän päivän hintakaavio alkaa edellisestä tunnista ja jatkuu niin pitkälle kuin hintoja on tiedossa: huomisen hinnat tulevat mukaan heti julkaisun jälkeen. Kuluneet tunnit saa näkyviin valinnalla.',
          'Hintakaavioon valittujen laitteiden halvimmaksi ajaksi tarjotaan vain tulevia aloitusaikoja; valittu aloitusaika näytetään seuraavana esiintymänä.',
          'Vuorokauden vaihde merkitään hintakaavioon ja hintataulukkoon viikonpäivällä; kellonaikojen väli sovitetaan näytön leveyteen.',
          'Käyttökustannus eri aloitusaikoina -kaavio siirretty sivun loppuun ennen kustannustaulukkoa.',
          'Korjattu laitteiden kaistojen leveys kapeilla näytöillä.',
        ],
      },
    ],
  },
  {
    version: '1.2',
    date: '2026-11-11',
    sections: [
      {
        title: 'Uudet ominaisuudet',
        items: [
          'Hintakaavioon voi valita enintään kolme laitetta: kaavion yläosaan tulee kullekin oma kaista, jossa halvin käyttöjakso on täytetty palkki ja valittu aloitusaika katkoviivakehys.',
          'Valituille laitteille käyttökerran hinta eri aloitusajoilla €-viivana (oma asteikko oikeassa reunassa, 0 € samalla korkeudella kuin 0 c/kWh); hinnat myös hintakaavion vihjeessä.',
        ],
      },
    ],
  },
  {
    version: '1.1',
    date: '2026-11-11',
    sections: [
      {
        title: 'Uudet ominaisuudet',
        items: [
          'Laitteiden käyttö nyt: kunkin valitun laitteen kustannus heti käynnistettynä sekä käyttökustannus eri aloitusaikoina (€ tai % nykyhetkestä).',
          'Käyttö nyt -kaavion taustalla tämän päivän hintakäyrä, kellonajat ja c/kWh-asteikko; hetken hinta korostettuna.',
          'Vuorokauden kulutusjakauma: osuus kulutuksesta ja kustannuksista rinnakkaisina palkkeina.',
          'Rakennuksen lämmitys ja lämmin vesi aina mukana; kaukolämpö lämmitystavaksi; lämmityskaavio tuntikustannuksina.',
          'Selaimen sijainti säätietojen ja lämmitystarveluvun valintaan (pyöristettynä n. 10 km tarkkuuteen).',
          'Asennettava sovellus (PWA): kuvake aloitusnäytölle, toimii viimeksi haetuilla tiedoilla ilman verkkoa.',
          'Versionumero sivun alalaidassa ja tämä muutoshistoria.',
        ],
      },
      {
        title: 'Käytettävyys ja ulkoasu',
        items: [
          'Sovelluksen nimi Spörssi; sivu käyttää koko selainikkunan leveyden.',
          'Hintakaavion palkeissa hinnat, kun tila riittää; kaaviot ja taulukot sovitettu puhelimen näytölle.',
          'Valitut laitteet tiiviinä listana: muokkauskentät aukeavat laitetta napsauttamalla, "Halvin klo" -painike siirtää aloituksen.',
          'Laitevalinta, aloitusaikakaavio ja kustannustaulukko kokoontaitettavina; auki/kiinni-tilat muistetaan selaimessa.',
          'Kustannukset sentin tarkkuudella; kustannustaulukossa kodinkoneet yhteenlaskettuna sekä lämmin vesi ja lämmitys.',
        ],
      },
      {
        title: 'Saavutettavuus',
        items: [
          'Kaikki tekstit vähintään 1rem, myös kaavioissa.',
          'WCAG 2.2 AA -korjaukset: maamerkit ja ohituslinkki, kaavioiden tekstivastineet, hintaluokka myös tekstinä, riittävät kontrastit ja kosketusalueet.',
        ],
      },
      {
        title: 'Tietoturva ja suorituskyky',
        items: [
          'Tietoturvaotsakkeet (CSP ym.), ECharts 6.1 (XSS-korjaus), rajapinnan ulkoisten hakujen rajoitus.',
          'HTTP-välimuisti ja ETag: valmiit päivät välimuistissa, keskeneräinen päivä julkaisuhetkeen asti; 12 kk tilasto kerran vuorokaudessa.',
        ],
      },
    ],
  },
  {
    version: '1.0',
    date: '2026-11-04',
    sections: [
      {
        title: 'Ensimmäinen versio',
        items: [
          'Pörssisähkön hinta tunneittain ja varteittain (ENTSO-E / sahkotin.fi), eilinen ja huominen, kiinteä asteikko.',
          'Värialueet viimeisen 12 kuukauden keskihinnan ja keskihajonnan mukaan.',
          '29 kodinkonetta oletuskulutuksineen ja lähteineen (Motiva, EPREL, Helen), omat laitteet, halvin aloitusaika.',
          'Sähkölämmityksen arvio Ilmatieteen laitoksen havainnoista ja ennusteesta (suora, lattia, varaava, ILP, IVLP, MLP).',
          'Kulutus- ja kustannustaulukko tunneittain; Flask-rajapinta, SQLite-tietokanta ja Apache-asennus.',
        ],
      },
    ],
  },
];

export const VERSION = CHANGELOG[0].version;
