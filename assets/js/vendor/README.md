# Fuse.js 7.5.0

Source: `package/dist/fuse.basic.mjs` from the official npm tarball
`https://registry.npmjs.org/fuse.js/-/fuse.js-7.5.0.tgz`.

The tarball was verified against npm's published integrity:
`sha512-sQtrEfA+ez/3G0cCZecF70oqpCRttCexYUG4mUrtWL49ULUzUyxokt5kyqwtKzj1270RaKih+hcP3qLcumccow==`.

License: Apache-2.0, preserved in `FUSE-LICENSE` and the source header.

Two local modernizations replace the remaining deprecated `String.substr` calls
in BitapSearch's chunk constructor:

```diff
- addChunk(this.pattern.substr(i, 32), i);
+ addChunk(this.pattern.slice(i, i + 32), i);
- addChunk(this.pattern.substr(startIndex), startIndex);
+ addChunk(this.pattern.slice(startIndex), startIndex);
```

Both offsets are nonnegative. The first chunk uses a length of 32, while the
second runs to the end; the replacements preserve these semantics. No other
upstream behavior is changed. Hugo bundles this ESM dependency only on the search
page, without a Node package-install step or runtime CDN dependency.

On update, verify the npm tarball integrity, retain the license, review whether
the two changes are still necessary, and run the complete test suite including
long-query search checks. Do not overwrite this source blindly.
