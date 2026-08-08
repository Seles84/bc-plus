/** HMAC-SHA256 via Web Crypto, truncated to `length` base64 characters. */
export async function hmacSHA256(message: string, key: string, length: number): Promise<string> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
    const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const result = base64.substring(0, length);
    if (result.length !== length) {
        throw new Error("Failed to generate HMAC");
    }
    return result;
}
