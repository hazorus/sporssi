// Versiot ja muutoshistoria. Uusin versio ensimmäisenä; sivun alalaidan versionumero luetaan tästä.
// Päivitä aina, kun muutoksia commitoidaan (ks. CLAUDE.md / README).
export const CHANGELOG = [
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
