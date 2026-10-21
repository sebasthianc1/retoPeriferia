import { mkdir, readFile, writeFile, appendFile, copyFile as fsCopyFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

export const FIXTURES_ROOT = "fixtures/reto-02"
export const OUT_ROOT = "out"

export function resolveFromRoot(directory: string, ...segments: string[]): string {
  return path.join(directory, ...segments)
}

export async function readJsonFile<T>(absolutePath: string): Promise<T> {
  const raw = await readFile(absolutePath, "utf8")
  return JSON.parse(raw) as T
}

export async function readTextFile(absolutePath: string): Promise<string> {
  return readFile(absolutePath, "utf8")
}

export function fileExists(absolutePath: string): boolean {
  return existsSync(absolutePath)
}

export async function ensureDir(absolutePath: string): Promise<void> {
  await mkdir(absolutePath, { recursive: true })
}

export async function copyFile(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to))
  await fsCopyFile(from, to)
}

export async function writeTextFile(absolutePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(absolutePath))
  await writeFile(absolutePath, content, "utf8")
}

export async function listDirs(absolutePath: string): Promise<string[]> {
  if (!existsSync(absolutePath)) return []
  const entradas = await readdir(absolutePath, { withFileTypes: true })
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

export interface LogEntry {
  ts: string
  herramienta: string
  mensaje_id: string | null
  ok: boolean
  resumen: string
}

export async function appendLog(directory: string, herramienta: string, mensajeId: string | null, ok: boolean, resumen: string): Promise<void> {
  const logPath = resolveFromRoot(directory, OUT_ROOT, "log.jsonl")
  await ensureDir(path.dirname(logPath))
  const entry: LogEntry = { ts: new Date().toISOString(), herramienta, mensaje_id: mensajeId, ok, resumen }
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf8")
}
