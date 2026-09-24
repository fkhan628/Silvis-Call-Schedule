# History rewrite for repo privacy (Prompt 16 A6a)

*Prepared 2026-09-23. The working tree is clean since branch `p16/a6-privacy`: no machine path, session id, staff
full name, roster middle initial, email subject or personal vacation range in any tracked file (`test/privacy.test.js`
pins it on every push). Git **history** still carries the earlier wording of a few rule notes, the developer's machine
paths and the personal address on every human commit. This is the procedure that removes them. It rewrites every commit
id, so it is done once, by Faraz, from a fresh clone, and every other clone and worktree is re-created afterwards.*

The two input files are **private** and live only in the OneDrive folder (never in the repo, never quoted in a commit
message): `replacements.txt` (the `git filter-repo --replace-text` list: each original phrase or path on its own line as
`old==>new`) and `mailmap` (one line mapping the personal address to the GitHub noreply address, which covers author and
committer). An optional second list maps the staff full names to role labels; concatenate it onto `replacements.txt`
if the names should leave history too.

## Decision first: private repo, public repo, or both

- **Private repository** (Settings → General → Change visibility): closes the door today; GitHub Pages from a private
  repository needs GitHub Pro (about $4/month); nothing else changes. History is still readable by every collaborator
  and by anyone who cloned before the switch.
- **History rewrite** (below): removes the wording and the address from every commit. Anyone who cloned earlier keeps
  the old objects, so it does not undo a past exposure; it stops future ones. Recommended in both cases; **required**
  if the repository stays public.

## 1. Install git-filter-repo (once)

`git filter-branch` is not used for the real rewrite (slow, and it leaves refs/original behind). git-filter-repo needs
Python 3:

```powershell
winget install Python.Python.3.12        # if python --version fails
pip install git-filter-repo
git filter-repo --version                 # prints a hash: installed
```

## 2. Rewrite in a FRESH clone (never the working clone or a worktree)

```powershell
cd <your projects folder>
git clone https://github.com/fkhan628/Silvis-Call-Schedule.git Silvis-rewrite
cd Silvis-rewrite
git rev-parse main^{tree} > ..\silvis-rewrite-tree-before.txt   # the tree id of main BEFORE the rewrite, kept outside the clone
git filter-repo --replace-text "<the OneDrive folder>\privacy\replacements.txt" --mailmap "<the OneDrive folder>\privacy\mailmap" --force
```

`--replace-text` rewrites every blob on every branch and tag AND every commit message; `--mailmap` rewrites author and
committer. git-filter-repo removes the `origin` remote on purpose so nothing is pushed by accident.

## 3. Verify before pushing anything

```powershell
# a. none of the removed words survive in any commit (each must print 0)
foreach ($w in @("<a removed word>", "<another>")) { "$w : " + ((git log -p --all -S"$w" --format=%H | Measure-Object -Line).Lines) }
# b. only the noreply address and the Actions bot remain (two lines)
git log --all --format=%ae | sort -u
git log --all --format=%ce | sort -u
# c. the tree of main is byte-identical to the tree before the rewrite. git-filter-repo drops the old commits (no
#    refs/original, unreachable objects pruned), so compare the tree id recorded in step 2: the two ids must be equal.
#    They are equal only once branch p16/a6-privacy is merged (every entry of the replace list is absent from that
#    tree); before the merge the rewrite would change the head too.
git rev-parse main^{tree}; Get-Content ..\silvis-rewrite-tree-before.txt
# d. the suites still pass on the rewritten head
npm install --no-audit --no-fund; npm test
```

Pick the words for (a) from `replacements.txt` (a few of the phrases and the user name are enough); the list itself
stays private.

## 4. Push, then re-create every clone

```powershell
git remote add origin https://github.com/fkhan628/Silvis-Call-Schedule.git
git push --force --all origin
git push --force --tags origin
```

- **GitHub Pages redeploys from the rewritten `main`** (same content, new commit ids). The next CI build commits on top
  of it as usual.
- Every collaborator and every machine **re-clones**; the worktrees are re-created from the new clone (`git worktree
  add`). A `git pull` into an old clone would merge the two histories back together - do not.
- Open pull requests based on old commits must be re-based onto the rewritten branches (or re-created).
- GitHub keeps unreachable objects for a while; open a support request ("remove cached views / run gc") if the old
  commit ids must stop resolving from the web UI.

## 5. Identity going forward

`git config user.email` in the working clone is the GitHub noreply address (checked 2026-09-23: it already is). Keep
GitHub → Settings → Emails → "Keep my email addresses private" on, so no future commit carries the personal address.
