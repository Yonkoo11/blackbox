/**
 * Walrus testnet storage via the public, funded HTTP publisher/aggregator.
 * No wallet needed — the public publisher pays SUI + WAL for the blob.
 */
const PUBLISHER = 'https://publisher.walrus-testnet.walrus.space';
const AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Store raw bytes on Walrus testnet; returns the content-addressed blobId. */
export async function putBlob(bytes: Uint8Array, epochs = 5): Promise<string> {
  const res = await fetch(`${PUBLISHER}/v1/blobs?epochs=${epochs}`, {
    method: 'PUT',
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`walrus put failed: ${res.status} ${await res.text()}`);
  const info: any = await res.json();
  const blobId =
    info?.newlyCreated?.blobObject?.blobId ??
    info?.alreadyCertified?.blobId ??
    info?.newlyCreated?.blobId;
  if (!blobId) throw new Error('walrus put: no blobId in response: ' + JSON.stringify(info).slice(0, 300));
  return blobId;
}

/** Read a blob back by id, retrying while it certifies. */
export async function getBlob(blobId: string, tries = 8): Promise<Uint8Array> {
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${AGGREGATOR}/v1/blobs/${blobId}`);
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    lastErr = `${res.status}`;
    await sleep(1500 * (i + 1));
  }
  throw new Error(`walrus get failed for ${blobId}: ${lastErr}`);
}
