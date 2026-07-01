# Ledger Validation

Ledger Validation checks your entire ledger for errors and warnings, the same checks the ledger engine runs when loading your books.

Validation runs automatically when you open the page. Tap **Reload & Validate** at any time to reload the ledger from storage and re-run the check — useful after editing files directly (for example, via [OPFS Files](/help/opfs-file-storage)) instead of through the app's own screens.

Once a check completes, a badge shows **Valid** or **Invalid**, along with a count of errors and warnings found.

- If nothing is wrong, you'll see a plain confirmation that no issues were found.
- Otherwise, **Errors** and **Warnings** each appear in their own table listing every issue's line, column, and message, so you can locate and fix the problem in your source file.

If the ledger fails to load at all (for example, a malformed file the parser can't recover from), the page shows the underlying error message instead of a table.
