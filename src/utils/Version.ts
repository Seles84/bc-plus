const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

export function parseBCPVersion(version: string): BCPVersion | null {
    const match = VERSION_PATTERN.exec(version);
    if (!match) {
        return null;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        extra: match[4],
        dev: match[4]?.toUpperCase().includes("DEV") ?? false,
    };
}

export function BCPVersionToString(version: BCPVersion): string {
    const base = `${version.major}.${version.minor}.${version.patch}`;
    return version.extra ? `${base}-${version.extra}` : base;
}

/** Returns a negative number if a < b, positive if a > b, 0 if equal. Ignores `extra`. */
export function BCPVersionCompare(a: BCPVersion, b: BCPVersion): number {
    return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}
