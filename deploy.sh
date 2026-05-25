#!/usr/bin/env bash
# deploy.sh — build / package / release helper for ReadWrite
#
# Usage:
#   ./deploy.sh                          Build for the current host platform
#   ./deploy.sh mac                      Build a macOS .dmg (must run on macOS)
#   ./deploy.sh win                      Build a Windows installer (cross-builds via Wine on mac/linux if available)
#   ./deploy.sh linux                    Build Linux AppImage + .deb (must run on Linux)
#   ./deploy.sh all                      Build everything for the current host (cross-platform if tooling is present)
#
#   ./deploy.sh release                  Cut a patch release (auto-bump from package.json)
#   ./deploy.sh release patch            Same — explicit (0.1.0 → 0.1.1)
#   ./deploy.sh release minor            Bump minor (0.1.0 → 0.2.0)
#   ./deploy.sh release major            Bump major (0.1.0 → 1.0.0)
#   ./deploy.sh release 0.1.0            Cut an explicit version (same as package.json works too — publishes
#                                        the current state without bumping)
#                                        End-to-end: bumps package.json, regenerates the CHANGELOG section
#                                        from `git log <last-tag>..HEAD`, commits, tags, pushes, triggers
#                                        the three-OS GitHub Actions matrix.
#
#   ./deploy.sh upload-mac               Build the mac .dmg locally and upload it to the existing GitHub
#   ./deploy.sh upload-mac 0.1.11        Release for v<version> (defaults to package.json). Use this when CI
#                                        failed and you want to fill in the mac artifacts by hand. Creates the
#                                        release if it doesn't exist yet.
#
# Env:
#   SKIP_CHECKS=1                        Skip typecheck/lint/test before packaging
#   YES=1                                Skip the "Continue? [y/N]" prompt on release
#   UPLOAD_MAC=1                         On `release`, also build the mac .dmg locally and upload it to the
#                                        GitHub Release (don't wait for CI's macos-latest job)

set -euo pipefail

cd "$(dirname "$0")"

usage() {
  sed -n '/^# Usage:/,/^# Env:/p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

run_checks() {
  if [ "${SKIP_CHECKS:-0}" = "1" ]; then
    echo "==> Skipping checks (SKIP_CHECKS=1)"
    return
  fi
  echo "==> typecheck"
  pnpm typecheck
  echo "==> lint"
  pnpm lint
  echo "==> test"
  pnpm test
}

ensure_pnpm_install() {
  if [ ! -d node_modules ]; then
    echo "==> pnpm install"
    pnpm install --frozen-lockfile
  fi
}

build_mac() {
  if [ "$(uname)" != "Darwin" ]; then
    echo "ERROR: Building macOS distributables requires running on macOS." >&2
    exit 1
  fi
  pnpm dist:mac
}

build_win() {
  if [ "$(uname)" = "Linux" ] || [ "$(uname)" = "Darwin" ]; then
    if ! command -v wine >/dev/null 2>&1; then
      cat >&2 <<'EOF'
ERROR: Building Windows installers from macOS / Linux requires Wine.
       Install via:
         macOS:  brew install --cask --no-quarantine wine-stable
         Linux:  apt install wine
       Or use:   ./deploy.sh release <version>
                 — that triggers a GitHub Actions matrix that builds
                 mac/win/linux natively on cloud runners.
EOF
      exit 1
    fi
  fi
  pnpm dist:win
}

build_linux() {
  if [ "$(uname)" != "Linux" ]; then
    echo "WARNING: Building Linux distributables natively works best on Linux." >&2
    echo "         Falling through to electron-builder (will use the host's tools)." >&2
  fi
  pnpm dist:linux
}

build_current() {
  case "$(uname)" in
    Darwin)  build_mac ;;
    Linux)   build_linux ;;
    *)       echo "Unsupported host: $(uname)"; exit 1 ;;
  esac
}

build_all() {
  case "$(uname)" in
    Darwin)
      build_mac
      build_win  # requires Wine; deploy.sh will tell the user if missing
      ;;
    Linux)
      build_linux
      build_win
      ;;
    *)
      echo "Use ./deploy.sh release <version> for cross-platform builds via CI." >&2
      exit 1
      ;;
  esac
}

extract_changelog_notes() {
  # Print the CHANGELOG.md body for <version> — everything between its
  # `## [<version>] — <date>` heading and the next `## [` heading.
  local version="$1"
  awk -v ver="$version" '
    $0 ~ ("^## \\[" ver "\\]") { grab = 1; next }
    grab && /^## \[/ { exit }
    grab { print }
  ' CHANGELOG.md
}

upload_mac_release() {
  # upload_mac_release <version>
  # Build the mac .dmg locally and upload it (plus blockmaps + the
  # latest-mac.yml auto-update manifest) to the GitHub Release for v<version>,
  # creating the release first if CI hasn't produced it yet.
  local version="$1"
  local tag="v${version}"

  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: 'gh' CLI not found — install it to upload (brew install gh)." >&2
    exit 1
  fi

  build_mac

  local out_dir="release/${version}"
  # electron-builder emits both DMGs, their blockmaps, and latest-mac.yml here.
  local assets=()
  local f
  for f in \
    "${out_dir}/ReadWrite-${version}-x64.dmg" \
    "${out_dir}/ReadWrite-${version}-x64.dmg.blockmap" \
    "${out_dir}/ReadWrite-${version}-arm64.dmg" \
    "${out_dir}/ReadWrite-${version}-arm64.dmg.blockmap" \
    "${out_dir}/latest-mac.yml"; do
    [ -f "$f" ] && assets+=("$f")
  done

  if [ "${#assets[@]}" -eq 0 ]; then
    echo "ERROR: No mac artifacts found in ${out_dir} after build." >&2
    exit 1
  fi

  if gh release view "$tag" >/dev/null 2>&1; then
    echo "==> Uploading mac artifacts to existing release $tag (--clobber)"
    gh release upload "$tag" "${assets[@]}" --clobber
  else
    echo "==> Release $tag not found — creating it"
    local notes_file
    notes_file=$(mktemp)
    extract_changelog_notes "$version" >"$notes_file" || true
    if [ -s "$notes_file" ]; then
      gh release create "$tag" "${assets[@]}" --title "ReadWrite $version" --notes-file "$notes_file"
    else
      gh release create "$tag" "${assets[@]}" --title "ReadWrite $version" --generate-notes
    fi
    rm -f "$notes_file"
  fi

  echo "✅ Uploaded mac artifacts to https://github.com/everettjf/ReadWrite/releases/tag/$tag"
}

bump_semver() {
  # bump_semver <current> <patch|minor|major> → echoes new version
  local v="$1"
  local kind="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<<"${v%%-*}"
  case "$kind" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) echo "ERROR: bump kind must be patch / minor / major" >&2; exit 1 ;;
  esac
  echo "${major}.${minor}.${patch}"
}

release_tag() {
  local arg="${1:-patch}"
  local version

  # Resolve `patch` / `minor` / `major` against package.json, or take an
  # explicit semver verbatim.
  if [[ "$arg" =~ ^(patch|minor|major)$ ]]; then
    local current
    current=$(node -p "require('./package.json').version")
    version=$(bump_semver "$current" "$arg")
    echo "==> Auto-bump ($arg): $current → $version"
  elif [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
    version="$arg"
  else
    echo "ERROR: Pass 'patch', 'minor', 'major', or an explicit version like 0.2.0." >&2
    exit 1
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: Working tree is dirty. Commit or stash before releasing." >&2
    exit 1
  fi

  local tag="v${version}"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "ERROR: Tag $tag already exists." >&2
    exit 1
  fi

  local current_version
  current_version=$(node -p "require('./package.json').version")
  local same_version=0
  if [ "$current_version" = "$version" ]; then
    same_version=1
  fi

  local last_tag
  last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

  local commit_count
  if [ -n "$last_tag" ]; then
    commit_count=$(git rev-list "${last_tag}..HEAD" --count)
  else
    commit_count=$(git rev-list HEAD --count)
  fi

  if [ "$commit_count" = "0" ]; then
    echo "ERROR: No commits since ${last_tag:-the start of history} — nothing to release." >&2
    exit 1
  fi

  echo
  echo "==> Plan"
  echo "    Version:       $version"
  echo "    Tag:           $tag"
  echo "    Previous tag:  ${last_tag:-(none)}"
  echo "    Commits:       $commit_count"
  echo

  if [ "${YES:-0}" != "1" ] && [ -t 0 ]; then
    read -r -p "Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy] ]]; then
      echo "Aborted."
      exit 0
    fi
  fi

  ensure_pnpm_install
  run_checks

  if [ "$same_version" = "1" ]; then
    echo "==> package.json already at $version — skipping bump"
  else
    echo "==> Bumping package.json to $version"
    pnpm version "$version" --no-git-tag-version >/dev/null
  fi

  echo "==> Generating CHANGELOG entry"
  node scripts/cut-changelog.mjs "$version" >/dev/null

  echo "==> Committing version bump + changelog"
  git add package.json CHANGELOG.md
  if git diff --cached --quiet; then
    echo "    (no file changes — nothing to commit; proceeding straight to tag)"
  else
    git commit -m "chore: cut v${version}" >/dev/null
    git push origin HEAD >/dev/null
  fi

  echo "==> Creating tag $tag and pushing"
  git tag -a "$tag" -m "Release $version"
  git push origin "$tag" >/dev/null

  if [ "${UPLOAD_MAC:-0}" = "1" ]; then
    echo
    echo "==> UPLOAD_MAC=1 — building and uploading the mac .dmg locally"
    upload_mac_release "$version"
  fi

  cat <<EOF

✅ Released $tag

The GitHub Actions release workflow will now:
  1. Build .dmg on macos-latest
  2. Build NSIS installer on windows-latest
  3. Build AppImage + .deb on ubuntu-latest
  4. Upload all artifacts to a new GitHub Release at:
     https://github.com/everettjf/ReadWrite/releases/tag/$tag

Track progress:
  https://github.com/everettjf/ReadWrite/actions
EOF
}

main() {
  local cmd="${1:-current}"
  shift || true

  case "$cmd" in
    -h|--help|help)
      usage 0
      ;;
    current)
      ensure_pnpm_install
      run_checks
      build_current
      ;;
    mac)
      ensure_pnpm_install
      run_checks
      build_mac
      ;;
    win|windows)
      ensure_pnpm_install
      run_checks
      build_win
      ;;
    linux)
      ensure_pnpm_install
      run_checks
      build_linux
      ;;
    all)
      ensure_pnpm_install
      run_checks
      build_all
      ;;
    release)
      release_tag "$@"
      ;;
    upload-mac)
      ensure_pnpm_install
      local v="${1:-$(node -p "require('./package.json').version")}"
      upload_mac_release "$v"
      ;;
    *)
      echo "ERROR: Unknown command: $cmd" >&2
      usage 1
      ;;
  esac
}

main "$@"
