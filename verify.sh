#!/usr/bin/env bash
# Verification for the alexa-plus entry: doc-stage structural checks (root files exist,
# LICENSE is MIT, README and the submission write-up cover the checklist, no TODO/TBD
# placeholders), then the server's and the client's own lint and test suites.
# Kept compatible with the bash 3.2 that ships on macOS: no mapfile, no negative
# array indices.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

fail() { echo "ERROR: $1" >&2; exit 1; }

# bin/publish.sh leaves SPEC.md out of the public repo, so the spec checks run only inside
# the monorepo; the published copy still runs the README gate, the tests and lint.
in_monorepo=false
[ -f ../../bin/publish.sh ] && [ -f ../../bin/verify.sh ] && in_monorepo=true

echo "== entry root files =="
for f in README.md LICENSE; do
  [ -f "$f" ] || fail "$f is missing from the entry root"
  echo "  ok: $f"
done

echo "== LICENSE is MIT and visible =="
grep -q '^MIT License' LICENSE || fail "LICENSE is not the MIT licence text"

# Every rule item on the hackathon's submission checklist; docs/submission.md must answer
# each one.
items=(
  "Text description"
  "Public GitHub repository"
  "open-source license"
  "Demo video"
  "Product feedback"
  "Track and mini-challenge selections"
  "Alexa+"
  "MCP"
  "OAuth"
  "English"
  "fictional or masked data"
  "setup and installation"
  "security"
  "No secrets"
)

if [ "$in_monorepo" = true ]; then
  [ -f SPEC.md ] || fail "SPEC.md is missing from the entry root"
  echo "  ok: SPEC.md"

  echo "== SPEC.md sections, in required order =="
  expected=(
    "1. Customer Confusion"
    "2. Concept"
    "3. Tools & Features"
    "4. Data Model"
    "5. Demo Script"
    "6. Stack Pin"
    "7. File Layout"
    "8. Test Plan"
    "9. Mini-challenges"
    "10. Planner"
    "11. Submission Checklist"
  )

  found=()
  while IFS= read -r line; do
    found+=("$line")
  done < <(grep -E '^## ' SPEC.md)

  [ "${#found[@]}" -eq "${#expected[@]}" ] ||
    fail "SPEC.md has ${#found[@]} top-level sections, expected ${#expected[@]}"

  i=0
  while [ "$i" -lt "${#expected[@]}" ]; do
    case "${found[$i]}" in
      "## ${expected[$i]}"*) echo "  ok: ${expected[$i]}" ;;
      *) fail "section $((i + 1)) is '${found[$i]}', expected '## ${expected[$i]}'" ;;
    esac
    i=$((i + 1))
  done

  echo "== the submission checklist is the final section =="
  last="${found[$((${#found[@]} - 1))]}"
  [ "$last" = "## 11. Submission Checklist" ] ||
    fail "the last section of SPEC.md is '$last', not the submission checklist"

  echo "== the submission checklist covers every rule from the hackathon =="
  for item in "${items[@]}"; do
    grep -qi -- "$item" SPEC.md || fail "the submission checklist does not mention: $item"
    echo "  ok: $item"
  done
fi

echo "== no unresolved placeholders =="
placeholder_files=(README.md)
[ "$in_monorepo" = true ] && placeholder_files+=(SPEC.md)
if grep -nE 'TODO|TBD' "${placeholder_files[@]}"; then
  fail "${placeholder_files[*]} still contains a placeholder"
fi

echo "== submission deliverables exist =="
for f in docs/architecture.md docs/architecture-1.svg docs/architecture-2.svg \
         docs/submission.md docs/feedback.md docs/friction-log.md docs/video-script.md; do
  [ -f "$f" ] || fail "$f is missing"
  echo "  ok: $f"
done

echo "== every architecture diagram is exported as an image =="
diagrams=$(grep -c '^```mermaid' docs/architecture.md)
svgs=$(ls docs/architecture-*.svg | wc -l | tr -d ' ')
[ "$diagrams" -eq "$svgs" ] ||
  fail "docs/architecture.md has $diagrams mermaid diagram(s) but $svgs exported SVG(s) — re-run: npx -y @mermaid-js/mermaid-cli@11.17.0 -i docs/architecture.md -o docs/architecture.svg"
echo "  ok: $diagrams diagram(s), $svgs SVG(s)"

echo "== LICENSE names a copyright holder =="
grep -qE '^Copyright \(c\) [0-9]{4} +[^ ]' LICENSE ||
  fail "LICENSE carries a year but no copyright holder — an unattributed licence is not a usable open-source licence"

echo "== README names the LICENSE and links the submission docs =="
for link in LICENSE docs/architecture.md docs/submission.md; do
  grep -qF "$link" README.md || fail "README.md never references $link"
  echo "  ok: $link"
done

echo "== README has every section the submission checklist depends on =="
readme_sections=(
  "## Setup"
  "## Run"
  "## Test"
  "## Lint"
  "## Demo walkthrough"
  "## Known limitations"
  "## Privacy and security notes"
  "## License"
)
for s in "${readme_sections[@]}"; do
  grep -qF -- "$s" README.md || fail "README.md is missing the section: $s"
  echo "  ok: $s"
done

echo "== the submission write-up answers every checklist item =="
for item in "${items[@]}"; do
  grep -qi -- "$item" docs/submission.md || fail "docs/submission.md does not address: $item"
  echo "  ok: $item"
done

echo "== server: install dependencies =="
if [ ! -d node_modules ]; then
  npm install
fi

echo "== server: lint =="
npm run lint

echo "== server: conformance tests =="
npm test

echo "== client: imports nothing from server/ =="
if grep -rnE "(from ['\"]|require\(['\"])([./]*server/)" client \
  --include="*.js" --include="*.jsx" --include="*.html" 2>/dev/null; then
  fail "client/ has an import/require reaching into server/ — the client must talk to the server only over HTTP, the same wire the agent's tool calls use"
fi
echo "  ok: no cross-imports found"

echo "== client: install dependencies =="
(cd client && npm install)

echo "== client: integration tests =="
(cd client && npm test)

echo "alexa-plus: all checks passed."
