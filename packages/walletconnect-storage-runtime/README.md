# WalletConnect storage runtime

`@walletconnect/keyvaluestorage@1.1.1` imports the `unstorage` core in the browser and the core and `fs-lite` driver on Node. The local package contains those entry points and their relative imports from the published `unstorage@1.17.5` tarball. The upstream license is included. The npm tarball URL and SHA-512 integrity are in `package.json`.

This preserves the existing IndexedDB and filesystem formats. The separate filesystem watcher in the upstream distribution depends on `anymatch` and `picomatch`. WalletConnect uses its own IndexedDB driver and the lightweight Node filesystem driver, so neither watcher package is a production dependency of this adapter.

When updating WalletConnect, check its browser and Node imports, verify the upstream tarball integrity, and compare the shipped entry points against their original bytes. Exercise reopening, updating and removing pre-existing entries in both stores.
