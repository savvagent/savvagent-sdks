import { createHash, randomBytes } from 'node:crypto';
import { sha256Hex } from '../src/sha256';

const ref = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  test('matches the NIST vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  test('matches node:crypto on many random strings, including non-ASCII and astral characters', () => {
    const alphabets = ['abcXYZ 019{}":,', 'é漢字ñß', '😀🎉𝒳', 'a😀é漢'];
    for (let i = 0; i < 600; i++) {
      const alphabet = Array.from(alphabets[i % alphabets.length]);
      const len = i < 300 ? i : Math.floor(Math.random() * 400);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[randomBytes(1)[0] % alphabet.length];
      expect(sha256Hex(s)).toBe(ref(s));
    }
  });

  test('matches node:crypto around the 55/56/64/119/120/128 byte padding boundaries', () => {
    for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const s = 'x'.repeat(n);
      expect(sha256Hex(s)).toBe(ref(s));
    }
  });
});
