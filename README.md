# DOC06 Inheritance Calculator

A calculation aid for the Executor. It works out the shares of the Distributable Net Estate under Clause 5 and Schedule A of DOC01 (the Will), from a family tree.

**DOC06 is not operative, creates no entitlement, and does not form part of the Will. Where it differs from Clause 5 or Schedule A, the Will prevails (DOC01, Schedule A, SA-GEN.2).**

This repository is a backup. The Executor's copy is the HTML file kept in the estate pack with DOC01.

## Versions

- Follows DOC01 v1.1.004.212, Clause 5 and Schedule A.
- Self-check: MODULE_TESTS v3.129, 192 tests (225 runs), all passing.

## Using the calculator

Open `DOC06_Inheritance_Calculator.html` in any web browser. It is one self-contained file: it needs no internet connection, no installation and no other files.

1. Enter the validated heir set: the people who remain after the Pre-Stage checks in Clause 5.3. Where a person's status is not settled, run each possibility as a separate family (Clause 10.2.2).
2. Use **Quick entry** for an ordinary family, or **Edit a person** to build the tree. Every person has a father and a mother, and is marked either as an heir or as having died before the deceased.
3. People who link a relative to the deceased but are not heirs themselves (for example a daughter who died before, whose son is entered) are marked "died before".
4. Press **Calculate shares**. The result shows each share as an exact fraction, and the rules applied, each tagged with its Schedule A provision.

The **Self-check** tab runs every MODULE_TESTS case each time the page opens.

## Folder `build`

| File | What it is |
|---|---|
| `engine.js` | The share rules (Clause 5 and Schedule A). The only copy of the rules. |
| `calculator_template.html` | The page: family-tree entry, result display, self-check. |
| `MODULE_TESTS_3.129.txt` | The source of the test cases. |
| `extract.py`, `convert.py` | Turn a MODULE_TESTS export into `tests.json`. |
| `tests.json` | The test cases as family trees with expected shares. |
| `build_page.py` | Builds the page from the template, `engine.js` and `tests.json`. |
| `run.js` | Runs every test case against `engine.js` (needs Node.js). |
| `fuzz.js` | Runs 60,000 random families and checks every result totals exactly 1. |

### Rebuilding after a change

From the `build` folder:

1. After a MODULE_TESTS change: `python3 extract.py <MODULE_TESTS export.txt>`, then `python3 convert.py` (check `conversion_report.txt`: no CHECK lines, no assumptions).
2. After a change to the rules: edit `engine.js`.
3. `node run.js`: every test must pass.
4. `python3 build_page.py`: writes the new `DOC06_Inheritance_Calculator.html` one folder up.
5. Open the page and confirm the self-check badge shows every test passing.

Any change to the rules must follow DOC01 Clause 5 and Schedule A, checked against DOC00. A failing test is a calculator error unless the DOC01 text says otherwise.
