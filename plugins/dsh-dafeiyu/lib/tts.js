/**
 * 语音合成：优先 edge-tts（晓伊等神经语音，自然），失败时退回 Windows SAPI。
 * 只依赖本机的 python/edge-tts 与 PowerShell。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const run = promisify(execFile)

export const DEFAULT_VOICE = 'zh-CN-XiaoyiNeural'

/**
 * @param {string} text
 * @param {{voice?: string, rate?: string, pitch?: string, outDir: string}} options
 * @returns {Promise<{file: string, engine: string}>}
 */
export async function synthesize(text, { voice = DEFAULT_VOICE, rate = '+0%', pitch = '+0Hz', outDir } = {}) {
  const clean = String(text ?? '').trim()
  if (!clean) throw new Error('语音内容为空')
  if (!outDir) throw new Error('缺少语音输出目录')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const mp3 = path.join(outDir, `voice-${stamp}.mp3`)
  const args = ['-m', 'edge_tts', '--voice', voice, '--text', clean.slice(0, 500), '--write-media', mp3]
  if (rate && rate !== '+0%') args.push('--rate', rate)
  if (pitch && pitch !== '+0Hz') args.push('--pitch', pitch)
  try {
    await run('python', args, { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 })
    if (fs.existsSync(mp3) && fs.statSync(mp3).size > 0) return { file: mp3, engine: 'edge-tts' }
    throw new Error('edge-tts 没有生成文件')
  } catch (error) {
    const wav = path.join(outDir, `voice-${stamp}.wav`)
    const textFile = path.join(outDir, `voice-${stamp}.txt`)
    fs.writeFileSync(textFile, clean.slice(0, 500), 'utf8')
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$s.SelectVoice("Microsoft Huihui Desktop")',
      `$t = [IO.File]::ReadAllText('${textFile.replace(/'/g, "''")}')`,
      `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}')`,
      '$s.Speak($t)',
      '$s.Dispose()',
    ].join('; ')
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
      if (!fs.existsSync(wav)) throw error
      return { file: wav, engine: 'sapi' }
    } finally {
      try {
        fs.unlinkSync(textFile)
      } catch {
        /* ignore */
      }
    }
  }
}

/** 清理旧的语音文件，保留最近 keep 个。 */
export function pruneVoices(dir, keep = 30) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('voice-'))
      .map((name) => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const file of files.slice(keep)) fs.unlinkSync(path.join(dir, file.name))
  } catch {
    /* ignore */
  }
}
