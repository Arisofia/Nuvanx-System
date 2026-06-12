# CI root cause

The CI workflow references a Ruby validator path that is not present in the repository. The canonical workflow validator is `scripts/validate-github-workflows.js`.
