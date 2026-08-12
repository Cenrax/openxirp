import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { Project, Session } from '@shared/types'

interface Schema {
  projects: Project[]
  sessions: Session[]
}

const EMPTY: Schema = { projects: [], sessions: [] }

/**
 * Minimal atomic JSON store kept in the app's userData directory.
 * Deliberately dependency-free to avoid native/ESM packaging headaches.
 */
export class Store {
  private file: string
  private data: Schema

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'openxirp.json')
    this.data = this.read()
  }

  private read(): Schema {
    try {
      if (!existsSync(this.file)) return structuredClone(EMPTY)
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8'))
      return { projects: parsed.projects ?? [], sessions: parsed.sessions ?? [] }
    } catch {
      return structuredClone(EMPTY)
    }
  }

  private write(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    renameSync(tmp, this.file)
  }

  get projects(): Project[] {
    return this.data.projects
  }

  get sessions(): Session[] {
    return this.data.sessions
  }

  addProject(project: Project): void {
    this.data.projects.push(project)
    this.write()
  }

  removeProject(id: string): void {
    this.data.projects = this.data.projects.filter((p) => p.id !== id)
    this.data.sessions = this.data.sessions.filter((s) => s.projectId !== id)
    this.write()
  }

  addSession(session: Session): void {
    this.data.sessions.push(session)
    this.write()
  }

  updateSession(id: string, patch: Partial<Session>): void {
    const s = this.data.sessions.find((x) => x.id === id)
    if (!s) return
    Object.assign(s, patch)
    this.write()
  }

  removeSession(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id)
    this.write()
  }

  findSession(id: string): Session | undefined {
    return this.data.sessions.find((s) => s.id === id)
  }

  findProject(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id)
  }
}
