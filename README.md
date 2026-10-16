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

The public no-account intake uses a separate persistent Sites/Cloudflare D1
service. `site/config.mjs` keeps it disabled until deployment and anonymous
read/write/moderation-isolation checks pass. While disabled, saving reports and
the optional GitHub route work; the website must not claim that it accepted an
online submission. No runtime secret, reviewer email, or write token belongs here.

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
returns a receipt. Only its configured reviewer, authenticated by the hosting
platform, can publish/remove results at `/review`. The public registry merges
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

`site/updates/stable.json` points to the official itch.io product, so paid and Demo
users are not sent to private GitHub releases. Advance `version` only when that
stable release is actually available. Do not advertise 1.0.6 while still testing.
UIF checks this small document only after the user enables launch checks or clicks
Check for updates. It never downloads or installs an executable.

The intended public URL is https://zestyts.github.io/UInjectForge-Community/.
If the owner selects another repository/host, change the public URLs in the app,
registry validator, issue template/review tooling and documentation together.

Pages activation is a separate repository setting. The intended URL is live only
after the Pages workflow completes successfully.
