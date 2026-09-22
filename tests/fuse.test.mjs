import test from 'node:test';
import assert from 'node:assert/strict';
import Fuse from '../assets/js/vendor/fuse.mjs';

for (const length of [31, 32, 33]) {
  test(`Fuse handles a ${length}-character query without legacy substr`, () => {
    const target = '클라우드 인프라 네트워크 검색 abc '.repeat(10).slice(0, length);
    const legacy = String.prototype.substr;
    String.prototype.substr = undefined;
    try {
      const engine = new Fuse([{ title: target }, { title: 'ZZZZ' }], { keys: ['title'], threshold: 0 });
      const matches = engine.search(target);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].item.title, target);
    } finally {
      String.prototype.substr = legacy;
    }
  });
}
