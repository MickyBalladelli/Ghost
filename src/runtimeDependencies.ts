import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawn } from 'node:child_process'
import * as vscode from 'vscode'

export interface GhostClock {
  now(): number
  setTimeout(handler: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export interface GhostProcessRunner {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess
}

export interface GhostFileSystem {
  readFile(uri: vscode.Uri): Thenable<Uint8Array>
  writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>
  createDirectory(uri: vscode.Uri): Thenable<void>
  copy(source: vscode.Uri, destination: vscode.Uri, options?: { overwrite?: boolean }): Thenable<void>
  rename(source: vscode.Uri, destination: vscode.Uri, options?: { overwrite?: boolean }): Thenable<void>
  delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void>
}

export interface GhostStorage {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): Thenable<void>
}

export interface GhostWebviewMessenger {
  postMessage(message: unknown): Thenable<boolean> | Promise<boolean>
}

export interface GhostRuntimeDependencies {
  clock: GhostClock
  processRunner: GhostProcessRunner
  fileSystem: GhostFileSystem
}

export const systemClock: GhostClock = {
  now: () => Date.now(),
  setTimeout: (handler, milliseconds) => setTimeout(handler, milliseconds),
  clearTimeout: handle => clearTimeout(handle)
}

export const systemProcessRunner: GhostProcessRunner = {
  spawn: (command, args, options) => spawn(command, args, options)
}

export const vscodeFileSystem: GhostFileSystem = vscode.workspace.fs

export const defaultGhostRuntimeDependencies: GhostRuntimeDependencies = {
  clock: systemClock,
  processRunner: systemProcessRunner,
  fileSystem: vscodeFileSystem
}
