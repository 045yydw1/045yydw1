const ENDPOINT = 'https://www.bing.com/search'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'

function decodeEntities(value) {
  const point = (raw, radix) => {
    const number = parseInt(raw, radix)
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ''
  }
  return String(value ?? '')
    .replace(/&#x([\da-f]+);?/gi, (_match, hex) => point(hex, 16))
    .replace(/&#(\d+);?/g, (_match, dec) => point(dec, 10))
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
}

function cleanHtml(value) {
  return decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim()
}

function parseResults(html, maxResults) {
  const blocks = html.match(/<li\b[^>]*class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi) ?? []
  const sources = []
  const seen = new Set()
  for (const block of blocks) {
    const link = /<h2\b[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!link) continue
    let url
    try { url = new URL(decodeEntities(link[1])) } catch { continue }
    if (!['http:', 'https:'].includes(url.protocol) || /(^|\.)bing\.com$/i.test(url.hostname)) continue
    if (seen.has(url.href)) continue
    seen.add(url.href)
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)
    sources.push({ url: url.href, title: cleanHtml(link[2]), ...(paragraph ? { snippet: cleanHtml(paragraph[1]) } : {}) })
    if (sources.length >= maxResults) break
  }
  return sources
}

/** Keyless search adapter; only contacts Bing's fixed public search endpoint. */
export function createBingSearchProvider({ fetchImpl = fetch } = {}) {
  return {
    id: 'dafeiyu-bing',
    available: () => true,
    async search(request, signal) {
      const query = String(request?.query ?? '').trim()
      if (!query) throw new Error('搜索词不能为空')
      if (query.length > 500) throw new Error('搜索词太长，请控制在 500 个字以内')
      const url = new URL(ENDPOINT)
      url.searchParams.set('q', query)
      url.searchParams.set('mkt', 'zh-CN')
      const response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`Bing 搜索失败（HTTP ${response.status}）`)
      const html = await response.text()
      const maxResults = Math.min(20, Math.max(1, Number(request.maxResults) || 5))
      return { sources: parseResults(html, maxResults), truncated: false }
    },
  }
}

