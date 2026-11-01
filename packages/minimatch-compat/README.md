# Patched minimatch compatibility

Several maintained ESLint plugins still call the pre-v9 CommonJS function
interface. This adapter supplies that interface and the current named exports
using the official minimatch 11.0.3 engine. It does not copy, fork or suppress an
advisory against an older matcher. The explicit npm alias prevents the adapter
from resolving itself as its own engine.

The root override keeps every consumer on this engine until the upstream
plugins migrate their interfaces. Keep the engine version pinned and retain
the matching, ESLint and package-distribution checks when updating it.

The repository uses npm's `install-links=true` setting so this local package
is packed and installed with its dependencies rather than linked to a source
directory whose dependencies have not been installed.
