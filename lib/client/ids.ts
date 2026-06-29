type BrowserCryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackCounter = 0;

export function createClientId(prefix = "client", cryptoSource: BrowserCryptoLike | undefined = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") {
    return `${prefix}-${cryptoSource.randomUUID()}`;
  }

  if (typeof cryptoSource?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  fallbackCounter = (fallbackCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
