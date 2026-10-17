// Passphrase-encrypted storage for the Gemini key on a published page.
//
// The published site is static and world-readable, so a key placed in it is a
// key given away. This encrypts it under a passphrase so the file is useless on
// its own — and is honest about the limit: an attacker can take the file and
// guess passphrases offline, as fast as their hardware allows. The security of
// this is exactly the strength of the passphrase, which is why the locking page
// insists on a real one.
//
// Scheme, deliberately boring and all from WebCrypto:
//   key   = PBKDF2-HMAC-SHA256(passphrase, salt, iterations) -> 256 bits
//   blob  = AES-256-GCM(key, iv, apiKey)     (GCM authenticates, so a wrong
//                                             passphrase fails loudly)
// Salt and IV are random per lock and stored alongside the ciphertext.

export const ITERATIONS = 600000;   // OWASP's PBKDF2-SHA256 floor
export const MIN_PASSPHRASE = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(pad(text));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Trailing "=" is routinely stripped in transit — GitHub Actions variables do
// it, and so does many a copy-paste. Browsers happen to tolerate unpadded input
// today, but relying on that turns a lost character into a baffling "that
// locked key is not readable" months later. Put the padding back explicitly.
function pad(text) {
  const clean = String(text).trim();
  return clean + '='.repeat((4 - (clean.length % 4)) % 4);
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']);
}

export async function lock(apiKey, passphrase) {
  if (!apiKey) throw new Error('No API key given.');
  if (!passphrase || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters. `
      + 'Anyone can download the published file and guess offline, so a short '
      + 'word is not protection.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(apiKey));

  return btoa(JSON.stringify({
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  }));
}

export async function unlock(blob, passphrase) {
  let meta;
  try {
    meta = JSON.parse(atob(pad(blob)));
  } catch (err) {
    throw new Error('That locked key is not readable — re-lock it.');
  }
  if (meta.v !== 1) throw new Error(`Unknown locked-key format (v${meta.v}).`);

  const key = await deriveKey(passphrase, fromBase64(meta.salt), meta.iter || ITERATIONS);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(meta.iv) }, key, fromBase64(meta.ct));
    return dec.decode(plain);
  } catch (err) {
    // GCM authentication failed: wrong passphrase, or a tampered blob.
    throw new Error('Wrong passphrase.');
  }
}
