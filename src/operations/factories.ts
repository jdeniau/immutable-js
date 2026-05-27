/* eslint-disable @typescript-eslint/no-explicit-any */
// Pragmatic typing: this file mirrors the original Operations.js code closely.
// Many factories build "Sequence-like" objects via Object.create() + dynamic
// property assignment, which TypeScript can't usefully type without a deeper
// refactor. We use `any` locally for those polymorphic params/returns; the
// strict public API types live in `type-definitions/immutable.d.ts`.

import { Collection } from '../Collection';
import {
  getIterator,
  Iterator,
  iteratorValue,
  iteratorDone,
  ITERATE_KEYS,
  ITERATE_VALUES,
  ITERATE_ENTRIES,
} from '../Iterator';
import { KeyedSeq, SetSeq, IndexedSeq, ArraySeq } from '../Seq';
import {
  NOT_SET,
  ensureSize,
  wrapIndex,
  wholeSlice,
  resolveBegin,
  resolveEnd,
} from '../TrieUtils';
import { isCollection } from '../predicates/isCollection';
import { isIndexed } from '../predicates/isIndexed';
import { isKeyed } from '../predicates/isKeyed';
import { isSeq } from '../predicates/isSeq';
import {
  cacheResultThrough,
  collectionClass,
  defaultComparator,
  makeSequence,
  reify,
} from './helpers.js';

export function flipFactory(collection: any) {
  const flipSequence = makeSequence(collection);
  flipSequence._iter = collection;
  flipSequence.size = collection.size;
  flipSequence.flip = () => collection;
  flipSequence.reverse = function (this: any) {
    const reversedSequence = collection.reverse.apply(this); // super.reverse()
    reversedSequence.flip = () => collection.reverse();
    return reversedSequence;
  };
  flipSequence.has = (key: any) => collection.includes(key);
  flipSequence.includes = (key: any) => collection.has(key);
  flipSequence.cacheResult = cacheResultThrough;
  flipSequence.__iterateUncached = function (this: any, fn: any, reverse: any) {
    return collection.__iterate(
      (v: any, k: any) => fn(k, v, this) !== false,
      reverse
    );
  };
  flipSequence.__iteratorUncached = function (type: any, reverse: any) {
    if (type === ITERATE_ENTRIES) {
      const iterator = collection.__iterator(type, reverse);
      return new Iterator(() => {
        const step = iterator.next();
        if (!step.done) {
          const k = step.value[0];
          step.value[0] = step.value[1];
          step.value[1] = k;
        }
        return step;
      });
    }
    return collection.__iterator(
      type === ITERATE_VALUES ? ITERATE_KEYS : ITERATE_VALUES,
      reverse
    );
  };
  return flipSequence;
}

export function mapFactory(collection: any, mapper: any, context: any) {
  const mappedSequence = makeSequence(collection);
  mappedSequence.size = collection.size;
  mappedSequence.has = (key: any) => collection.has(key);
  mappedSequence.get = (key: any, notSetValue: any) => {
    const v = collection.get(key, NOT_SET);
    return v === NOT_SET
      ? notSetValue
      : mapper.call(context, v, key, collection);
  };
  mappedSequence.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ) {
    return collection.__iterate(
      (v: any, k: any, c: any) =>
        fn(mapper.call(context, v, k, c), k, this) !== false,
      reverse
    );
  };
  mappedSequence.__iteratorUncached = function (type: any, reverse: any) {
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    return new Iterator(() => {
      const step = iterator.next();
      if (step.done) {
        return step;
      }
      const entry = step.value;
      const key = entry[0];
      return iteratorValue(
        type,
        key,
        mapper.call(context, entry[1], key, collection),
        step
      );
    });
  };
  return mappedSequence;
}

export function reverseFactory(collection: any, useKeys: any) {
  const reversedSequence = makeSequence(collection);
  reversedSequence._iter = collection;
  reversedSequence.size = collection.size;
  reversedSequence.reverse = () => collection;
  if (collection.flip) {
    reversedSequence.flip = function () {
      const flipSequence = flipFactory(collection);
      flipSequence.reverse = () => collection.flip();
      return flipSequence;
    };
  }
  reversedSequence.get = (key: any, notSetValue: any) =>
    collection.get(useKeys ? key : -1 - key, notSetValue);
  reversedSequence.has = (key: any) => collection.has(useKeys ? key : -1 - key);
  reversedSequence.includes = (value: any) => collection.includes(value);
  reversedSequence.cacheResult = cacheResultThrough;
  reversedSequence.__iterate = function (this: any, fn: any, reverse: any) {
    let i = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    reverse && ensureSize(collection);
    return collection.__iterate(
      (v: any, k: any) =>
        fn(v, useKeys ? k : reverse ? this.size - ++i : i++, this),
      !reverse
    );
  };
  reversedSequence.__iterator = (type: any, reverse: any) => {
    let i = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    reverse && ensureSize(collection);
    const iterator = collection.__iterator(ITERATE_ENTRIES, !reverse);
    return new Iterator(() => {
      const step = iterator.next();
      if (step.done) {
        return step;
      }
      const entry = step.value;
      return iteratorValue(
        type,
        useKeys ? entry[0] : reverse ? reversedSequence.size - ++i : i++,
        entry[1],
        step
      );
    });
  };
  return reversedSequence;
}

export function filterFactory(
  collection: any,
  predicate: any,
  context: any,
  useKeys: any
) {
  const filterSequence = makeSequence(collection);
  if (useKeys) {
    filterSequence.has = (key: any) => {
      const v = collection.get(key, NOT_SET);
      return v !== NOT_SET && !!predicate.call(context, v, key, collection);
    };
    filterSequence.get = (key: any, notSetValue: any) => {
      const v = collection.get(key, NOT_SET);
      return v !== NOT_SET && predicate.call(context, v, key, collection)
        ? v
        : notSetValue;
    };
  }
  filterSequence.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ) {
    let iterations = 0;
    collection.__iterate((v: any, k: any, c: any) => {
      if (predicate.call(context, v, k, c)) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    }, reverse);
    return iterations;
  };
  filterSequence.__iteratorUncached = function (type: any, reverse: any) {
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    let iterations = 0;
    return new Iterator(() => {
      while (true) {
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        const entry = step.value;
        const key = entry[0];
        const value = entry[1];
        if (predicate.call(context, value, key, collection)) {
          return iteratorValue(type, useKeys ? key : iterations++, value, step);
        }
      }
    });
  };
  return filterSequence;
}

export function partitionFactory(
  collection: any,
  predicate: any,
  context: any
) {
  const isKeyedIter = isKeyed(collection);
  const groups: [Array<any>, Array<any>] = [[], []];
  collection.__iterate((v: any, k: any) => {
    groups[predicate.call(context, v, k, collection) ? 1 : 0].push(
      isKeyedIter ? [k, v] : v
    );
  });
  const coerce = collectionClass(collection) as (v: any) => any;
  return groups.map((arr) => reify(collection, coerce(arr)));
}

export function sliceFactory(
  collection: any,
  begin: any,
  end: any,
  useKeys: any
) {
  const originalSize = collection.size;

  if (wholeSlice(begin, end, originalSize)) {
    return collection;
  }

  // begin or end can not be resolved if they were provided as negative numbers
  // and this collection's size is unknown. In that case, cache first so there
  // is a known size and these do not resolve to NaN.
  if (typeof originalSize === 'undefined' && (begin < 0 || end < 0)) {
    return sliceFactory(collection.toSeq().cacheResult(), begin, end, useKeys);
  }

  const resolvedBegin = resolveBegin(begin, originalSize);
  const resolvedEnd = resolveEnd(end, originalSize);

  // Note: resolvedEnd is undefined when the original sequence's length is
  // unknown and this slice did not supply an end and should contain all
  // elements after resolvedBegin.
  // In that case, resolvedSize will be NaN and sliceSize will remain undefined.
  const resolvedSize = resolvedEnd - resolvedBegin;
  let sliceSize: any;
  if (resolvedSize === resolvedSize) {
    sliceSize = resolvedSize < 0 ? 0 : resolvedSize;
  }

  const sliceSeq = makeSequence(collection);

  // If collection.size is undefined, the size of the realized sliceSeq is
  // unknown at this point unless the number of items to slice is 0
  sliceSeq.size =
    sliceSize === 0 ? sliceSize : (collection.size && sliceSize) || undefined;

  if (!useKeys && isSeq(collection) && sliceSize >= 0) {
    sliceSeq.get = function (this: any, index: any, notSetValue: any) {
      index = wrapIndex(this, index);
      return index >= 0 && index < sliceSize
        ? (collection as any).get(index + resolvedBegin, notSetValue)
        : notSetValue;
    };
  }

  sliceSeq.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ): any {
    if (sliceSize === 0) {
      return 0;
    }
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let skipped = 0;
    let isSkipping = true;
    let iterations = 0;
    collection.__iterate((v: any, k: any) => {
      if (!(isSkipping && (isSkipping = skipped++ < resolvedBegin))) {
        iterations++;
        return (
          fn(v, useKeys ? k : iterations - 1, this) !== false &&
          iterations !== sliceSize
        );
      }
    });
    return iterations;
  };

  sliceSeq.__iteratorUncached = function (
    this: any,
    type: any,
    reverse: any
  ): any {
    if (sliceSize !== 0 && reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    // Don't bother instantiating parent iterator if taking 0.
    if (sliceSize === 0) {
      return new Iterator(iteratorDone);
    }
    const iterator = collection.__iterator(type, reverse);
    let skipped = 0;
    let iterations = 0;
    return new Iterator(() => {
      while (skipped++ < resolvedBegin) {
        iterator.next();
      }
      if (++iterations > sliceSize) {
        return iteratorDone();
      }
      const step = iterator.next();
      if (useKeys || type === ITERATE_VALUES || step.done) {
        return step;
      }
      if (type === ITERATE_KEYS) {
        return iteratorValue(type, iterations - 1, undefined, step);
      }
      return iteratorValue(type, iterations - 1, step.value[1], step);
    });
  };

  return sliceSeq;
}

export function takeWhileFactory(
  collection: any,
  predicate: any,
  context: any
) {
  const takeSequence = makeSequence(collection);
  takeSequence.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ): any {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterations = 0;
    collection.__iterate(
      (v: any, k: any, c: any) =>
        predicate.call(context, v, k, c) && ++iterations && fn(v, k, this)
    );
    return iterations;
  };
  takeSequence.__iteratorUncached = function (
    this: any,
    type: any,
    reverse: any
  ): any {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    let iterating = true;
    return new Iterator(() => {
      if (!iterating) {
        return iteratorDone();
      }
      const step = iterator.next();
      if (step.done) {
        return step;
      }
      const entry = step.value;
      const k = entry[0];
      const v = entry[1];
      if (!predicate.call(context, v, k, this)) {
        iterating = false;
        return iteratorDone();
      }
      return type === ITERATE_ENTRIES ? step : iteratorValue(type, k, v, step);
    });
  };
  return takeSequence;
}

export function skipWhileFactory(
  collection: any,
  predicate: any,
  context: any,
  useKeys: any
) {
  const skipSequence = makeSequence(collection);
  skipSequence.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ): any {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let isSkipping = true;
    let iterations = 0;
    collection.__iterate((v: any, k: any, c: any) => {
      if (!(isSkipping && (isSkipping = predicate.call(context, v, k, c)))) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    });
    return iterations;
  };
  skipSequence.__iteratorUncached = function (
    this: any,
    type: any,
    reverse: any
  ): any {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    let skipping = true;
    let iterations = 0;
    return new Iterator(() => {
      let step;
      let k;
      let v;
      do {
        step = iterator.next();
        if (step.done) {
          if (useKeys || type === ITERATE_VALUES) {
            return step;
          }
          if (type === ITERATE_KEYS) {
            return iteratorValue(type, iterations++, undefined, step);
          }
          return iteratorValue(type, iterations++, step.value[1], step);
        }
        const entry = step.value;
        k = entry[0];
        v = entry[1];
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        skipping && (skipping = predicate.call(context, v, k, this));
      } while (skipping);
      return type === ITERATE_ENTRIES ? step : iteratorValue(type, k, v, step);
    });
  };
  return skipSequence;
}

export function flattenFactory(collection: any, depth: any, useKeys: any) {
  const flatSequence = makeSequence(collection);
  flatSequence.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ): any {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterations = 0;
    let stopped = false;
    function flatDeep(iter: any, currentDepth: any) {
      iter.__iterate((v: any, k: any) => {
        if ((!depth || currentDepth < depth) && isCollection(v)) {
          flatDeep(v, currentDepth + 1);
        } else {
          iterations++;
          if (fn(v, useKeys ? k : iterations - 1, flatSequence) === false) {
            stopped = true;
          }
        }
        return !stopped;
      }, reverse);
    }
    flatDeep(collection, 0);
    return iterations;
  };
  flatSequence.__iteratorUncached = function (
    this: any,
    type: any,
    reverse: any
  ): any {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    let iterator = collection.__iterator(type, reverse);
    const stack: Array<any> = [];
    let iterations = 0;
    return new Iterator(() => {
      while (iterator) {
        const step = iterator.next();
        if (step.done !== false) {
          iterator = stack.pop();
          continue;
        }
        let v = step.value;
        if (type === ITERATE_ENTRIES) {
          v = v[1];
        }
        if ((!depth || stack.length < depth) && isCollection(v)) {
          stack.push(iterator);
          iterator = v.__iterator(type, reverse);
        } else {
          return useKeys ? step : iteratorValue(type, iterations++, v, step);
        }
      }
      return iteratorDone();
    });
  };
  return flatSequence;
}

export function flatMapFactory(collection: any, mapper: any, context: any) {
  const coerce = collectionClass(collection) as (v: any) => any;
  return collection
    .toSeq()
    .map((v: any, k: any) => coerce(mapper.call(context, v, k, collection)))
    .flatten(true);
}

export function interposeFactory(collection: any, separator: any) {
  const interposedSequence = makeSequence(collection);
  interposedSequence.size = collection.size && collection.size * 2 - 1;
  interposedSequence.__iterateUncached = function (
    this: any,
    fn: any,
    reverse: any
  ) {
    let iterations = 0;
    collection.__iterate(
      (v: any) =>
        (!iterations || fn(separator, iterations++, this) !== false) &&
        fn(v, iterations++, this) !== false,
      reverse
    );
    return iterations;
  };
  interposedSequence.__iteratorUncached = function (type: any, reverse: any) {
    const iterator = collection.__iterator(ITERATE_VALUES, reverse);
    let iterations = 0;
    let step: any;
    return new Iterator(() => {
      if (!step || iterations % 2) {
        step = iterator.next();
        if (step.done) {
          return step;
        }
      }
      return iterations % 2
        ? iteratorValue(type, iterations++, separator)
        : iteratorValue(type, iterations++, step.value, step);
    });
  };
  return interposedSequence;
}

export function sortFactory(collection: any, comparator: any, mapper?: any) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  const isKeyedCollection = isKeyed(collection);
  let index = 0;
  const entries = collection
    .toSeq()
    .map((v: any, k: any) => [
      k,
      v,
      index++,
      mapper ? mapper(v, k, collection) : v,
    ])
    .valueSeq()
    .toArray();
  entries
    .sort((a: any, b: any) => comparator(a[3], b[3]) || a[2] - b[2])
    .forEach(
      isKeyedCollection
        ? (v: any, i: any) => {
            entries[i].length = 2;
          }
        : (v: any, i: any) => {
            entries[i] = v[1];
          }
    );
  return isKeyedCollection
    ? KeyedSeq(entries)
    : isIndexed(collection)
      ? IndexedSeq(entries)
      : SetSeq(entries);
}

export function maxFactory(collection: any, comparator: any, mapper?: any) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  if (mapper) {
    const entry = collection
      .toSeq()
      .map((v: any, k: any) => [v, mapper(v, k, collection)])
      .reduce((a: any, b: any) => (maxCompare(comparator, a[1], b[1]) ? b : a));
    return entry && entry[0];
  }
  return collection.reduce((a: any, b: any) =>
    maxCompare(comparator, a, b) ? b : a
  );
}

function maxCompare(comparator: any, a: any, b: any) {
  const comp = comparator(b, a);
  // b is considered the new max if the comparator declares them equal, but
  // they are not equal and b is in fact a nullish value.
  return (
    (comp === 0 && b !== a && (b === undefined || b === null || b !== b)) ||
    comp > 0
  );
}

export function zipWithFactory(
  keyIter: any,
  zipper: any,
  iters: any,
  zipAll?: any
) {
  const zipSequence = makeSequence(keyIter);
  const sizes = (new ArraySeq(iters) as any).map((i: any) => i.size);
  zipSequence.size = zipAll ? sizes.max() : sizes.min();
  // Note: this is a generic base implementation of __iterate in terms of
  // __iterator which may be more generically useful in the future.
  zipSequence.__iterate = function (this: any, fn: any, reverse: any) {
    /* generic:
    var iterator = this.__iterator(ITERATE_ENTRIES, reverse);
    var step;
    var iterations = 0;
    while (!(step = iterator.next()).done) {
      iterations++;
      if (fn(step.value[1], step.value[0], this) === false) {
        break;
      }
    }
    return iterations;
    */
    // indexed:
    const iterator = this.__iterator(ITERATE_VALUES, reverse);
    let step;
    let iterations = 0;
    while (!(step = iterator.next()).done) {
      if (fn(step.value, iterations++, this) === false) {
        break;
      }
    }
    return iterations;
  };
  zipSequence.__iteratorUncached = function (type: any, reverse: any) {
    const iterators = iters.map(
      // eslint-disable-next-line no-sequences
      (i: any) => ((i = Collection(i)), getIterator(reverse ? i.reverse() : i))
    );
    let iterations = 0;
    let isDone = false;
    return new Iterator(() => {
      let steps: any;
      if (!isDone) {
        steps = iterators.map((i: any) => i.next());
        isDone = zipAll
          ? steps.every((s: any) => s.done)
          : steps.some((s: any) => s.done);
      }
      if (isDone) {
        return iteratorDone();
      }
      return iteratorValue(
        type,
        iterations++,
        zipper.apply(
          null,
          steps.map((s: any) => s.value)
        )
      );
    });
  };
  return zipSequence;
}
