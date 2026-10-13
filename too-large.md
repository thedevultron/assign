# Excluded Artifacts

Files excluded from version control because they are large binaries or regenerable artifacts.

| File name | Exact size in bytes (and MB) | Exact full path | Importance assessment |
|---|---|---|---|
| cloudflared | 40,129,756 bytes (≈38.27 MB) | `C:\Users\Amir\assign\bin\cloudflared` | Not required to build or run the project. Third-party executable (Cloudflare Tunnel CLI) used locally to expose the dev server. Regenerable: re-download from Cloudflare releases (`https://github.com/cloudflare/cloudflared/releases`) or install via a package manager (`winget install Cloudflare.cloudflared`). Excluded via `bin/` in `.gitignore`. |

Note: no repository files met the 50 MB (52,428,800 bytes) hard-limit threshold; the above is excluded as a binary artifact.
