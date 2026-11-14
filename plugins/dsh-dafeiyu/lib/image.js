import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const QQ_IMAGE_HOSTS = new Set(['multimedia.nt.qq.com.cn', 'gxh.vip.qq.com'])

function safeQqUrl(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && QQ_IMAGE_HOSTS.has(url.hostname.toLowerCase()) ? url : null
  } catch {
    return null
  }
}

function mediaTypeOf(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

async function readLocalImage(file) {
  const filePath = file.startsWith('file:') ? fileURLToPath(file) : file
  const info = await stat(filePath)
  if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) return null
  const bytes = await readFile(filePath)
  const mediaType = mediaTypeOf(bytes)
  return mediaType ? { data: bytes, mediaType, name: path.basename(filePath) } : null
}

async function downloadQqImage(rawUrl) {
  let url = safeQqUrl(rawUrl)
  if (!url) return null
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects === 3) return null
      url = safeQqUrl(new URL(location, url).href)
      if (!url) return null
      continue
    }
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_IMAGE_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_IMAGE_BYTES) return null
    const mediaType = mediaTypeOf(bytes)
    return mediaType ? { data: bytes, mediaType, name: path.basename(url.pathname) || 'qq-image' } : null
  }
  return null
}

/** Resolve a NapCat image locally where possible; otherwise fetch only trusted QQ image hosts. */
export async function loadQqImage(image, bridge) {
  const file = String(image?.file ?? '')
  if (file && !/[\\/:]/.test(file) && file !== '.' && file !== '..') {
    try {
      const response = await bridge.call('get_image', { file }, 15_000)
      const localFile = response?.data?.file
      if (typeof localFile === 'string' && (path.isAbsolute(localFile) || localFile.startsWith('file:'))) {
        const local = await readLocalImage(localFile).catch(() => null)
        if (local) return local
      }
      const refreshedUrl = response?.data?.url
      if (typeof refreshedUrl === 'string') {
        const downloaded = await downloadQqImage(refreshedUrl).catch(() => null)
        if (downloaded) return downloaded
      }
    } catch {
      // Fall through to the short-lived URL attached to the OneBot event.
    }
  }
  return typeof image?.url === 'string' ? downloadQqImage(image.url).catch(() => null) : null
}
