interface PageFetchedImage {
  imageBase64: string;
  mimeType: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bufferCtor = (
    globalThis as {
      Buffer?: {
        from: (
          data: ArrayBuffer
        ) => { toString: (encoding: string) => string };
      };
    }
  ).Buffer;

  if (bufferCtor) {
    return bufferCtor.from(buffer).toString('base64');
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function buildPageImageFetchOptions(
  imageUrl: string,
  sourcePageUrl?: string
): RequestInit {
  const options: RequestInit = {
    credentials: 'omit',
    cache: 'no-store',
    mode: 'cors',
    headers: {
      Accept:
        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  };

  if (!sourcePageUrl?.trim()) {
    return options;
  }

  try {
    const image = new URL(imageUrl);
    const source = new URL(sourcePageUrl);

    if (image.origin === source.origin) {
      options.credentials = 'same-origin';
      options.mode = 'same-origin';
    }

    options.referrer = `${source.origin}${source.pathname}${source.search}`;
    options.referrerPolicy = 'strict-origin-when-cross-origin';
  } catch {
    // Ignore malformed source URL and keep fallback fetch options.
  }

  return options;
}

export function shouldRetryWithPageImageFetch(error?: string): boolean {
  return /无法获取图片 \(403\)/.test(error ?? '');
}

export async function fetchImageBytesFromPage(
  imageUrl: string,
  sourcePageUrl?: string
): Promise<PageFetchedImage> {
  const response = await fetch(
    imageUrl,
    buildPageImageFetchOptions(imageUrl, sourcePageUrl)
  );

  if (!response.ok) {
    throw new Error(`无法获取图片 (${response.status})`);
  }

  const buffer = await response.arrayBuffer();

  return {
    imageBase64: arrayBufferToBase64(buffer),
    mimeType: response.headers.get('content-type') || 'image/jpeg',
  };
}
