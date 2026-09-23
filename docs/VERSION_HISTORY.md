# Version history and tag provenance

<!-- generated-by: starmade-version-regularization-20260923 -->

Reconciled and independently re-read from GitHub on 23 September 2026.
Reviewed main snapshot: `8707f2293f8b389e044f68cfb9fb01b635db8886`.

## Verified stable versions

| Tag | Target commit | Package version | Provenance |
| --- | --- | --- | --- |
| v1.0.0 | [277f5181e95f](https://github.com/blackcancer/StarMade-Decoder/commit/277f5181e95f14fbb708ed6699eaa0ab6aefe1da) | 1.0.0 | exact historical commit |
| v1.1.0 | [a2def7106c7d](https://github.com/blackcancer/StarMade-Decoder/commit/a2def7106c7dc842b1c379dda864eb5f1c62695a) | 1.1.0 | metadata-only historical reconstruction |
| v1.2.0 | [143fd646c411](https://github.com/blackcancer/StarMade-Decoder/commit/143fd646c41152ba1f4a13d620597616edec5cc2) | 1.2.0 | exact historical commit |
| v1.3.0 | [5a34b5ae89c9](https://github.com/blackcancer/StarMade-Decoder/commit/5a34b5ae89c921b84f729ce767429c9f06b7921a) | 1.3.0 | exact historical commit |
| v1.4.0 | [93496c33e84b](https://github.com/blackcancer/StarMade-Decoder/commit/93496c33e84b71e568a8a0792485d4ec58c629eb) | 1.4.0 | exact historical commit |
| v2.0.0 | [4cb21bd72258](https://github.com/blackcancer/StarMade-Decoder/commit/4cb21bd72258c87eb8115f90449a8334c34658a6) | 2.0.0 | exact historical commit |
| v2.0.1 | [ed9d3becdb13](https://github.com/blackcancer/StarMade-Decoder/commit/ed9d3becdb139eaf665c27a23c6ef3ef60d687d9) | 2.0.1 | exact historical commit |
| v2.0.2 | [8707f2293f8b](https://github.com/blackcancer/StarMade-Decoder/commit/8707f2293f8b389e044f68cfb9fb01b635db8886) | 2.0.2 | exact historical commit |

## Historical exceptions

### v1.1.0

The changelog identifies these network UTF helpers as 1.1.0, but the historical implementation commit kept package.json at 1.0.0. This archival reconstruction changes root package and lockfile version metadata only; runtime source, dependencies and the original commit are preserved.

Original code: `096d0cbb40663c2cefd90aaabb69bf263dd4b525`; original manifest: `1.0.0`. Only root version metadata in package.json and any existing npm lockfile was normalized on a separate archival commit. Runtime sources and dependency definitions are unchanged; the original commit was not modified.

## Reconciliation result
- 6 missing annotated tags created in this run.
- 7 missing source-only release records created in this run.
- Every pre-existing tag object SHA was preserved and checked against the remote.
- Every listed tag target and release record was re-read after publication.
- Historical application test suites were not rerun; no compiled distribution assets were rebuilt.
- Release records explicitly distinguish source snapshots from installable release packages.

Development candidates are not promoted to stable releases by this operation. No StarMade-Open version number is invented. Future stable releases should keep the tag, package.json and root lockfile version aligned; published tags must not be silently moved.

## Execution receipt
[Repository-scoped reconciliation run](https://github.com/blackcancer/StarMade-Decoder/actions/runs/35862312478).
