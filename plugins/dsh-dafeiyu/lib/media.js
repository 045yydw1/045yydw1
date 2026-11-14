/**
 * 刷视频：拉 B 站热门 / 抖音热榜，或者用默认浏览器打开链接。
 * 只取公开接口的元数据，不登录、不点赞、不评论。
 */
import { spawn } from 'node:child_process'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const ALLOWED_HOSTS = ['www.bilibili.com', 'b23.tv', 'www.douyin.com', 'v.douyin.com']

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** B 站当前热门视频。 */
export async function fetchBiliHot(limit = 8) {
  const json = await getJson('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1', {
    Referer: 'https://www.bilibili.com/',
  })
  const list = Array.isArray(json?.data?.list) ? json.data.list : []
  return list.slice(0, Math.max(1, limit)).map((item) => ({
    title: String(item.title ?? '').slice(0, 80),
    meta: `${item.owner?.name ?? '未知UP'} · ${formatCount(item.stat?.view)}播放`,
    url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : 'https://www.bilibili.com',
  }))
}

/** 抖音热榜词条。 */
export async function fetchDouyinHot(limit = 8) {
  const json = await getJson('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', {
    Referer: 'https://www.douyin.com/',
  })
  const list = Array.isArray(json?.word_list) ? json.word_list : []
  return list.slice(0, Math.max(1, limit)).map((item) => ({
    title: String(item.word ?? '').slice(0, 80),
    meta: `热度 ${formatCount(item.hot_value)}`,
    url: `https://www.douyin.com/search/${encodeURIComponent(String(item.word ?? ''))}`,
  }))
}

function formatCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/** 用默认浏览器打开链接；只允许 B 站/抖音域名。 */
export function openUrl(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    throw new Error('链接不合法')
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('只允许 http/https 链接')
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) throw new Error(`只允许打开 B 站/抖音链接，收到 ${parsed.hostname}`)
  const child = spawn('cmd.exe', ['/c', 'start', '', parsed.href], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return parsed.href
}
