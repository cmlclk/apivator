// Yerel .NET ajanını bu makinenin platformu için tek dosya olarak yayınlar ve Tauri'nin beklediği adla
// (apivator-agent-<rust hedef üçlüsü>[.exe]) src-tauri/binaries altına koyar.
//   node scripts/build-agent.mjs              → her seferinde yeniden derler
//   node scripts/build-agent.mjs --if-missing → dosya varsa atlar (tauri dev'i hızlandırır)
//   node scripts/build-agent.mjs --target x86_64-apple-darwin → başka hedef için (yayında macOS x64)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../../../../backend/src/Apivator.Agent/Apivator.Agent.csproj');
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
const target = join(binaries, `apivator-agent-${triple}${exe}`);
if (process.argv.includes('--if-missing') && existsSync(target)) {
  console.log(`Ajan zaten var: ${target}`);
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'apivator-agent-'));
try {
  console.log(`Ajan yayınlanıyor (${rid})…`);
  run(
    'dotnet',
    ['publish', project, '-c', 'Release', '-r', rid, '-o', out, '--nologo'],
    { stdio: 'inherit' },
    '.NET 10 SDK kurulu olmalı.',
  );
  mkdirSync(binaries, { recursive: true });
  copyFileSync(join(out, `apivator-agent${exe}`), target);
  console.log(`Hazır: ${target}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
