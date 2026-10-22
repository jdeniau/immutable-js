import { describe, expect, it } from '@jest/globals';
import {
  List,
  Map,
  Record as ImmutableRecord,
  Set,
  fromJS,
  hash,
  is,
} from 'immutable';

/**
 * Generates `2 ** rounds` distinct strings that all share the same
 * `Immutable.hash()`, by concatenating the classic "Aa"/"BB" collision blocks
 * (both equal `65 * 31 + 97 === 66 * 31 + 66 === 2112` under the JVM-style
 * `31 * h + c` string hash). Inserting these into a Map forces them all into a
 * single HashCollisionNode — the hash-flooding scenario this code guards.
 */
function collisionKeys(rounds: number): Array<string> {
  let keys = [''];
  for (let i = 0; i < rounds; i++) {
    const next: Array<string> = [];
    for (const k of keys) {
      next.push(k + 'Aa');
      next.push(k + 'BB');
    }
    keys = next;
  }
  return keys;
}

describe('Map hash collisions', () => {
  it('the generated keys really do collide (test is meaningful)', () => {
    const keys = collisionKeys(8); // 256 keys
    const h = hash(keys[0]!);
    expect(keys.every((k) => hash(k) === h)).toBe(true);
    expect(new globalThis.Set(keys).size).toBe(keys.length); // all distinct
  });

  it('does not change the public, deterministic hash() of strings', () => {
    // The secondary collision hash is internal and seeded; it must not leak
    // into the public hash().
    expect(hash('a')).toBe(97);
    expect(hash('immutable-js')).toBe(510203252);
  });

  describe('correctness with thousands of colliding keys', () => {
    const keys = collisionKeys(11); // 2048 keys, well above the index threshold

    it('stores and retrieves every colliding key (built from an object)', () => {
      const obj: Record<string, number> = {};
      keys.forEach((k, i) => (obj[k] = i));
      const map = Map(obj);

      expect(map.size).toBe(keys.length);
      expect(keys.every((k, i) => map.get(k) === i)).toBe(true);
      expect(map.get('not-a-colliding-key', 'default')).toBe('default');
      expect(map.has(keys[0]!)).toBe(true);
      expect(map.has('not-a-colliding-key')).toBe(false);
    });

    it('behaves the same whether built transiently or persistently', () => {
      const transient = Map<string, number>().withMutations((m) => {
        keys.forEach((k, i) => m.set(k, i));
      });
      let persistent = Map<string, number>();
      keys.forEach((k, i) => (persistent = persistent.set(k, i)));

      expect(transient.size).toBe(keys.length);
      expect(persistent.size).toBe(keys.length);
      expect(is(transient, persistent)).toBe(true);
      expect(keys.every((k, i) => persistent.get(k) === i)).toBe(true);
    });

    it('overwrites an existing colliding key without changing size', () => {
      const map = Map(keys.map((k, i) => [k, i]));
      const updated = map.set(keys[100]!, 9999);

      expect(updated.get(keys[100]!)).toBe(9999);
      expect(updated.size).toBe(map.size);
      // original is untouched (persistence)
      expect(map.get(keys[100]!)).toBe(100);
    });

    it('removes colliding keys and keeps the rest retrievable', () => {
      const map = Map(keys.map((k, i) => [k, i]));
      const removed = map.remove(keys[50]!).remove(keys[51]!).remove(keys[52]!);

      expect(removed.size).toBe(map.size - 3);
      expect(removed.get(keys[50]!, 'gone')).toBe('gone');
      expect(removed.get(keys[51]!, 'gone')).toBe('gone');
      // a previously-removed-around key is still correct (index stayed valid)
      expect(removed.get(keys[53]!)).toBe(53);
      expect(removed.get(keys[0]!)).toBe(0);
      expect(removed.get(keys[keys.length - 1]!)).toBe(keys.length - 1);
    });

    it('iterates over every colliding entry exactly once', () => {
      const map = Map(keys.map((k, i) => [k, i]));

      const seen = new globalThis.Set<string>();
      map.forEach((_v, k) => seen.add(k));
      expect(seen.size).toBe(keys.length);
      expect(keys.every((k) => seen.has(k))).toBe(true);

      expect(map.keySeq().toArray().sort()).toEqual([...keys].sort());
      expect(map.entrySeq().count()).toBe(keys.length);
    });

    it('keeps equals() and hashCode() consistent', () => {
      const a = Map(keys.map((k, i) => [k, i]));
      const b = Map(keys.map((k, i) => [k, i]));
      expect(is(a, b)).toBe(true);
      expect(a.hashCode()).toBe(b.hashCode());

      const c = a.set(keys[0]!, -1);
      expect(is(a, c)).toBe(false);
    });
  });

  it('mixes colliding and normally-distributed keys', () => {
    const keys = collisionKeys(10); // 1024 colliding
    const map = Map<string, number | string>(keys.map((k, i) => [k, i]))
      .set('alpha', 'a')
      .set('beta', 'b');

    expect(map.get('alpha')).toBe('a');
    expect(map.get('beta')).toBe('b');
    expect(map.get(keys[7]!)).toBe(7);
    expect(map.size).toBe(keys.length + 2);
  });

  it('is correct just below and just above the index threshold', () => {
    // 8 keys (below threshold 16) then 64 keys (above) — both must be correct.
    for (const rounds of [3, 6]) {
      const keys = collisionKeys(rounds);
      let map = Map<string, number>();
      keys.forEach((k, i) => (map = map.set(k, i)));
      expect(map.size).toBe(keys.length);
      expect(keys.every((k, i) => map.get(k) === i)).toBe(true);

      // remove half, the rest must remain correct
      let trimmed = map;
      keys
        .slice(0, keys.length / 2)
        .forEach((k) => (trimmed = trimmed.remove(k)));
      expect(trimmed.size).toBe(keys.length / 2);
      expect(
        keys
          .slice(keys.length / 2)
          .every((k, i) => trimmed.get(k) === i + keys.length / 2)
      ).toBe(true);
    }
  });

  it('merge() and mergeDeep() work with colliding keys', () => {
    const keys = collisionKeys(11); // 2048 colliding
    const userObj: Record<string, number> = {};
    keys.forEach((k, i) => (userObj[k] = i));

    const merged = Map({ existing: -1 }).merge(userObj);
    expect(merged.get('existing')).toBe(-1);
    expect(merged.get(keys[123]!)).toBe(123);
    expect(merged.size).toBe(keys.length + 1);

    const deep = Map({ existing: -1 }).mergeDeep(fromJS(userObj));
    expect(deep.get(keys[123]!)).toBe(123);
    expect(deep.size).toBe(keys.length + 1);
  });

  it('Set (backed by Map) handles colliding values', () => {
    const keys = collisionKeys(11); // 2048 colliding
    const set = Set(keys);

    expect(set.size).toBe(keys.length);
    expect(keys.every((k) => set.has(k))).toBe(true);
    expect(set.has('not-in-set')).toBe(false);

    const without = set.remove(keys[10]!);
    expect(without.has(keys[10]!)).toBe(false);
    expect(without.size).toBe(keys.length - 1);
  });

  it('handles value-object keys that all share one hashCode', () => {
    // Exercises the non-string fallback in hashCollisionKey: equality is still
    // decided by is()/equals(), never by the (constant) secondary hash.
    class Collider {
      constructor(readonly id: number) {}
      equals(other: unknown): boolean {
        return other instanceof Collider && other.id === this.id;
      }
      hashCode(): number {
        return 7; // force every instance into the same collision node
      }
    }
    const items = Array.from({ length: 50 }, (_, i) => new Collider(i));

    let map = Map<Collider, number>();
    items.forEach((c, i) => (map = map.set(c, i)));

    expect(map.size).toBe(items.length);
    expect(items.every((c, i) => map.get(new Collider(i)) === i)).toBe(true);
    expect(map.get(new Collider(999), 'absent')).toBe('absent');

    const removed = map.remove(new Collider(25));
    expect(removed.size).toBe(items.length - 1);
    expect(removed.get(new Collider(25), 'gone')).toBe('gone');
    expect(removed.get(new Collider(26))).toBe(26);
  });

  describe('non-string keys', () => {
    // The public `hash()` folds every `x.5` number to the same value, so a
    // plain JSON array of such numbers is a ready-made colliding family.
    function halfIntegers(n: number): Array<number> {
      return Array.from({ length: n }, (_, i) => i + 0.5);
    }

    it('the generated numbers really do collide (test is meaningful)', () => {
      const nums = halfIntegers(256);
      const h = hash(nums[0]!);
      expect(nums.every((n) => hash(n) === h)).toBe(true);
      expect(new globalThis.Set(nums).size).toBe(nums.length);
    });

    it('stores and retrieves thousands of colliding number keys', () => {
      const nums = halfIntegers(4096);
      const map = Map(nums.map((n, i) => [n, i]));

      expect(map.size).toBe(nums.length);
      expect(nums.every((n, i) => map.get(n) === i)).toBe(true);
      expect(map.get(0.25, 'absent')).toBe('absent');

      const removed = map.remove(10.5).remove(11.5);
      expect(removed.size).toBe(nums.length - 2);
      expect(removed.get(10.5, 'gone')).toBe('gone');
      expect(removed.get(12.5)).toBe(12);

      const set = Set(nums);
      expect(set.size).toBe(nums.length);
      expect(set.has(4095.5)).toBe(true);
      expect(set.has(4096.5)).toBe(false);
    });

    it('keeps 0/-0 and NaN as single keys inside an indexed bucket', () => {
      // '\0'.repeat(k), '', 0, -0, NaN and ±Infinity all hash to 0.
      const nulStrings = Array.from({ length: 20 }, (_, i) =>
        '\0'.repeat(i + 1)
      );
      const keys: Array<string | number> = [
        ...nulStrings,
        '',
        0,
        NaN,
        Infinity,
        -Infinity,
      ];
      expect(keys.every((k) => hash(k) === 0)).toBe(true);

      let map = Map<string | number, number>();
      keys.forEach((k, i) => (map = map.set(k, i)));
      expect(map.size).toBe(keys.length);

      expect(map.get(-0)).toBe(map.get(0));
      expect(map.set(-0, -1).size).toBe(keys.length);
      expect(map.get(NaN)).toBe(keys.findIndex((k) => k !== k));
      expect(map.set(NaN, -1).size).toBe(keys.length);
      expect(map.get(Infinity)).not.toBe(map.get(-Infinity));
      expect(map.get('')).toBe(keys.indexOf(''));
      expect(map.remove(0).has(-0)).toBe(false);
    });

    it('handles valueOf()-based keys (Date-like) that collide', () => {
      class Wrapped {
        constructor(readonly n: number) {}
        valueOf(): number {
          return this.n;
        }
      }
      const keys = halfIntegers(2048).map((n) => new Wrapped(n));
      expect(hash(keys[0]!)).toBe(hash(keys[1]!));
      expect(is(keys[0]!, new Wrapped(0.5))).toBe(true);

      const map = Map(keys.map((k, i) => [k, i]));
      expect(map.size).toBe(keys.length);
      expect(keys.every((k, i) => map.get(new Wrapped(k.n)) === i)).toBe(true);
      expect(map.get(new Wrapped(0.25), 'absent')).toBe('absent');
      expect(map.remove(new Wrapped(7.5)).get(new Wrapped(7.5), 'gone')).toBe(
        'gone'
      );
    });

    it('handles Immutable collections used as keys that collide', () => {
      const strs = collisionKeys(11); // 2048 colliding strings

      // composite keys
      const lists = strs.map((s) => List([s, 'x']));
      expect(lists.every((l) => hash(l) === hash(lists[0]!))).toBe(true);
      const byList = Map(lists.map((l, i) => [l, i]));
      expect(byList.size).toBe(lists.length);
      expect(strs.every((s, i) => byList.get(List([s, 'x'])) === i)).toBe(true);
      expect(byList.get(List(['Aa', 'y']), 'absent')).toBe('absent');
      expect(byList.remove(List([strs[3]!, 'x'])).size).toBe(lists.length - 1);

      // deduplicating records of untrusted data
      const maps = Set(strs.map((s) => Map({ name: s, role: 'user' })));
      expect(maps.size).toBe(strs.length);
      expect(maps.has(Map({ name: strs[5]!, role: 'user' }))).toBe(true);
      expect(maps.has(Map({ name: strs[5]!, role: 'admin' }))).toBe(false);

      // nested
      const nested = Map(strs.map((s, i) => [List([Set([s])]), i]));
      expect(nested.get(List([Set([strs[9]!])]))).toBe(9);
      expect(nested.get(List([Set(['other'])]), 'absent')).toBe('absent');
    });

    it('handles Records used as keys that collide', () => {
      const strs = collisionKeys(11); // 2048 colliding strings
      const Person = ImmutableRecord({ name: '', age: 0 });
      const records = strs.map((s) => Person({ name: s }));
      expect(records.every((r) => hash(r) === hash(records[0]!))).toBe(true);

      const map = Map(records.map((r, i) => [r, i]));
      expect(map.size).toBe(records.length);
      expect(strs.every((s, i) => map.get(Person({ name: s })) === i)).toBe(
        true
      );
      expect(map.get(Person({ name: strs[7]!, age: 1 }), 'absent')).toBe(
        'absent'
      );
      expect(Set(records).has(Person({ name: strs[7]! }))).toBe(true);
    });

    it('falls back safely for a Record subclass that redefines equals()', () => {
      const strs = collisionKeys(8); // 256 colliding strings
      // Equality ignores `extra`, so a structural secondary hash would be
      // wrong: the lookup must still find the entry.
      class Loose extends ImmutableRecord({ name: '', extra: 0 }) {
        override equals(other: unknown): boolean {
          return other instanceof Loose && other.name === this.name;
        }
        override hashCode(): number {
          return hash(this.name);
        }
      }
      const map = Map(
        strs.map((s, i) => [new Loose({ name: s, extra: i }), i])
      );
      expect(map.size).toBe(strs.length);
      expect(
        strs.every((s, i) => map.get(new Loose({ name: s, extra: -1 })) === i)
      ).toBe(true);
      expect(map.set(new Loose({ name: strs[0]!, extra: 42 }), -1).size).toBe(
        strs.length
      );
    });

    it('does not degrade for a large flood of colliding non-string keys', () => {
      const nums = halfIntegers(16384);
      const set = Set(nums);
      expect(set.size).toBe(nums.length);
      expect(set.has(16383.5)).toBe(true);

      const strs = collisionKeys(14); // 16384 colliding strings
      const map = Map(strs.map((s, i) => [List([s]), i]));
      expect(map.size).toBe(strs.length);
      expect(map.get(List([strs[strs.length - 1]!]))).toBe(strs.length - 1);
    });
  });

  it('does not degrade for a large flood of colliding keys', () => {
    // A regression guard: with the linear scan this is ~O(n²) and takes seconds
    // for 16384 keys; with the seeded index it is ~linear and near-instant.
    const keys = collisionKeys(14); // 16384 colliding keys
    const obj: Record<string, number> = {};
    keys.forEach((k, i) => (obj[k] = i));

    const map = Map(obj);
    expect(map.size).toBe(keys.length);
    // spot-check retrieval across the whole bucket
    expect(map.get(keys[0]!)).toBe(0);
    expect(map.get(keys[keys.length - 1]!)).toBe(keys.length - 1);
    expect(map.get(keys[keys.length >> 1]!)).toBe(keys.length >> 1);
  });
});
