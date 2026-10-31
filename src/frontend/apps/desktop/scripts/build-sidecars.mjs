// .NET sidecar'larını (yerel ajan ve yerel mod API'si) bu makinenin platformu için tek dosya olarak yayınlar
// ve Tauri'nin beklediği adla (apivator-agent-<rust hedef üçlüsü>[.exe], apivator-api-…) src-tauri/binaries
// altına koyar.
//   node scripts/build-sidecars.mjs              → her seferinde yeniden derler
//   node scripts/build-sidecars.mjs --if-missing → dosya varsa atlar (tauri dev'i hızlandırır)
//   node scripts/build-sidecars.mjs --target x86_64-apple-darwin → başka hedef için (çapraz derleme)
//   node scripts/build-sidecars.mjs --only api   → yalnızca biri (agent | api)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../../backend/src');
const sidecars = [
  {
    name: 'apivator-agent',
    project: join(backend, 'Apivator.Agent/Apivator.Agent.csproj'),
    output: 'apivator-agent',
  },
  {
    name: 'apivator-api',
    project: join(backend, 'Apivator.Api/Apivator.Api.csproj'),
    output: 'Apivator.Api',
  },
];
const binaries = resolve(here, '../src-tauri/binaries');

/** Komutu çalıştırır; program bulunamazsa ne kurulacağını söyleyip çıkar. */
function run(command, args, options, hint) {
  try {
    return execFileSync(command, args, options);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n'${command}' bulunamadı. ${hint}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const targetArg = process.argv.indexOf('--target');
const triple =
  targetArg > 0
    ? process.argv[targetArg + 1]
    : /host: (\S+)/.exec(
        run(
          'rustc',
          ['-vV'],
          { encoding: 'utf8' },
          'Rust kurulu değil ya da bu terminal onu görmüyor. https://rustup.rs adresinden kurun; kurduysanız terminali kapatıp yeniden açın.',
        ),
      )?.[1];
const rids = {
  'x86_64-pc-windows-msvc': 'win-x64',
  'aarch64-pc-windows-msvc': 'win-arm64',
  'x86_64-apple-darwin': 'osx-x64',
  'aarch64-apple-darwin': 'osx-arm64',
  'x86_64-unknown-linux-gnu': 'linux-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
};
const rid = triple && rids[triple];
if (!rid) {
  console.error(`Desteklenmeyen platform: ${triple ?? 'bilinmiyor'}`);
  process.exit(1);
}

const exe = rid.startsWith('win') ? '.exe' : '';
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? `apivator-${process.argv[onlyArg + 1]}` : null;
if (only && !sidecars.some((s) => s.name === only)) {
  console.error(`Bilinmeyen sidecar: ${process.argv[onlyArg + 1]} (agent | api)`);
  process.exit(1);
}

for (const sidecar of sidecars.filter((s) => !only || s.name === only)) {
  const target = join(binaries, `${sidecar.name}-${triple}${exe}`);
  if (process.argv.includes('--if-missing') && existsSync(target)) {
    console.log(`Zaten var: ${target}`);
    continue;
  }

  const out = mkdtempSync(join(tmpdir(), `${sidecar.name}-`));
  try {
    console.log(`${sidecar.name} yayınlanıyor (${rid})…`);
    run(
      'dotnet',
      ['publish', sidecar.project, '-c', 'Release', '-r', rid, '-o', out, '--nologo'],
      { stdio: 'inherit' },
      '.NET 10 SDK kurulu olmalı.',
    );
    mkdirSync(binaries, { recursive: true });
    copyFileSync(join(out, `${sidecar.output}${exe}`), target);
    console.log(`Hazır: ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
