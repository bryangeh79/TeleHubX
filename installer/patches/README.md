# Patch metadata (vmfix30+)

> Per-release metadata for the **Tier 2 patch zip** mechanism.
>
> Each `vmfixNN.json` here describes one patch release:
> - Acceptable source versions (`fromVersions`)
> - Target version (`toVersion`)
> - SQL hotfixes to run after files are swapped (`postPatchSql`)
> - Release notes (`releaseNotes`)
>
> `installer/scripts/build-patch.ps1` reads this + the freshly built `installer/dist/`
> and produces `installer/Output/TeleHubX-Patch-{from}-to-{to}.zip` (~5-10 MB).
>
> Tenants run `Apply-Patch.ps1` (installed at `C:\Program Files\TeleHubX\tools\Apply-Patch.ps1`)
> pointing at the downloaded zip. The script:
> 1. Verifies zip SHA256 against the user-supplied `.sha256` sidecar
> 2. Reads `patch-manifest.json` inside the zip
> 3. Checks current installed version is in `fromVersions`
> 4. Backs up current `apps/*/dist/` + `tools/telehubx-supervisor.exe` to `data/patches-backup/<timestamp>/`
> 5. Stops `TeleHubX` Windows service
> 6. Unzips payload over `C:\Program Files\TeleHubX\`
> 7. Runs each `postPatchSql` statement against the local Postgres
> 8. Starts service back; waits for `/health` to return ok
> 9. Writes `VERSION.txt` to new version
> 10. On any failure → roll back from backup → restart service → report

## Schema (v1)

```jsonc
{
  "schemaVersion": 1,
  "patchId": "vmfix29.1-to-vmfix30",
  "fromVersions": ["vmfix29.1", "vmfix29"],
  "toVersion": "vmfix30",
  "buildAt": "<ISO 8601 UTC>",
  "payload": [
    "apps/server/dist/",
    "apps/agent/dist/",
    "apps/dashboard/dist/",
    "tools/telehubx-supervisor.exe"
  ],
  "postPatchSql": [
    "UPDATE chat_scripts SET status='active' WHERE status='draft' AND \"packId\" IS NULL"
  ],
  "releaseNotes": "Free-text shown by Apply-Patch.ps1 before applying"
}
```

`payload` lists the directories/files in the zip's `payload/` root. Apply-Patch walks each entry and copies recursively over `C:\Program Files\TeleHubX\`. Anything NOT listed in `payload` is left untouched (runtime/, vendor/, etc. — that's the whole point of a patch).
