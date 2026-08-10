/** BC+ role hierarchy; lower value = higher authority. */
export enum Role {
    /** The player's actual BC Owner - derived from the game, never assigned manually */
    BCOwner = 0,
    Owner = 1,
    Lover = 2,
    Mistress = 3,
    Whitelist = 4,
    Friend = 5,
    Public = 6,
}

export const RoleNames: readonly string[] = [
    "BC Owner",
    "Co-Owner",
    "Lover",
    "Mistress",
    "Whitelist",
    "Friend",
    "Public",
];

export function roleName(role: Role): string {
    return RoleNames[role] ?? "Unknown";
}

/**
 * Parses a stored/synced role name; accepts names written by older clients
 * ("Owner" was renamed to "Co-Owner" after 0.4.0). Null when unknown.
 */
export function roleFromName(name: string): Role | null {
    const index = RoleNames.indexOf(name);
    if (index !== -1) {
        return index as Role;
    }
    return name === "Owner" ? Role.Owner : null;
}
