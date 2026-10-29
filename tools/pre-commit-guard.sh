#!/bin/sh
# Pre-commit guard: blocks commits that would add real data to this public repo.
# Install once per clone:  ln -sf ../../tools/pre-commit-guard.sh .git/hooks/pre-commit
# Rejects (1) any staged file whose name contains REAL-DATA / real-data (any case), and
#         (2) any staged file containing a saved-data block from "Save with data".
fail=0
names=$(git diff --cached --name-only --diff-filter=ACMR)
bad=$(printf '%s\n' "$names" | grep -i 'real-data')
if [ -n "$bad" ]; then
  echo "BLOCKED: these files look like real-data exports and must not be committed:" >&2
  printf '  %s\n' $bad >&2; fail=1
fi
for f in $names; do
  if git show ":$f" 2>/dev/null | grep -Eq '<script id="safety''Saved" type="application/json">\{"v":'; then
    echo "BLOCKED: $f contains an embedded data block (saved with data)." >&2; fail=1
  fi
done
[ $fail -eq 0 ] || { echo "Commit aborted. Keep real data only in the restricted SharePoint folder." >&2; exit 1; }
exit 0
