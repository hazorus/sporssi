// Vite-lisäosa: kokoaa käännökseen päätyneiden npm-pakettien lisenssit tiedostoon
// third-party-licenses.txt (esim. ECharts Apache-2.0 edellyttää lisenssin ja NOTICE-tiedoston
// mukana jakamista). Luettelo muodostetaan vain niistä paketeista, jotka todella ovat paketissa.
import fs from 'node:fs';
import path from 'node:path';

const NOTICE_FILES = /^(licen[cs]e|notice|copying|copyrightnotice)(\.(md|txt))?$/i;

function packageRoot(id) {
  const norm = id.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = norm.slice(i + '/node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, dir: norm.slice(0, i) + '/node_modules/' + name };
}

export default function thirdPartyLicenses() {
  return {
    name: 'sporssi-third-party-licenses',
    apply: 'build',
    generateBundle() {
      const pkgs = new Map();
      for (const id of this.getModuleIds()) {
        const root = packageRoot(id.replace(/^\0/, '').split('?')[0]);
        if (root && !pkgs.has(root.name)) pkgs.set(root.name, root.dir);
      }
      const parts = [
        'Spörssi käyttää seuraavia avoimen lähdekoodin kirjastoja. Niiden lisenssit ja',
        'tekijänoikeusmerkinnät ovat alla. Spörssin oma koodi on lisensoitu EUPL-1.2:lla (LICENSE).',
        '',
      ];
      for (const name of [...pkgs.keys()].sort()) {
        const dir = pkgs.get(name);
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* ohitetaan */ }
        parts.push('='.repeat(78), `${name} ${meta.version ?? ''} — ${meta.license ?? 'ks. alla'}`,
          meta.homepage ? meta.homepage : '', '='.repeat(78));
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => NOTICE_FILES.test(f)).sort(); } catch { /* ohitetaan */ }
        for (const f of files) {
          parts.push(`--- ${f} ---`, fs.readFileSync(path.join(dir, f), 'utf8').trim(), '');
        }
        if (!files.length) parts.push('(Paketissa ei ole erillistä lisenssitiedostoa; lisenssi: ' + (meta.license ?? 'tuntematon') + ')', '');
      }
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source: parts.join('\n') + '\n' });
      // Spörssin oma lisenssiteksti julkaisuun (repon juuren LICENSE).
      const own = path.resolve(process.cwd(), '..', 'LICENSE');
      if (fs.existsSync(own)) this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: fs.readFileSync(own, 'utf8') });
    },
  };
}
