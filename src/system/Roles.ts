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
    "Owner",
    "Lover",
    "Mistress",
    "Whitelist",
    "Friend",
    "Public",
];

export function roleName(role: Role): string {
    return RoleNames[role] ?? "Unknown";
}
