import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  DirEntry,
  DirFilter,
  DocumentChanged,
  DocumentData,
  MediaData,
  PdfData,
  UpdateCheckResult,
} from "../types";
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  TEXT_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./format";

export async function pickFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    title: "打开文件",
    filters: [
      { name: "所有支持的文件", extensions: [...SUPPORTED_EXTENSIONS] },
      { name: "文档与代码", extensions: [...TEXT_EXTENSIONS] },
      { name: "PDF", extensions: [...PDF_EXTENSIONS] },
      { name: "图片", extensions: [...IMAGE_EXTENSIONS] },
      { name: "视频", extensions: [...VIDEO_EXTENSIONS] },
      { name: "音频", extensions: [...AUDIO_EXTENSIONS] },
    ],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export function readDocument(path: string): Promise<DocumentData> {
  return invoke<DocumentData>("read_document", { path });
}

export function openMedia(path: string): Promise<MediaData> {
  return invoke<MediaData>("open_media", { path });
}

export function openPdf(path: string): Promise<PdfData> {
  return invoke<PdfData>("open_pdf", { path });
}

export function getAppVersion(): Promise<string> {
  return invoke<string>("app_version");
}

export function checkUpdate(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>("check_update");
}

export function closeDocument(path: string): Promise<void> {
  return invoke<void>("close_document", { path });
}

export function resolveDocumentLink(
  file: string,
  href: string,
): Promise<string | null> {
  return invoke<string | null>("resolve_document_link", { file, href });
}

export function takeLaunchFiles(): Promise<string[]> {
  return invoke<string[]>("take_launch_files");
}

export function listDirectory(
  path: string,
  filter?: DirFilter,
): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_directory", { path, filter });
}

export async function pickDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "添加书库目录",
  });
  return typeof selected === "string" ? selected : null;
}

export function onDocumentChanged(
  handler: (payload: DocumentChanged) => void,
): Promise<UnlistenFn> {
  return listen<DocumentChanged>("document-changed", (event) =>
    handler(event.payload),
  );
}

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

export function onDragDrop(
  handler: (payload: DragDropPayload) => void,
): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) =>
    handler(event.payload as unknown as DragDropPayload),
  );
}

export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

export async function revealFile(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function openWithSystem(path: string): Promise<void> {
  await openPath(path);
}
