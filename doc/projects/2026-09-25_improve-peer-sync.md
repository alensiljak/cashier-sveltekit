# Peer Sync

## Goal

Simplify the Peer Sync page and make it more intuitive and user-friendly.

## Observations

### What's over-complicated

1. **Too many steps before anything syncs.** The flow is: (optionally edit name/room) → Connect toggle → wait for peers → trust → select the peer → tick items → Preview, Diff or Pull → optionally reload the ledger. Most of that is state the app could handle itself.
   - ✅ **Connect:** auto-join the saved room when the page opens and drop the toggle. Or keep the toggle but remember it.
   - **Peer selection:** it's already auto-picked when there's one trusted peer. Make that the only model, and show the trusted peer as a header row instead of a radio group.

2. ✅ **Three cards for what is one thing.** Identity/room, Connect and Peers in Room could be a single "Connection" card. That would be one status line ("Connected · room cashier · 1 peer") with the edit and rescan icons inline. The ID belongs in an "About this device" detail, not on the main line.

3. **Preview, Diff and Pull overlap.** Preview shows raw JSON that few people will read. Diff already shows everything Preview does, and lets you merge. Pull is a blind overwrite ("cannot be undone"), which is the most dangerous action. I'd collapse them to one primary action, "Sync", that:
   - shows nothing when the hashes match;
   - otherwise opens the keyed merge view (the Diff);
   - drops Preview, and makes overwrite an option inside the merge view instead of a top-level button.

4. ✅ **Item checkboxes are ceremony.** Settings and Scheduled are the only two items, and the hash badges already say which differ. Drop "Select all" and the checkboxes and treat each item as a row with its own status and action, for example "Settings — Different [Review]".

5. ✅ **The "Reload Ledger" banner is manual.** Settings and Scheduled changes probably don't need a ledger reload at all. If they do, run it automatically after a merge.

6. ✅ **Trusted Devices is duplicated.** It's a collapsed list here, and the WebDAV page also matches devices against Trusted Peers. Trust is a device-level concept, so it should have one home. This page and the WebDAV page should both link to it.

### Smaller observations

- ✅ The `RELAY_STRATEGIES` picker is buried in the toolbar menu. It's really a connection troubleshooting setting, so it fits under "Advanced".
- ✅ The pairing-code confirmation is good. Keep it, but show it as a prominent prompt rather than inside a list row.
- `pulledSinceReload`, `reloadPhase`, `hashStatus`, `isFetching`, `isPulling` and the two `applying*` flags are a lot of ad-hoc state. A single state machine per item (idle → checking → same/different → merging → done) would replace most of it.
- Diff/merge for settings and scheduled data is well built. I'd keep `JsonMergeViewer` and just make it the single entry point.

### Questions

- ✅ Should Peer Sync stay a standalone page, or fold into a unified Sync page with WebDAV? That decides how much to change.

## CRDT Store Sync

- Sync the CRDT store
- Update the CRDT store hash after peer sync
