// Starts the local Firebase emulators: Cloud Functions, phone sign-in and the database.
//
// The database emulator needs Java 21 or newer. When the `java` on PATH is
// older or missing, a newer one is looked for in the usual places (Android
// Studio ships one) and used for this process only: nothing is installed and
// the machine's own Java is left alone. Set CEEQ_JAVA_HOME to point at one.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NEEDED = 21;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const javaIn = (home) => join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');

/** The major version of a Java program, or 0 if it cannot be run. */
function majorVersion(java) {
  // `java -version` prints to stderr, e.g.: openjdk version "21.0.10" 2026-01-20
  const { stderr = '', stdout = '' } = spawnSync(java, ['-version'], { encoding: 'utf8' });
  return Number(/version "(\d+)/.exec(stderr + stdout)?.[1] ?? 0);
}

/** Every folder directly inside `parent`, or nothing if it does not exist. */
const inside = (parent) => (parent && existsSync(parent) ? readdirSync(parent).map((name) => join(parent, name)) : []);

function findNewerJava() {
  const { ProgramFiles = 'C:\\Program Files', USERPROFILE, HOME } = process.env;
  const homes = [
    process.env.CEEQ_JAVA_HOME,
    process.env.JAVA_HOME,
    join(ProgramFiles, 'Android', 'Android Studio', 'jbr'),
    ...['Microsoft', 'Eclipse Adoptium', 'Java', 'Zulu', 'Amazon Corretto'].flatMap((vendor) => inside(join(ProgramFiles, vendor))),
    ...inside(join(USERPROFILE ?? HOME ?? '', '.jdks')),
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    ...inside('/Library/Java/JavaVirtualMachines').map((jdk) => join(jdk, 'Contents', 'Home')),
    ...inside('/usr/lib/jvm'),
  ];
  return homes.find((home) => home && existsSync(javaIn(home)) && majorVersion(javaIn(home)) >= NEEDED);
}

const env = { ...process.env };
if (majorVersion('java') < NEEDED) {
  const home = findNewerJava();
  if (!home) {
    console.error(`The database emulator needs Java ${NEEDED} or newer, and none was found.`);
    console.error(`Install a JDK ${NEEDED} (for example: winget install Microsoft.OpenJDK.${NEEDED}), or set CEEQ_JAVA_HOME to one you have.`);
    process.exit(1);
  }
  console.log(`Using Java from ${home} for the emulators.`);
  env.JAVA_HOME = home;
  env.PATH = `${join(home, 'bin')}${delimiter}${process.env.PATH ?? ''}`;
}

const firebase = join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const emulators = spawn(process.execPath, [firebase, 'emulators:start', '--only', 'functions,auth,firestore'], { cwd: root, env, stdio: 'inherit' });
emulators.on('exit', (code) => process.exit(code ?? 0));
