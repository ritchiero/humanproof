/**
 * SHA-256 hashing — works in both browser and Node (Next.js API routes).
 */
export async function sha256(data: string): Promise<string> {
  if (typeof window !== 'undefined') {
    // Browser: Web Crypto API
    const buffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Node: crypto module
    const { createHash } = await import('crypto');
    return createHash('sha256').update(data).digest('hex');
  }
}

/** Report ID: HP-YYYYMMDD-XXXX */
export function generateReportId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 6);
  return `HP-${date}-${random}`;
}
