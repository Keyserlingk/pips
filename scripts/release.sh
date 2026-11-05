#!/usr/bin/env bash
# Publishes a release of the Android app: tags main on GitHub and creates the
# release; the "Test and build Android app" workflow then tests, builds and
# signs the APK and attaches it (about 4 minutes). This script waits for that
# and reports where the APK is.
#
#   scripts/release.sh 1.2               release notes from the commits since the last release
#   scripts/release.sh 1.2 notes.md      your own release notes
#   scripts/release.sh 1.2 --dry-run     show what would happen, change nothing
set -euo pipefail

usage() { sed -n '7,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

version="${1:-}"
notes_file=""
dry_run=false
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    -*) usage ;;
    *) notes_file="$arg" ;;
  esac
done

# Plain numbers only: the app's update check ignores anything else.
[[ "$version" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "Give a version like 1.2 (numbers only, no 'v')."; usage; }
tag="v$version"
cd "$(git rev-parse --show-toplevel)"

fail() { echo "✗ $*" >&2; exit 1; }

# Checks: the release is built from main as it is on GitHub, so that must be what you have here.
[[ "$(git branch --show-current)" == main ]] || fail "Switch to main first."
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "You have uncommitted changes. Commit or stash them first."
git fetch --quiet --tags origin
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "$tag already exists."
ahead=$(git rev-list --count origin/main..main)
behind=$(git rev-list --count main..origin/main)
((behind == 0)) || fail "GitHub has $behind commit(s) you don't have. Run git pull first."
[[ -z "$notes_file" || -f "$notes_file" ]] || fail "Notes file not found: $notes_file"

previous=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [[ -n "$previous" ]]; then
  newest=$(printf '%s\n%s\n' "$previous" "$tag" | sort -V | tail -1)
  [[ "$newest" == "$tag" ]] || fail "$tag isn't newer than $previous: phones wouldn't see it as an update."
fi

# Release notes: yours, or the commit titles since the last release.
notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
if [[ -n "$notes_file" ]]; then
  cp "$notes_file" "$notes"
else
  {
    echo "**Install:** download \`pips-$version.apk\` below on your Android phone and open it. It installs over the previous version and keeps your progress."
    echo
    echo "**Changes${previous:+ since $previous}**"
    git log --no-merges --format='- %s' ${previous:+"$previous"..}main
  } >"$notes"
fi

echo "Release $tag from main ($(git rev-parse --short main))${previous:+, previous release $previous}"
((ahead > 0)) && echo "Will first push $ahead commit(s) to GitHub."
echo "--- release notes ---"
cat "$notes"
echo "---------------------"
if $dry_run; then
  echo "Dry run: nothing pushed or published."
  exit 0
fi
read -r -p "Publish $tag? [y/N] " answer
[[ "$answer" == [yY]* ]] || { echo "Cancelled."; exit 1; }

((ahead > 0)) && git push --quiet origin main
gh release create "$tag" --target main --title "Pips for Android $version" --notes-file "$notes" >/dev/null
echo "✓ Published $tag. Waiting for the APK to be built (about 4 minutes)…"

# The release starts a workflow run; find it, then follow it to the end.
run=""
for _ in $(seq 1 30); do
  run=$(gh run list --workflow android.yml --event release --branch "$tag" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
  [[ -n "$run" ]] && break
  sleep 5
done
[[ -n "$run" ]] || fail "Couldn't find the build. Check https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions"

if gh run watch "$run" --exit-status --interval 15 >/dev/null; then
  echo "✓ pips-$version.apk is attached: $(gh release view "$tag" --json url -q .url)"
  echo "  Phones on an earlier version will offer the update within about a day."
else
  echo "✗ The build failed, so the release has no APK yet: $(gh run view "$run" --json url -q .url)" >&2
  echo "  Fix the problem, then re-run the failed build from that page; it attaches the APK when it passes." >&2
  exit 1
fi
