/**
 * Assets offered for a group: wearable, enabled, and either free or owned by
 * the local player (the configuring side often supplies bought items, matching
 * BC's own dialog, where the acting character's inventory counts too).
 */
export function catalogAssets(group: AssetGroupName): Asset[] {
    const groupDef = AssetGroupGet(Player.AssetFamily, group);
    return (groupDef?.Asset ?? [])
        .filter((a) => a.Wear && a.Enable && !a.IsLock
            && (a.Value >= 0 || InventoryAvailable(Player, a.Name, group)))
        .sort((a, b) => a.Description.localeCompare(b.Description));
}
