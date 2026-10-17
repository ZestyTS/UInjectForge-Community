# UInjectForge Community

Public compatibility data, report intake and stable-update metadata. This is a
standalone public repository, NOT the private UInjectForge application repository.
Intended repository: `ZestyTS/UInjectForge-Community`.

No application source, private Git history, game assets, support bundles, licenses,
ROMs, emulator binaries, keys or user data belong here. The app icon is UIF branding.

## Local use

Node 22+; no packages or install step:

```
node --test tests/*.test.mjs
node tools/validate.mjs
node tools/serve.mjs
```

Open http://127.0.0.1:4176. This is the real registry, not a marketing landing page.
The initial dataset is deliberately empty. Do not turn old third-party lists or
untested builds into UIF success reports. External references remain links until
their reuse license, attribution and non-UIF scope are separately established.

## Reports

In UIF: Settings > Inject History, select a build, rate it, enter environment,
region/revision and the specific checks actually performed, then export. Open the
site's Submit section, choose that JSON and review it. Manual entry is also
available, explicitly without captured runtime evidence. No upload happens until
the user consents and chooses Submit for review. The optional GitHub issue form
is no longer the intended primary submission route.

The public no-account intake uses a separate Worker and D1 database in the project
owner's Cloudflare account at https://uinjectforge-community-reports.i-wo.workers.dev . New reports enter
a private review queue and receive a status receipt. Reviewer sign-in is at
https://uinjectforge-community-reports.i-wo.workers.dev/review and uses GitHub
public identity only. Submitters need no account. Only the configured reviewer
can publish or remove reports; there is no automatic publication. Deployment and
the two separate secret bindings are documented in [worker/README.md](worker/README.md).

`site/config.mjs` enables intake after deployment and anonymous read/write,
moderation-isolation and forged-identity checks. If intake must be disabled,
saving reports and the optional GitHub route still work, and the website clearly
states that online submission is unavailable. No runtime secret, reviewer email,
or write token belongs in this repository.

Reports retain exact UIF informational versions, base IDs, scalar build options,
original/packaged runtime SHA-256 and configuration hashes where recorded.
Settings not explicitly captured are UNKNOWN, not defaults. SHA-256 replaces the
suggested MD5 as the primary identity. It is not proof of authenticity or causation.
The game identifier in older history can be a UIF build name, not a cartridge/disc
header. Region and revision are explicit reporter observations. No ROM rescans or
multi-gigabyte hashing occur on export. Older history has no invented runtime hash.

The outcome is one reporter's observation. Individual boot/control/audio/video/
save/manual checks remain Not tested unless explicitly selected. A report with
missing evidence is still useful, but cannot establish an exact runtime match.

## Browsing and receipts

Filters, sorting, and page selection are included in shareable links. Individual
reports also have permanent links. Results are paged in groups of 25; the download
button saves every matching report, not only the visible page. If a source fails,
the site labels the results as incomplete or unavailable and offers a retry.

Import and manual entry are separate modes. Imported build identity stays locked;
manual entries default to an unknown console environment. The form freezes during
submission, preserving the report snapshot being sent. Stop waiting cancels the
browser request, not a submission the server may already have received. Retrying
identical contents returns the same receipt rather than creating another report.

After submitting, save the private receipt or copy its status link. Status lookup
is available on the community site without signing in. Links carry the receipt in
the URL fragment; lookup then sends it explicitly to the report service. Status
reveals only review state, never pending report contents. Receipts and drafts are
not automatically stored between visits. Save report is a local export and does
not submit anything. Creating a new draft preserves the last receipt in memory.

## Human review and publication

Check privacy, actual UIF version, source/base identity, evidence scope and whether
notes match the reported checks. Ask for clarification rather than guessing.
Keep contradictory results as separate reports. Do not silently overwrite a failure.
Review means checked metadata/provenance, NOT independently reproduced hardware.
Never execute files or commands attached to an issue.

Save only the compatibility JSON to a local temporary file, then:

```
node tools/review.mjs report.json https://github.com/ZestyTS/UInjectForge-Community/issues/123 maintainer
node --test tests/*.test.mjs
node tools/validate.mjs
```

The no-account service stores new reports privately, deduplicates retries, and
returns a receipt. Only its configured reviewer, authenticated with GitHub and
checked against an immutable account ID, can publish/remove results at `/review`. The public registry merges
approved service reports with the reviewed GitHub JSON file, preserving distinct
build evidence. Signed expiring one-use browser verification, bounded requests,
strict schemas, intake limits and moderation reduce abuse; they do not eliminate
it. Pending/rejected records older than 90 days are pruned during later intake or
review activity. Rejected contents are erased immediately from active storage.

For GitHub submissions, review the diff in a pull request. No issue-triggered
privileged write workflow is included. The public site uses safe text rendering.
Set Pages source to GitHub Actions. Reviewed pushes to main deploy the site;
pull requests validate without deploying. The workflow can also be run manually.
Do not enable Pages on the private application repository or publish its docs folder.

## Updates

`site/updates/stable.json` is generated during Pages publication. It points to the
official itch.io product, so paid and Demo users are not sent to private GitHub
releases. Nobody needs to edit the JSON to announce a new version.
UIF checks this small document only after the user enables launch checks or clicks
Check for updates. It never downloads or installs an executable.

To publish a stable update:

1. Finish release acceptance and make the actual installers available on itch.io.
2. In this public repository, publish a non-draft, non-prerelease GitHub Release
   tagged `v1.0.6` (use the actual version). Add the public release notes and itch.io
   link, and select Set as latest release. Installers and private source stay out
   of this repository. Publishing this announcement is the single notification step.
3. The existing Pages workflow runs tests, reads that published announcement,
   generates the update feed, and deploys the website. The footer shows the same
   stable version. Check that the Actions run succeeds before calling it complete.

Every later website push also regenerates from the latest stable announcement,
so ordinary site updates cannot accidentally restore an old checked-in feed.
The checked-in 1.0.5 JSON is only the initial baseline for the period before the
first public stable announcement. Drafts, prereleases, private-repository releases,
and version numbers from a development build never promote the feed. Failed API
requests stop publication instead of pretending no release exists. A lower version
than the deployed feed is refused. No workflow writes commits or needs repo-write
credentials; GitHub supplies a read-only token for reading public release metadata.

Use Actions > Validate and publish public community site > Run workflow to retry
or resynchronize. Provenance is retained in its `release-metadata-provenance`
artifact. The automation cannot verify paid itch.io downloads; the maintainer must
complete step 1 before publishing the announcement. No 1.0.6 announcement is
created by the implementation or its tests.

The intended public URL is https://zestyts.github.io/UInjectForge-Community/.
If the owner selects another repository/host, change the public URLs in the app,
registry validator, issue template/review tooling and documentation together.

Pages activation is a separate repository setting. The intended URL is live only
after the Pages workflow completes successfully.
